import { extractFromUrl } from './extract';
import { ParseError, extractJson, looksLikeJson } from './parse';
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from './prompt';
import { runModel } from './providers';
import { buildReport } from './report';
import { evidenceBlock, research } from './research';
import { configOf, presetOf } from './settings';
import type { Report, Settings } from './types';
import { countChars, looksLikeUrl, normalizeUrl } from './utils';

export type Stage = 'verify' | 'extract' | 'research' | 'analyze' | 'compose';

export const STAGE_TEXT: Record<Stage, string> = {
  verify: '验证模型可用',
  extract: '读取链接正文',
  research: '检索公开来源',
  analyze: '逐段比对证据',
  compose: '生成核查报告',
};

export interface FactCheckInput {
  settings: Settings;
  input: string;
  mode: 'auto' | 'text' | 'url';
  onStage?: (stage: Stage) => void;
  signal?: AbortSignal;
}

/** 把正文切成用于构造检索词的段落，短行合并，超长段按句号再切 */
export function splitParagraphs(text: string, limit = 14): string[] {
  const blocks = text
    .split(/\n{2,}/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 20);

  const source = blocks.length >= 2 ? blocks : text.split(/\n/).map((s) => s.trim()).filter((s) => s.length >= 20);

  const out: string[] = [];
  for (const block of source.length ? source : [text.replace(/\s+/g, ' ').trim()]) {
    if (block.length <= 320) {
      out.push(block);
      continue;
    }
    let buffer = '';
    for (const sentence of block.split(/(?<=[。！？!?])\s*/)) {
      if ((buffer + sentence).length > 320 && buffer) {
        out.push(buffer.trim());
        buffer = sentence;
      } else {
        buffer += sentence;
      }
    }
    if (buffer.trim()) out.push(buffer.trim());
  }
  return out.filter(Boolean).slice(0, limit);
}

export async function factCheck({ settings, input, mode, onStage, signal }: FactCheckInput): Promise<Report> {
  const started = performance.now();
  const raw = input.trim();
  if (countChars(raw) < 20) throw new Error('内容太短了，至少需要 20 个字符才有核查价值。');

  const treatAsUrl = mode === 'url' || (mode === 'auto' && looksLikeUrl(raw));

  let text = raw;
  let sourceUrl: string | undefined;
  let sourceTitle: string | undefined;

  if (treatAsUrl) {
    onStage?.('extract');
    const page = await extractFromUrl(raw);
    text = page.text;
    sourceUrl = normalizeUrl(raw);
    sourceTitle = page.title;
    if (countChars(text) < 80) throw new Error('抓取到的正文过短，可能是登录页或反爬页面，请直接粘贴文本。');
  }

  const provider = settings.activeId;
  const preset = presetOf(provider);
  const config = configOf(settings, provider);

  // 1. 应用内检索：自己抓来源，模型只做判断
  onStage?.('research');
  const paragraphs = splitParagraphs(text);
  const found = await research(paragraphs, settings.depth, signal);
  const hasEvidence = found.evidence.length > 0;

  const system = buildSystemPrompt(settings, {
    hasEvidence,
    modelSearch: !hasEvidence && preset.supportsSearch,
  });
  const user = buildUserPrompt({
    text,
    url: sourceUrl,
    title: sourceTitle,
    evidence: evidenceBlock(found.evidence),
  });

  // 2. 模型只负责判断与写判定
  onStage?.('analyze');
  const result = await runModel({
    provider,
    config,
    system,
    user,
    signal,
    allowModelSearch: !hasEvidence,
  });

  let json: any;
  try {
    json = extractJson(result.text);
  } catch (err) {
    if (!(err instanceof ParseError) && !looksLikeJson(result.text)) throw err;
    const repaired = await runModel({
      provider,
      config,
      system: '你是一个 JSON 修复器，只输出修正后的 JSON。',
      user: buildRepairPrompt(result.text),
      signal,
      allowModelSearch: false,
    });
    if (!repaired.text.trim()) throw err;
    json = extractJson(repaired.text);
  }

  onStage?.('compose');
  const report = buildReport({
    json,
    raw: result.text,
    provider,
    model: config.model,
    providerName: preset.name,
    citations: result.citations,
    searchUsed: result.searchUsed,
    inputType: treatAsUrl ? 'url' : 'text',
    sourceUrl,
    sourceTitle,
    text,
    elapsedMs: Math.round(performance.now() - started),
    evidence: found.evidence,
    evidenceStat: {
      queries: found.queries.length,
      hits: found.hits,
      pages: found.pages,
      engines: found.engines,
    },
  });

  for (const note of [...found.notes, ...result.notes]) {
    if (!report.limitations.includes(note)) report.limitations.push(note);
  }

  return report;
}
