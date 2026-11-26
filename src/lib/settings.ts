import type { ProviderId, Settings } from './types';

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  blurb: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  supportsSearch: boolean;
  searchLabel: string;
  keyUrl: string;
  keyHint: string;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    blurb: 'Responses API + 内置 web_search，来源为官方引用标注。',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-5', 'gpt-5-mini'],
    supportsSearch: true,
    searchLabel: 'web_search 工具',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    blurb: 'Google Search 落地（grounding），来源取自 grounding metadata。',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    supportsSearch: true,
    searchLabel: 'Google 搜索接地',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    blurb: 'Sonar 系列自带实时联网检索，返回结构化引用。',
    baseUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar-pro',
    models: ['sonar-pro', 'sonar', 'sonar-reasoning-pro'],
    supportsSearch: true,
    searchLabel: 'Sonar 实时检索',
    keyUrl: 'https://www.perplexity.ai/settings/api',
    keyHint: 'pplx-…',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    blurb: '一个 Key 打通多模型；开启 :online 后缀即可联网取证。',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4.1',
    models: [
      'openai/gpt-4.1',
      'google/gemini-2.5-pro',
      'anthropic/claude-sonnet-4',
      'deepseek/deepseek-chat-v3.1',
    ],
    supportsSearch: true,
    searchLabel: ':online 联网',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-…',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    blurb: '纯模型判断，无实时检索，仅依据训练知识做一致性与常识核对。',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    supportsSearch: false,
    searchLabel: '无联网',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk-…',
  },
  {
    id: 'custom',
    name: '自定义',
    blurb: '任何 OpenAI 兼容网关（vLLM、OneAPI、自建代理、企业网关）。',
    baseUrl: '',
    defaultModel: '',
    models: [],
    supportsSearch: false,
    searchLabel: '取决于网关',
    keyUrl: '',
    keyHint: '你的 Key',
  },
];

export function presetOf(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

const STORAGE_KEY = 'veritas.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  model: 'gpt-4.1',
  apiKey: '',
  baseUrl: '',
  search: true,
  depth: 'standard',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const provider = parsed.provider && PROVIDERS.some((p) => p.id === parsed.provider)
      ? parsed.provider
      : DEFAULT_SETTINGS.provider;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      provider,
      model: parsed.model || presetOf(provider).defaultModel,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 隐私模式下写入失败时静默降级 */
  }
}

export function resolveBaseUrl(settings: Settings): string {
  if (settings.provider === 'custom') return settings.baseUrl.replace(/\/+$/, '');
  return presetOf(settings.provider).baseUrl.replace(/\/+$/, '');
}

export function isConfigured(settings: Settings): boolean {
  if (!settings.apiKey.trim()) return false;
  if (!settings.model.trim()) return false;
  if (settings.provider === 'custom' && !settings.baseUrl.trim()) return false;
  return true;
}
