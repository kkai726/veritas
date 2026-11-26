import { extractFromUrl } from './extract';
import { ParseError, extractJson, looksLikeJson } from './parse';
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from './prompt';
import { runModel } from './providers';
import { buildReport } from './report';
import { configOf, presetOf } from './settings';
import type { Report, Settings } from './types';
import { countChars, looksLikeUrl, normalizeUrl } from './utils';

export type Stage = 'extract' | 'research' | 'analyze' | 'compose';

export const STAGE_TEXT: Record<Stage, string> = {
  extract: '读取链接正文',
  research: '联网检索来源',
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

export async function factCheck({ settings, input, mode, onStage, signal }: FactCheckInput): Promise<Report> {
  const started = performance.now();
  const raw = input.trim();
  if (countChars(raw) < 20) throw new Error('内容太短了，至少需要 20 个字符才有核查价值。');

  const treatAsUrl = mode === 'url' || (mode === 'auto' && looksLikeUrl(raw));

  onStage?.('extract');
  let text = raw;
  let sourceUrl: string | undefined;
  let sourceTitle: string | undefined;

  if (treatAsUrl) {
    const page = await extractFromUrl(raw);
    text = page.text;
    sourceUrl = normalizeUrl(raw);
    sourceTitle = page.title;
    if (countChars(text) < 80) throw new Error('抓取到的正文过短，可能是登录页或反爬页面，请直接粘贴文本。');
  }

  const provider = settings.activeId;
  const preset = presetOf(provider);
  const config = configOf(settings, provider);
  const searchEnabled = settings.search && preset.supportsSearch;
  const system = buildSystemPrompt(settings, searchEnabled);
  const user = buildUserPrompt({ text, url: sourceUrl, title: sourceTitle });

  onStage?.(searchEnabled ? 'research' : 'analyze');
  const result = await runModel({ provider, config, system, user, signal });

  onStage?.('analyze');
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
    });
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
    searchUsed: result.searchUsed && searchEnabled,
    inputType: treatAsUrl ? 'url' : 'text',
    sourceUrl,
    sourceTitle,
    text,
    elapsedMs: Math.round(performance.now() - started),
  });

  if (result.notes.length) {
    report.limitations.push(...result.notes);
  }

  return report;
}
