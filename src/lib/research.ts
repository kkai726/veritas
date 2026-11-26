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
 * 性能取舍（v1.2）：
 *  - 查询词按 3 条一批并发，命中够了就跳过剩下的批次；
 *  - 搜索页与正文页都做进程内缓存，同一段文字再核查一次几乎瞬时；
 *  - 正文用 Jina Reader 与直抓同时发起，谁先给出可用文本用谁，
 *    单篇最坏等待从 20s+12s 降到 9s；
 *  - 抓下来的文本缓存原文而不是摘录，换查询词时不需要重新下载。
 */

import type { Settings } from './types';
import { authorityOf } from './authority';
import type { AuthorityInfo } from './authority';
import { getText, runtime } from './transport';
import { dedupeKey, hostOf, truncate } from './utils';

export interface Evidence {
  sid: string;
  title: string;
  url: string;
  publisher: string;
  snippet: string;
  /** 来源命中权威名录时的性质，用来给模型加权、并在界面上打标 */
  authority?: AuthorityInfo;
}

export interface ResearchResult {
  evidence: Evidence[];
  queries: string[];
  engines: string[];
  hits: number;
  pages: number;
  notes: string[];
}

export interface ResearchHooks {
  /** 暂停门：每批请求之前 await 一次 */
  checkpoint?: () => Promise<void>;
  onProgress?: (label: string, done?: number, total?: number) => void;
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
  quick: { queries: 3, fetch: 2, evidence: 7 },
  standard: { queries: 6, fetch: 4, evidence: 12 },
  deep: { queries: 10, fetch: 6, evidence: 16 },
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
    timeoutMs: 9_000,
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
    timeoutMs: 9_000,
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
    timeoutMs: 8_000,
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

  type EngineResult = { name: string; hits: Hit[]; error?: string };
  const errors: string[] = [];

  const attempt = (engine: { name: string; run: (q: string) => Promise<Hit[]> }): Promise<EngineResult> =>
    engine.run(query).then(
      (hits) => ({ name: engine.name, hits }),
      (err) => ({
        name: engine.name,
        hits: [] as Hit[],
        error: err instanceof Error ? err.message : String(err),
      }),
    );

  // 前两个引擎并行抢答：单个被限流时不用等它超时，直接走另一个
  let race: EngineResult = await Promise.race([attempt(engines[0]), attempt(engines[1])]);
  if (!race.hits.length) {
    errors.push(race.error ? `${race.name}: ${race.error}` : `${race.name}: 无结果`);
    race = await attempt(engines[2]);
    if (!race.hits.length) {
      errors.push(race.error ? `${race.name}: ${race.error}` : `${race.name}: 无结果`);
    }
  }

  if (race.hits.length) return { hits: race.hits, errors };
  return { hits: [], errors };
}

/* -------------------------------------------------------------------- 缓存 */

interface SearchCacheEntry {
  at: number;
  hits: Hit[];
  errors: string[];
}

const SEARCH_TTL = 10 * 60_000;
const PAGE_TTL = 60 * 60_000;
const CACHE_MAX = 60;

const searchCache = new Map<string, SearchCacheEntry>();
const pageCache = new Map<string, { at: number; text: string }>();

function cacheGet<T>(map: Map<string, { at: number } & T>, key: string, ttl: number): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) {
    map.delete(key);
    return null;
  }
  return hit as unknown as T;
}

function cacheSet<T>(map: Map<string, { at: number } & T>, key: string, value: T, max = CACHE_MAX) {
  map.set(key, { at: Date.now(), ...value });
  if (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
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

function bestExcerpt(text: string, query: string, limit = 380): string {
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

/** 拿页面纯文本：Jina Reader 与直抓同时跑，谁先给出可用文本就用谁，都失败则 null */
async function fetchPageText(url: string, signal?: AbortSignal): Promise<string | null> {
  const cached = cacheGet(pageCache, url, PAGE_TTL);
  if (cached?.text) return cached.text;

  const cleanJina = (raw: string) =>
    raw
      .split('\n')
      .filter((line) => !/^(Title|URL Source|Published Time|Markdown Content|Warning|Image \d+):?/i.test(line.trim()))
      .join('\n');

  const jina = getText(`https://r.jina.ai/${url}`, {
    timeoutMs: 7_000,
    signal,
    headers: { Accept: 'text/plain', 'User-Agent': UA },
  })
    .then((res) => (res.status === 200 && res.text.length > 400 ? stripTags(cleanJina(res.text)) : null))
    .catch(() => null);

  const direct = getText(url, {
    timeoutMs: 7_000,
    signal,
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  })
    .then((res) => (res.status === 200 ? stripTags(res.text) : null))
    .catch(() => null);

  const [fromJina, fromDirect] = await Promise.all([jina, direct]);
  const text = fromJina && fromJina.length > 500 ? fromJina : fromDirect ?? fromJina;
  if (text && text.length > 200) {
    cacheSet(pageCache, url, { text: text.slice(0, 40_000) }, 24);
    return text;
  }
  return null;
}

/* -------------------------------------------------------------------- 主流程 */

export async function research(
  paragraphTexts: string[],
  depth: Settings['depth'],
  signal?: AbortSignal,
  hooks: ResearchHooks = {},
): Promise<ResearchResult> {
  const plan = PLAN[depth];
  const notes: string[] = [];
  const engines = new Set<string>();
  const queries: string[] = [];
  const gate = hooks.checkpoint ?? (async () => {});
  const progress = hooks.onProgress ?? (() => {});

  // 长文按段落轮流取查询词：先第一轮覆盖所有段落，再回头补第二轮的细查询
  const perParagraph = paragraphTexts.map((p) => queriesFor(p, 2));
  const flat: string[] = [];
  for (let round = 0; round < 2; round += 1) {
    for (const list of perParagraph) {
      const q = list[round];
      if (q && !flat.includes(q)) flat.push(q);
    }
  }

  // 段落多于查询预算时均匀抽样，保证文档从头到尾都有代表，
  // 而不是只查前几段、让后面的主张一条来源都挂不上
  if (flat.length <= plan.queries) {
    queries.push(...flat);
  } else {
    const stride = flat.length / plan.queries;
    for (let i = 0; i < plan.queries; i += 1) {
      const q = flat[Math.min(flat.length - 1, Math.floor(i * stride))];
      if (q && !queries.includes(q)) queries.push(q);
    }
  }

  if (!queries.length) {
    return { evidence: [], queries: [], engines: [], hits: 0, pages: 0, notes: ['没有构造出可用的检索词。'] };
  }

  const hits: Hit[] = [];
  const seen = new Set<string>();
  const targetHits = Math.max(3, Math.ceil(plan.evidence * 0.6));
  let searched = 0;

  // 一次并发 3 条查询；命中数量够了就不再打剩下的批次（省时间也省对方的额度）
  for (let i = 0; i < queries.length; i += 3) {
    if (isAborted(signal)) break;
    if (hits.length >= targetHits) break;
    await gate();

    const batch = queries.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(async (query) => {
        const cached = cacheGet(searchCache, query.toLowerCase(), SEARCH_TTL);
        if (cached) return { query, hits: cached.hits, errors: cached.errors, cached: true };
        const result = await searchAny(query, signal);
        cacheSet(searchCache, query.toLowerCase(), result);
        return { query, ...result, cached: false };
      }),
    );

    for (const result of results) {
      searched += 1;
      if (!result.hits.length) {
        notes.push(...result.errors.filter((e) => !e.endsWith('无结果')));
        continue;
      }
      for (const hit of result.hits) {
        const key = dedupeKey(hit.url);
        if (seen.has(key)) continue;
        if (SKIP_HOSTS.some((h) => hit.url.includes(h))) continue;
        seen.add(key);
        engines.add(hit.via);
        hits.push({ ...hit, query: result.query });
      }
    }

    progress(`检索 ${searched}/${queries.length} 条查询 · 命中 ${hits.length} 条`, searched, queries.length);
  }

  if (!hits.length) {
    notes.push('本地检索没有取到结果（可能被限流或断网），本次核查仅依据模型知识。');
    return { evidence: [], queries, engines: [...engines], hits: 0, pages: 0, notes };
  }

  // 抓正文时权威来源优先，其次尽量覆盖不同站点，避免 6 篇全来自同一家
  const ordered = hits
    .map((hit, i) => ({ hit, i, score: authorityOf(hit.url)?.score ?? 0.5 }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.hit);

  const targets: Hit[] = [];
  const hostSeen = new Set<string>();
  for (const hit of ordered) {
    if (targets.length >= plan.fetch) break;
    const host = hostOf(hit.url);
    if (hostSeen.has(host) && hits.length > plan.fetch * 2) continue;
    hostSeen.add(host);
    targets.push(hit);
  }

  // 摘要已经包含查询里的大部分词时，没必要再下载整页：直接省掉一次请求
  const richSnippet = (hit: Hit, query: string) => {
    if (hit.snippet.length < 120) return false;
    const wanted = tokens(query);
    const own = tokens(hit.snippet);
    let overlap = 0;
    for (const t of wanted) if (own.has(t)) overlap += 1;
    return overlap >= Math.max(2, Math.ceil(wanted.size * 0.3));
  };

  const planFetch = targets.filter((hit, i) => i < 2 || !richSnippet(hit, hit.query ?? queries[0]));
  let fetched = 0;
  progress(`精读 ${planFetch.length} 篇候选页面…`, 0, planFetch.length);
  const wanted = new Set(planFetch.map((h) => h.url));
  const texts = await Promise.all(
    targets.map(async (hit) => {
      if (!wanted.has(hit.url)) return null;
      const text = await fetchPageText(hit.url, signal);
      if (text) {
        fetched += 1;
        progress(`精读 ${fetched}/${planFetch.length} 篇`, fetched, planFetch.length);
      }
      return text;
    }),
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
      snippet: truncate(snippet || hit.snippet || hit.title, 340),
      authority: authorityOf(hit.url) ?? undefined,
    });
  };

  targets.forEach((hit, i) => {
    const text = texts[i];
    if (text) pushEvidence(hit, bestExcerpt(text, hit.query ?? queries[0]));
  });
  for (const hit of hits) {
    if (evidence.length >= plan.evidence) break;
    if (evidence.some((e) => dedupeKey(e.url) === dedupeKey(hit.url))) continue;
    pushEvidence(hit, hit.snippet);
  }

  const pages = texts.filter(Boolean).length;
  if (pages === 0) notes.push('命中了搜索结果，但正文抓取失败，证据仅来自搜索摘要。');

  return { evidence, queries, engines: [...engines], hits: hits.length, pages, notes };
}

/**
 * 二次定向检索：模型判定「缺证据 / 无法核实」且没有挂来源的主张，
 * 用主张原文再查一次，补上第一轮没覆盖到的来源。
 *
 * 只补来源，不改判定——模型说「缺证据」可能是它没看到相关来源，
 * 也可能是证据确实不支持，交给上层按词面匹配决定是否挂链接。
 */
export async function researchClaims(
  claims: string[],
  depth: Settings['depth'],
  opts: {
    signal?: AbortSignal;
    checkpoint?: () => Promise<void>;
    exclude?: Set<string>;
    startAt?: number;
    onProgress?: (label: string) => void;
  } = {},
): Promise<Evidence[]> {
  const clean = claims
    .map((c) => c.replace(/\s+/g, ' ').trim())
    .filter((c) => c.length >= 8)
    .slice(0, depth === 'deep' ? 4 : 3);
  if (!clean.length) return [];

  const gate = opts.checkpoint ?? (async () => {});
  const exclude = opts.exclude ?? new Set<string>();
  // 整句当检索词太长，命中率反而低：先按候选词抽取，取不到再退回原句
  const queries = Array.from(
    new Set(clean.map((c) => queriesFor(c, 1)[0] || truncate(c, 40))),
  ).slice(0, 3);

  await gate();
  opts.onProgress?.(`补检 ${queries.length} 条没有来源的主张…`);

  const results = await Promise.all(
    queries.map(async (query) => {
      const cached = cacheGet(searchCache, query.toLowerCase(), SEARCH_TTL);
      if (cached) return cached.hits;
      const result = await searchAny(query, opts.signal);
      cacheSet(searchCache, query.toLowerCase(), result);
      return result.hits;
    }),
  );

  const hits: Hit[] = [];
  const seen = new Set(exclude);
  for (const list of results) {
    for (const hit of list) {
      if (!/^https?:\/\//i.test(hit.url)) continue;
      const key = dedupeKey(hit.url);
      if (seen.has(key)) continue;
      if (SKIP_HOSTS.some((h) => hit.url.includes(h))) continue;
      seen.add(key);
      hits.push(hit);
    }
  }
  if (!hits.length) return [];

  const targets = hits.slice(0, 2);
  const texts = await Promise.all(
    targets.map((hit) => fetchPageText(hit.url, opts.signal).catch(() => null)),
  );

  return targets.map((hit, i) => {
    const text = texts[i];
    return {
      sid: `E${(opts.startAt ?? 0) + i + 1}`,
      title: truncate(hit.title || hostOf(hit.url), 90),
      url: hit.url,
      publisher: hostOf(hit.url),
      snippet: truncate(text ? bestExcerpt(text, hit.query ?? queries[0]) : hit.snippet || hit.title, 340),
      authority: authorityOf(hit.url) ?? undefined,
    };
  });
}

/** 把证据整理成给模型的紧凑文本：每条一行来源 + 一段摘录 + 权威标记 */
export function evidenceBlock(evidence: Evidence[]): string {
  if (!evidence.length) return '';
  return evidence
    .map((e) => {
      const tag = e.authority ? `·${e.authority.label}` : '·一般网页';
      return `[${e.sid}${tag}] ${e.title}\nURL: ${e.url}\n摘录: ${e.snippet}`;
    })
    .join('\n\n');
}

export function researchSupported(): boolean {
  // 网页端没有跨域豁免，DDG/Bing 会被浏览器拦掉，只剩 Wikipedia 可用
  return runtime() !== 'web';
}
