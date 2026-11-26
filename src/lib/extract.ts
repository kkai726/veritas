import { normalizeUrl } from './utils';

export interface Extracted {
  title: string;
  text: string;
  siteName: string;
  url: string;
  via: string;
}

const MAX_CHARS = 26_000;

function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function clip(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return `${text.slice(0, MAX_CHARS)}\n\n（正文过长，已截取前 ${MAX_CHARS} 字符进行分析）`;
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms = 25_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** 通过 Jina Reader 把网页转成干净的 Markdown，无需 Key，且允许跨域。 */
async function viaJina(url: string): Promise<Extracted> {
  return withTimeout(async (signal) => {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal,
      headers: { Accept: 'text/plain' },
    });
    if (!res.ok) throw new Error(`Jina Reader ${res.status}`);
    const raw = await res.text();
    if (raw.trim().length < 200) throw new Error('正文过短');

    let title = '';
    const titleMatch = raw.match(/^Title:\s*(.+)$/m);
    if (titleMatch) title = titleMatch[1].trim();

    const body = raw
      .split('\n')
      .filter((line) => !/^(Title|URL Source|Published Time|Markdown Content|Warning):/i.test(line.trim()))
      .join('\n');

    return {
      title,
      text: clip(tidy(body)),
      siteName: '',
      url,
      via: 'Jina Reader',
    };
  });
}

/** 兜底：公共 CORS 代理 + 浏览器端解析正文。 */
async function viaProxy(url: string): Promise<Extracted> {
  return withTimeout(async (signal) => {
    const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, { signal });
    if (!res.ok) throw new Error(`代理 ${res.status}`);
    const html = await res.text();
    if (!html || html.length < 200) throw new Error('返回内容为空');

    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript,svg,iframe,form,nav,footer,aside,header').forEach((n) => n.remove());

    const title =
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
      doc.title.trim();
    const siteName =
      doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() || '';

    const candidates = Array.from(
      doc.querySelectorAll('article, main, [role="main"], .post, .article, .content, #content, .markdown-body'),
    );
    candidates.push(doc.body);

    let best = '';
    for (const node of candidates) {
      if (!node) continue;
      const blocks = Array.from(node.querySelectorAll('p, li, h1, h2, h3, blockquote'))
        .map((el) => el.textContent?.trim() ?? '')
        .filter((t) => t.length > 30);
      const text = blocks.join('\n\n');
      if (text.length > best.length) best = text;
    }
    if (best.length < 120) throw new Error('未能提取到正文');

    return { title, text: clip(tidy(best)), siteName, url, via: '公共代理' };
  });
}

export async function extractFromUrl(input: string): Promise<Extracted> {
  const url = normalizeUrl(input);
  const errors: string[] = [];

  for (const attempt of [viaJina, viaProxy]) {
    try {
      const result = await attempt(url);
      if (result.text.length < 120) throw new Error('正文过短');
      return { ...result, title: result.title || url };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  throw new Error(
    `无法读取该链接（${errors.join(' / ')}）。请确认链接可公开访问，或直接粘贴正文文本。`,
  );
}
