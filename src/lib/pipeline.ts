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

/** 阶段进度回调：label 是给人看的一句话，done/total 用来画进度条 */
export type StageReporter = (stage: Stage, label?: string, done?: number, total?: number) => void;

export interface FactCheckInput {
  settings: Settings;
  input: string;
  mode: 'auto' | 'text' | 'url';
  onStage?: StageReporter;
  signal?: AbortSignal;
  /** 暂停门：每个耗时步骤之前 await 一次 */
  checkpoint?: () => Promise<void>;
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

/** 交给模型的正文上限：再长只会拖慢速度、提高截断风险 */
const MAX_INPUT_CHARS = 24_000;

export async function factCheck({ settings, input, mode, onStage, signal, checkpoint }: FactCheckInput): Promise<Report> {
  const started = performance.now();
  const raw = input.trim();
  if (countChars(raw) < 20) throw new Error('内容太短了，至少需要 20 个字符才有核查价值。');

  const gate = checkpoint ?? (async () => {});
  const report = (stage: Stage, label?: string, done?: number, total?: number) =>
    onStage?.(stage, label, done, total);

  const treatAsUrl = mode === 'url' || (mode === 'auto' && looksLikeUrl(raw));

  let text = raw;
  let sourceUrl: string | undefined;
  let sourceTitle: string | undefined;
  let extractMs = 0;

  await gate();
  if (treatAsUrl) {
    report('extract', '抓取页面正文…');
    const t0 = performance.now();
    const page = await extractFromUrl(raw);
    text = page.text;
    sourceUrl = normalizeUrl(raw);
    sourceTitle = page.title;
    if (countChars(text) < 80) throw new Error('抓取到的正文过短，可能是登录页或反爬页面，请直接粘贴文本。');
    extractMs = Math.round(performance.now() - t0);
  }

  const provider = settings.activeId;
  const preset = presetOf(provider);
  const config = configOf(settings);

  if (text.length > MAX_INPUT_CHARS) {
    text = `${text.slice(0, MAX_INPUT_CHARS)}\n\n（原文过长，已截取前 ${MAX_INPUT_CHARS} 字核查）`;
  }

  // 1. 应用内检索：自己抓来源，模型只做判断
  await gate();
  report('research', '拆分段落，准备检索…', 0, 1);
  const paragraphs = splitParagraphs(text);
  const tResearch = performance.now();
  const found = await research(paragraphs, settings.depth, signal, {
    checkpoint: gate,
    onProgress: (label, done, total) => report('research', label, done, total),
  });
  const researchMs = Math.round(performance.now() - tResearch);
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
  await gate();
  report('analyze', hasEvidence ? `把 ${found.evidence.length} 条证据交给模型判断…` : '模型依据已有知识判断…');
  const tModel = performance.now();
  const result = await runModel({
    provider,
    config,
    system,
    user,
    signal,
    allowModelSearch: !hasEvidence,
    maxTokens: settings.depth === 'quick' ? 4000 : settings.depth === 'standard' ? 6000 : 8000,
  });

  let json: any;
  try {
    json = extractJson(result.text);
  } catch (err) {
    if (!(err instanceof ParseError) && !looksLikeJson(result.text)) throw err;
    await gate();
    report('analyze', '输出格式有误，正在修复 JSON…');
    const repaired = await runModel({
      provider,
      config,
      system: '你是一个 JSON 修复器，只输出修正后的 JSON。',
      user: buildRepairPrompt(result.text),
      signal,
      allowModelSearch: false,
      maxTokens: 4000,
    });
    if (!repaired.text.trim()) throw err;
    json = extractJson(repaired.text);
  }
  const modelMs = Math.round(performance.now() - tModel);

  await gate();
  report('compose', '整理来源与 Markdown…');
  const built = buildReport({
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
    timings: {
      extractMs,
      researchMs,
      modelMs,
    },
  });

  for (const note of [...found.notes, ...result.notes]) {
    if (!built.limitations.includes(note)) built.limitations.push(note);
  }

  return built;
}
