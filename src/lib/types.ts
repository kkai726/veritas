export type ProviderId = 'deepseek' | 'mimo' | 'glm' | 'kimi' | 'openai' | 'custom';

/** 单个服务商的连接配置（Key 按服务商分别缓存） */
export interface ProviderConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
}

/** 连接测试通过后记下时间与模型，之后的核查不再重复验证 */
export interface VerifiedMark {
  model: string;
  at: string;
}

export interface Settings {
  /** 已配置过的服务商；未出现即未配置 */
  configs: Partial<Record<ProviderId, ProviderConfig>>;
  /** 已测通的服务商 */
  verified: Partial<Record<ProviderId, VerifiedMark>>;
  /** 当前选中的服务商 */
  activeId: ProviderId;
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

export interface EvidenceStat {
  queries: number;
  hits: number;
  pages: number;
  engines: string[];
}

export interface ReportMeta {
  provider: ProviderId;
  providerName: string;
  model: string;
  /** 本次是否为模型自带联网（仅 OpenAI 回退时出现） */
  searchUsed: boolean;
  inputType: 'text' | 'url';
  sourceUrl?: string;
  elapsedMs: number;
  createdAt: string;
  wordCount: number;
  chars: number;
  evidence?: EvidenceStat;
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
