/**
 * 应用内检索（不依赖模型联网）。
 *
 * 为什么放在应用里做：
 *  - 模型自带的 web_search 按检索轮次计费，一轮核查常常十几次检索；
 *  - 检索到的大段正文会一起进上下文，token 花在噪音上。
 *
 * 这里的做法是：本地拆出查询词 → 抓搜索结果 → 只取每条命中最相关的句子，
 * 拼成一份几百字的「证据摘要」交给模型判断。模型只做判断，不做检索。
 *
 * 检索源按可靠性排序，任何一个失败都不影响其余：
 *   DuckDuckGo HTML  → Bing HTML  → Wikipedia API（中/英）
 * 正文用 Jina Reader 转成纯文本；失败时退回直接抓 HTML 再去标签。
 */

import type { Settings } from './types';
import { getText, runtime } from './transport';
import { dedupeKey, hostOf, truncate } from './utils';

export interface Evidence {
  sid: string;
  title: string;
  url: string;
  publisher: string;
  snippet: string;
}

export interface ResearchResult {
  evidence: Evidence[];
  queries: string[];
  engines: string[];
  hits: number;
  pages: number;
  notes: string[];
}

interface Hit {
  title: string;
  url: string;
  snippet: string;
  via: string;
  query?: string;
}

const SKIP_HOSTS = [
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'tiktok.com',
  'pinterest.com',
  'linkedin.com',
];

const PLAN: Record<Settings['depth'], { queries: number; fetch: number; evidence: number }> = {
  quick: { queries: 2, fetch: 2, evidence: 6 },
  standard: { queries: 4, fetch: 4, evidence: 10 },
  deep: { queries: 6, fetch: 6, evidence: 14 },
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function isAborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

function cjkRatio(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk / Math.max(1, text.replace(/\s/g, '').length);
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/* --------------------------------------------------------------- 查询词构造 */

const NOISE = [
  '研究显示',
  '数据显示',
  '据报道',
  '事实上',
  '众所周知',
  '有专家表示',
  '业内人士',
  '我们认为',
  '可以预见',
  '值得注意的是',
];

function candidates(paragraph: string): string[] {
  const text = paragraph.replace(/\s+/g, ' ').trim();
  const clauses = text
    .split(/[。！？；\n]|[，,](?=[^0-9]{0,6}[^，,]{12,})/)
    .map((s) => s.replace(/^[「『（(“"']+|[」』）)”"']+$/g, '').trim())
    .filter((s) => s.length >= 8);

  const scored = clauses.map((clause) => {
    let score = 0;
    if (/[0-9]/.test(clause)) score += 3;
    if (/\d+\s*(%|％|倍|亿|万|年|月|日|人|美元|元)/.test(clause)) score += 3;
    if (/[《「“"]/.test(clause)) score += 1;
    if (/[A-Z][A-Za-z]{2,}/.test(clause)) score += 1;
    if (clause.length <= 40) score += 2;
    if (NOISE.some((n) => clause.startsWith(n))) score -= 2;
    return { clause, score };
  });

  scored.sort((a, b) => b.score - a.score || a.clause.length - b.clause.length);
  return scored.slice(0, 3).map((s) => s.clause.replace(/^[^，,。]{0,4}(显示|表明|指出|称)/, '').trim());
}

function queriesFor(paragraph: string, max = 2): string[] {
  const list = candidates(paragraph);
  if (!list.length) {
    const fallback = paragraph.replace(/\s+/g, ' ').trim().slice(0, 34);
    return fallback.length >= 6 ? [fallback] : [];
  }

  const out: string[] = [];
  const first = list[0];
  const number = first.match(/\d+(?:\.\d+)?\s*(?:%|％|倍|亿|万|年|月|日|人|美元|元|公里|米|吨)?/)?.[0];
  out.push(truncate(number && !first.includes(number) ? `${first} ${number}` : first, 46));

  if (list[1] && max > 1) out.push(truncate(list[1], 40));
  return Array.from(new Set(out)).slice(0, max);
}

/* ------------------------------------------------------------------ 搜索源 */

function decodeDdg(href: string): string {
  const abs = href.startsWith('//') ? `https:${href}` : href;
  try {
    const url = new URL(abs);
    const target = url.searchParams.get('uddg');
    if (target) return decodeURIComponent(target);
    return abs;
  } catch {
    return abs;
  }
}

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<Hit[]> {
  const res = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    timeoutMs: 12_000,
    signal,
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (res.status !== 200) throw new Error(`DuckDuckGo ${res.status}`);
  if (!res.text.includes('result__a')) {
    throw new Error(res.text.length < 4000 ? 'DuckDuckGo 触发了人机校验' : 'DuckDuckGo 结构变化');
  }

  const doc = new DOMParser().parseFromString(res.text, 'text/html');
  const hits: Hit[] = [];
  doc.querySelectorAll('.result').forEach((node) => {
    const link = node.querySelector('a.result__a');
    const snap = node.querySelector('.result__snippet');
    const url = link?.getAttribute('href');
    if (!link || !url) return;
    const title = (link.textContent ?? '').trim();
    if (!title) return;
    hits.push({
      title,
      url: decodeDdg(url),
      snippet: (snap?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      via: 'DuckDuckGo',
    });
  });
  return hits.slice(0, 5);
}

async function search360(query: string, signal?: AbortSignal): Promise<Hit[]> {
  const res = await getText(`https://www.so.com/s?q=${encodeURIComponent(query)}`, {
    timeoutMs: 12_000,
    signal,
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (res.status !== 200) throw new Error(`360 搜索 ${res.status}`);
  const doc = new DOMParser().parseFromString(res.text, 'text/html');
  const hits: Hit[] = [];
  doc.querySelectorAll('li.res-list').forEach((node) => {
    const a = node.querySelector('h3 a');
    if (!a) return;
    const title = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
    // data-mdurl 是 360 给出的真实地址，href 只是跳转壳
    const real = a.getAttribute('data-mdurl') || '';
    const url = /^https?:\/\//i.test(real) ? real : '';
    if (!title || !url) return;
    const snippet = (node.querySelector('.res-list-summary, .res-desc')?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    hits.push({ title, url, snippet, via: '360 搜索' });
  });
  return hits.slice(0, 5);
}

async function searchWikipedia(query: string, signal?: AbortSignal): Promise<Hit[]> {
  const lang = cjkRatio(query) > 0.2 ? 'zh' : 'en';
  const q = query.slice(0, 60);
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}` +
    `&gsrlimit=2&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;

  const res = await getText(url, {
    timeoutMs: 10_000,
    signal,
    headers: { Accept: 'application/json' },
  });
  if (res.status !== 200) throw new Error(`Wikipedia ${res.status}`);

  const data = JSON.parse(res.text) as {
    query?: { pages?: Record<string, { title: string; extract?: string; fullurl?: string }> };
  };
  const pages = Object.values(data.query?.pages ?? {});
  return pages
    .filter((p) => p.extract)
    .map((p) => ({
      title: p.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/\s/g, '_'))}`,
      snippet: truncate((p.extract ?? '').replace(/\s+/g, ' ').trim(), 300),
      via: 'Wikipedia',
    }));
}

async function searchAny(query: string, signal?: AbortSignal): Promise<{ hits: Hit[]; errors: string[] }> {
  const zh = cjkRatio(query) > 0.2;
  const engines: { name: string; run: (q: string) => Promise<Hit[]> }[] = zh
    ? [
        { name: '360 搜索', run: (q) => search360(q, signal) },
        { name: 'DuckDuckGo', run: (q) => searchDuckDuckGo(q, signal) },
        { name: 'Wikipedia', run: (q) => searchWikipedia(q, signal) },
      ]
    : [
        { name: 'DuckDuckGo', run: (q) => searchDuckDuckGo(q, signal) },
        { name: 'Wikipedia', run: (q) => searchWikipedia(q, signal) },
        { name: '360 搜索', run: (q) => search360(q, signal) },
      ];

  const errors: string[] = [];
  for (const engine of engines) {
    if (isAborted(signal)) break;
    try {
      const hits = await engine.run(query);
      if (hits.length) return { hits, errors };
      errors.push(`${engine.name}: 无结果`);
    } catch (err) {
      errors.push(`${engine.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { hits: [], errors };
}

/* ---------------------------------------------------------------- 正文摘录 */

function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])\s*|(?<=\.)\s+(?=[A-Z\u4e00-\u9fff])/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 12);
}

function tokens(text: string): Set<string> {
  const set = new Set<string>();
  (text.match(/[A-Za-z0-9][A-Za-z0-9.+%-]{1,}/g) ?? []).forEach((w) => set.add(w.toLowerCase()));
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const chunk of cjk) {
    for (let i = 0; i < chunk.length - 1; i += 1) set.add(chunk.slice(i, i + 2));
  }
  return set;
}

function bestExcerpt(text: string, query: string, limit = 420): string {
  const wanted = tokens(query);
  const scored = sentences(text).map((sentence) => {
    const own = tokens(sentence);
    let hits = 0;
    for (const t of wanted) if (own.has(t)) hits += 1;
    const numeric = /\d/.test(sentence) ? 1 : 0;
    return { sentence, score: hits + numeric * 0.5 };
  });
  scored.sort((a, b) => b.score - a.score);

  const picked: string[] = [];
  let used = 0;
  for (const item of scored) {
    if (item.score <= 0 && picked.length) break;
    if (used + item.sentence.length > limit) continue;
    picked.push(item.sentence);
    used += item.sentence.length;
    if (picked.length >= 3 || used > limit * 0.8) break;
  }
  if (!picked.length) return truncate(text.replace(/\s+/g, ' ').trim(), limit);
  return truncate(picked.join(' '), limit);
}

async function fetchExcerpt(url: string, query: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await getText(`https://r.jina.ai/${url}`, {
      timeoutMs: 20_000,
      signal,
      headers: { Accept: 'text/plain', 'User-Agent': UA },
    });
    if (res.status === 200 && res.text.length > 400) {
      const body = res.text
        .split('\n')
        .filter((line) => !/^(Title|URL Source|Published Time|Markdown Content|Warning|Image \d+):?/i.test(line.trim()))
        .join('\n');
      const excerpt = bestExcerpt(stripTags(body), query);
      if (excerpt.length > 80) return excerpt;
    }
  } catch {
    /* Jina 失败时退回直抓 */
  }

  try {
    const res = await getText(url, {
      timeoutMs: 12_000,
      signal,
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    if (res.status !== 200) return null;
    const excerpt = bestExcerpt(stripTags(res.text), query);
    return excerpt.length > 80 ? excerpt : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------- 主流程 */

export async function research(
  paragraphTexts: string[],
  depth: Settings['depth'],
  signal?: AbortSignal,
): Promise<ResearchResult> {
  const plan = PLAN[depth];
  const notes: string[] = [];
  const engines = new Set<string>();
  const queries: string[] = [];

  // 长文按段落轮流取查询词，避免全部集中在开头几句
  const perParagraph = paragraphTexts.map((p) => queriesFor(p, plan.queries > 2 ? 2 : 1));
  const flat: string[] = [];
  for (let round = 0; round < 2; round += 1) {
    for (const list of perParagraph) {
      const q = list[round];
      if (q) flat.push(q);
    }
  }
  for (const q of flat) {
    if (queries.length >= plan.queries) break;
    if (!queries.includes(q)) queries.push(q);
  }

  if (!queries.length) {
    return { evidence: [], queries: [], engines: [], hits: 0, pages: 0, notes: ['没有构造出可用的检索词。'] };
  }

  const hits: Hit[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    if (isAborted(signal)) break;
    const result = await searchAny(query, signal);
    if (!result.hits.length) notes.push(...result.errors.filter((e) => !e.endsWith('无结果')));
    for (const hit of result.hits) {
      const key = dedupeKey(hit.url);
      if (seen.has(key)) continue;
      if (SKIP_HOSTS.some((h) => hit.url.includes(h))) continue;
      seen.add(key);
      engines.add(hit.via);
      hits.push({ ...hit, query });
    }
    if (hits.length >= plan.evidence) break;
  }

  if (!hits.length) {
    notes.push('本地检索没有取到结果（可能被限流或断网），本次核查仅依据模型知识。');
    return { evidence: [], queries, engines: [...engines], hits: 0, pages: 0, notes };
  }

  // 直接来自搜索片段的证据先占位，抓正文的片段稍后替换
  const targets = hits.slice(0, plan.fetch);
  const excerpts = await Promise.all(
    targets.map((hit) => fetchExcerpt(hit.url, hit.query ?? queries[0], signal).catch(() => null)),
  );

  const evidence: Evidence[] = [];
  const pushEvidence = (hit: Hit, snippet: string) => {
    if (evidence.length >= plan.evidence) return;
    if (!/^https?:\/\//i.test(hit.url)) return;
    evidence.push({
      sid: `E${evidence.length + 1}`,
      title: truncate(hit.title || hostOf(hit.url), 90),
      url: hit.url,
      publisher: hostOf(hit.url),
      snippet: truncate(snippet || hit.snippet || hit.title, 460),
    });
  };

  targets.forEach((hit, i) => {
    if (excerpts[i]) pushEvidence(hit, excerpts[i] as string);
  });
  for (const hit of hits) {
    if (evidence.length >= plan.evidence) break;
    if (evidence.some((e) => dedupeKey(e.url) === dedupeKey(hit.url))) continue;
    pushEvidence(hit, hit.snippet);
  }

  const pages = excerpts.filter(Boolean).length;
  if (pages === 0) notes.push('命中了搜索结果，但正文抓取失败，证据仅来自搜索摘要。');

  return { evidence, queries, engines: [...engines], hits: hits.length, pages, notes };
}

/** 把证据整理成给模型的紧凑文本：每条一行来源 + 一段摘录 */
export function evidenceBlock(evidence: Evidence[]): string {
  if (!evidence.length) return '';
  return evidence
    .map((e) => `[${e.sid}] ${e.title}\nURL: ${e.url}\n摘录: ${e.snippet}`)
    .join('\n\n');
}

export function researchSupported(): boolean {
  // 网页端没有跨域豁免，DDG/Bing 会被浏览器拦掉，只剩 Wikipedia 可用
  return runtime() !== 'web';
}
