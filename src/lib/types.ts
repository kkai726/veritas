export type ProviderId =
  | 'openai'
  | 'gemini'
  | 'perplexity'
  | 'openrouter'
  | 'deepseek'
  | 'custom';

export interface Settings {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  search: boolean;
  depth: 'quick' | 'standard' | 'deep';
}

export interface Source {
  id: number;
  title: string;
  url: string;
  publisher: string;
  cited: number[];
}

export type ClaimVerdict = 'supported' | 'partial' | 'unsupported' | 'contradicted' | 'unknown';

export interface Claim {
  text: string;
  verdict: ClaimVerdict;
  note: string;
  sourceIds: number[];
}

export interface Paragraph {
  index: number;
  text: string;
  score: number;
  verdict: ClaimVerdict;
  summary: string;
  claims: Claim[];
  sourceIds: number[];
}

export interface ReportMeta {
  provider: ProviderId;
  providerName: string;
  model: string;
  searchUsed: boolean;
  inputType: 'text' | 'url';
  sourceUrl?: string;
  elapsedMs: number;
  createdAt: string;
  wordCount: number;
  chars: number;
}

export interface Report {
  title: string;
  overallScore: number;
  tldr: string;
  paragraphs: Paragraph[];
  sources: Source[];
  limitations: string[];
  meta: ReportMeta;
  markdown: string;
  raw: string;
}

export const VERDICT_LABEL: Record<ClaimVerdict, string> = {
  supported: '有据支持',
  partial: '部分支持',
  unsupported: '缺乏证据',
  contradicted: '与证据矛盾',
  unknown: '无法核实',
};

export const SCORE_BANDS = [
  { min: 85, label: '高度可信', tone: 'good' },
  { min: 70, label: '大体可信', tone: 'good' },
  { min: 55, label: '部分存疑', tone: 'warn' },
  { min: 35, label: '可信度低', tone: 'bad' },
  { min: 0, label: '不可靠', tone: 'bad' },
] as const;

export function bandOf(score: number) {
  return SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}
