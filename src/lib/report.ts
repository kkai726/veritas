import type { RawCitation } from './providers';
import { buildMarkdown } from './markdown';
import type { Claim, ClaimVerdict, Paragraph, Report, Settings, Source } from './types';
import { clamp, countChars, dedupeKey, hostOf, truncate } from './utils';

const VERDICT_MAP: Record<string, ClaimVerdict> = {
  支持: 'supported',
  有据支持: 'supported',
  属实: 'supported',
  supported: 'supported',
  true: 'supported',
  部分支持: 'partial',
  部分属实: 'partial',
  存疑: 'partial',
  partial: 'partial',
  partly: 'partial',
  mixed: 'partial',
  缺证据: 'unsupported',
  缺乏证据: 'unsupported',
  无证据: 'unsupported',
  未被证实: 'unsupported',
  unsupported: 'unsupported',
  unproven: 'unsupported',
  矛盾: 'contradicted',
  与证据矛盾: 'contradicted',
  错误: 'contradicted',
  不实: 'contradicted',
  contradicted: 'contradicted',
  false: 'contradicted',
  无法核实: 'unknown',
  无法验证: 'unknown',
  unknown: 'unknown',
  unverifiable: 'unknown',
};

export function toVerdict(input: unknown, fallback: ClaimVerdict = 'unknown'): ClaimVerdict {
  if (typeof input !== 'string') return fallback;
  const key = input.trim().toLowerCase().replace(/[\s_]+/g, '');
  return VERDICT_MAP[input.trim()] ?? VERDICT_MAP[key] ?? fallback;
}

function str(value: unknown, max = 2000): string {
  return typeof value === 'string' ? truncate(value.trim(), max) : '';
}

function urlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'url' in item) return String((item as any).url ?? '').trim();
      return '';
    })
    .filter((u) => /^https?:\/\//i.test(u));
}

export interface BuildInput {
  json: any;
  raw: string;
  settings: Settings;
  providerName: string;
  citations: RawCitation[];
  searchUsed: boolean;
  inputType: 'text' | 'url';
  sourceUrl?: string;
  sourceTitle?: string;
  text: string;
  elapsedMs: number;
}

export function buildReport(input: BuildInput): Report {
  const { json, settings, inputType, sourceUrl } = input;

  const claimList = (raw: unknown): Claim[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        const text = str(item?.text, 400);
        if (!text) return null;
        return {
          text,
          verdict: toVerdict(item?.verdict ?? item?.status),
          note: str(item?.note ?? item?.reason, 600),
          sourceIds: [] as number[],
          rawSources: urlList(item?.sources ?? item?.urls),
        } as Claim & { rawSources: string[] };
      })
      .filter((c): c is Claim & { rawSources: string[] } => c !== null);
  };

  const rawParagraphs: any[] = Array.isArray(json?.paragraphs) ? json.paragraphs.slice(0, 20) : [];
  let paragraphs: (Paragraph & { rawSources: string[] })[] = rawParagraphs
    .map((item, i) => {
      const claims = claimList(item?.claims);
      const text = str(item?.text ?? item?.excerpt, 1200);
      if (!text && !claims.length) return null;
      const verdict = toVerdict(item?.verdict, 'unknown');
      const score = Number.isFinite(Number(item?.score)) ? clamp(Number(item.score)) : defaultScore(claims, verdict);
      return {
        index: i + 1,
        text: text || claims.map((c) => c.text).join('；'),
        score,
        verdict,
        summary: str(item?.summary ?? item?.analysis, 400),
        claims,
        sourceIds: [] as number[],
        rawSources: [] as string[],
      };
    })
    .filter((p): p is Paragraph & { rawSources: string[] } => p !== null);

  if (!paragraphs.length) {
    paragraphs = [
      {
        index: 1,
        text: truncate(input.text.replace(/\s+/g, ' ').trim(), 600),
        score: clamp(Number(json?.overallScore) || 50),
        verdict: 'unknown',
        summary: str(json?.tldr, 400) || '模型未返回分段结果。',
        claims: [],
        sourceIds: [],
        rawSources: [],
      },
    ];
  }
  paragraphs.forEach((p, i) => {
    p.index = i + 1;
  });

  /* ---------------------------------------------------- 来源池归并与编号 */
  const pool = new Map<string, Source>();
  const add = (rawUrl: string, title?: string, publisher?: string): number | null => {
    if (!/^https?:\/\//i.test(rawUrl)) return null;
    const key = dedupeKey(rawUrl);
    const existing = pool.get(key);
    if (existing) {
      if (!existing.title && title) existing.title = truncate(title, 180) || existing.title;
      if (!existing.publisher && publisher) existing.publisher = publisher;
      return existing.id;
    }
    const source: Source = {
      id: pool.size + 1,
      title: truncate(title || hostOf(rawUrl) || rawUrl, 180),
      url: rawUrl,
      publisher: publisher || hostOf(rawUrl),
      cited: [],
    };
    pool.set(key, source);
    return source.id;
  };

  if (Array.isArray(json?.sources)) {
    for (const s of json.sources) {
      const url = typeof s === 'string' ? s : typeof s?.url === 'string' ? s.url : '';
      if (url) add(url, typeof s?.title === 'string' ? s.title : undefined, typeof s?.publisher === 'string' ? s.publisher : undefined);
    }
  }
  for (const c of input.citations) add(c.url, c.title, c.publisher);

  for (const p of paragraphs) {
    for (const claim of p.claims) {
      const withRaw = claim as Claim & { rawSources?: string[] };
      const mapped = (withRaw.rawSources ?? [])
        .map((u) => add(u))
        .filter((id): id is number => id !== null);
      claim.sourceIds = Array.from(new Set(mapped));
      delete withRaw.rawSources;
      p.sourceIds.push(...claim.sourceIds);
    }
    p.sourceIds = Array.from(new Set(p.sourceIds));
  }

  const sources = Array.from(pool.values());
  for (const p of paragraphs) {
    for (const id of p.sourceIds) {
      const s = sources.find((x) => x.id === id);
      if (s && !s.cited.includes(p.index)) s.cited.push(p.index);
    }
  }

  // 被引用的来源排在前面，未直接引用的检索命中排在后面
  sources.sort((a, b) => {
    const aUsed = a.cited.length > 0 ? 0 : 1;
    const bUsed = b.cited.length > 0 ? 0 : 1;
    if (aUsed !== bUsed) return aUsed - bUsed;
    return a.id - b.id;
  });

  const idMap = new Map<number, number>();
  sources.forEach((s, i) => {
    idMap.set(s.id, i + 1);
    s.id = i + 1;
  });
  for (const p of paragraphs) {
    for (const claim of p.claims) {
      claim.sourceIds = Array.from(new Set(claim.sourceIds.map((id) => idMap.get(id) ?? id)));
    }
    p.sourceIds = Array.from(new Set(p.sourceIds.map((id) => idMap.get(id) ?? id)));
  }

  const allClaims = paragraphs.flatMap((p) => p.claims);
  const weighted = paragraphs.reduce((acc, p) => acc + p.score * Math.max(1, p.claims.length), 0);
  const weight = paragraphs.reduce((acc, p) => acc + Math.max(1, p.claims.length), 0);
  const computed = weight ? Math.round(weighted / weight) : 50;
  const overallScore = Number.isFinite(Number(json?.overallScore))
    ? clamp(Number(json.overallScore))
    : computed;

  const limitations = (Array.isArray(json?.limitations) ? json.limitations : [])
    .map((x: unknown) => str(x, 300))
    .filter(Boolean)
    .slice(0, 6);
  if (!input.searchUsed) {
    limitations.unshift('本次核查未接入联网检索，判断仅基于模型已有知识，时效性与细节可能有偏差。');
  }
  if (!sources.length) {
    limitations.push('未获得可引用的公开来源，建议人工补充一手资料核对。');
  }

  const title =
    str(json?.title, 60) ||
    (input.sourceTitle ? truncate(input.sourceTitle, 60) : '') ||
    truncate(input.text.replace(/\s+/g, ' ').trim(), 28) ||
    '未命名核查';

  const tldr = str(json?.tldr, 300) || '模型未给出总体结论，请参考下方的逐段分析。';

  const report: Report = {
    title,
    overallScore,
    tldr,
    paragraphs: paragraphs.map(({ rawSources: _drop, ...p }) => p) as Paragraph[],
    sources,
    limitations,
    meta: {
      provider: settings.provider,
      providerName: input.providerName,
      model: settings.model,
      searchUsed: input.searchUsed,
      inputType,
      sourceUrl,
      elapsedMs: input.elapsedMs,
      createdAt: new Date().toISOString(),
      wordCount: allClaims.length,
      chars: countChars(input.text),
    },
    markdown: '',
    raw: input.raw,
  };

  report.markdown = buildMarkdown(report);
  return report;
}

function defaultScore(claims: Claim[], verdict: ClaimVerdict): number {
  if (!claims.length) {
    return verdict === 'contradicted' ? 25 : verdict === 'unsupported' ? 50 : 60;
  }
  const per: Record<ClaimVerdict, number> = {
    supported: 92,
    partial: 70,
    unsupported: 48,
    contradicted: 18,
    unknown: 55,
  };
  return clamp(Math.round(claims.reduce((a, c) => a + per[c.verdict], 0) / claims.length));
}
