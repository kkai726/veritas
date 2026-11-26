import type { ProviderConfig, ProviderId, Settings } from './types';

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  short: string;
  blurb: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  supportsSearch: boolean;
  keyUrl: string;
  keyHint: string;
  group: 'main' | 'custom';
}

/**
 * 只保留国内可直连、且都能被 OpenAI 协议覆盖的服务商。
 * Gemini / Perplexity / OpenRouter 之类的其余选择，走「自定义」填地址即可。
 */
export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    short: 'DeepSeek',
    blurb: '推理与中文理解稳，价格低。',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    supportsSearch: false,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk-…',
    group: 'main',
  },
  {
    id: 'mimo',
    name: 'MiMo',
    short: 'MiMo',
    blurb: '小米 MiMo，原生多模态。',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2.6-pro',
    models: ['mimo-v2.6-pro', 'mimo-v2.5-pro', 'mimo-v2-flash'],
    supportsSearch: false,
    keyUrl: 'https://platform.xiaomimimo.com',
    keyHint: 'sk-…',
    group: 'main',
  },
  {
    id: 'glm',
    name: 'GLM',
    short: 'GLM',
    blurb: '智谱 GLM，中文资料与工具调用。',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.6',
    models: ['glm-4.6', 'glm-4.5-air', 'glm-5.4', 'glm-5.3', 'glm-5.2'],
    supportsSearch: false,
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    keyHint: '形如 xxxx.yyyy',
    group: 'main',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    short: 'Kimi',
    blurb: '月之暗面，长文本见长。',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k3-1-pro',
    models: ['kimi-k3-1-pro', 'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2-0905-preview'],
    supportsSearch: false,
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    keyHint: 'sk-…',
    group: 'main',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    short: 'OpenAI',
    blurb: '唯一带官方联网检索（web_search）。',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-5', 'gpt-5-mini', 'gpt-4o'],
    supportsSearch: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
    group: 'main',
  },
  {
    id: 'custom',
    name: '自定义',
    short: '自定义',
    blurb: '任何 OpenAI 兼容网关：中转站、vLLM、Ollama、企业网关。',
    baseUrl: '',
    defaultModel: '',
    models: [],
    supportsSearch: false,
    keyUrl: '',
    keyHint: '你的 Key',
    group: 'custom',
  },
];

export const MAIN_PROVIDERS = PROVIDERS.filter((p) => p.group === 'main');

export function presetOf(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

const STORAGE_KEY = 'veritas.settings.v2';
const LEGACY_KEY = 'veritas.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  configs: {},
  activeId: 'deepseek',
  search: true,
  depth: 'standard',
};

export function configOf(settings: Settings, id: ProviderId = settings.activeId): ProviderConfig {
  const preset = presetOf(id);
  const saved = settings.configs[id];
  return {
    model: saved?.model || preset.defaultModel,
    apiKey: saved?.apiKey || '',
    baseUrl: saved?.baseUrl || '',
  };
}

export function isConfigured(settings: Settings, id: ProviderId = settings.activeId): boolean {
  const config = configOf(settings, id);
  if (!config.apiKey.trim() || !config.model.trim()) return false;
  if (id === 'custom' && !resolveBaseUrl(id, config)) return false;
  return true;
}

export function configuredIds(settings: Settings): ProviderId[] {
  return PROVIDERS.filter((p) => isConfigured(settings, p.id)).map((p) => p.id);
}

export function resolveBaseUrl(id: ProviderId, config: ProviderConfig): string {
  const override = (config.baseUrl || '').trim().replace(/\/+$/, '');
  if (override) return override;
  if (id === 'custom') return '';
  return presetOf(id).baseUrl.replace(/\/+$/, '');
}

export function isOfficialEndpoint(id: ProviderId, base: string): boolean {
  if (id === 'custom') return false;
  return base.replace(/\/+$/, '') === presetOf(id).baseUrl.replace(/\/+$/, '');
}

export function withConfig(settings: Settings, id: ProviderId, config: ProviderConfig): Settings {
  const next: Settings = {
    ...settings,
    configs: { ...settings.configs, [id]: config },
  };
  const activeReady = isConfigured(settings, settings.activeId);
  if (!activeReady || settings.activeId === id) next.activeId = id;
  return next;
}

function legacyBaseUrl(provider: string): string {
  const legacy: Record<string, string> = {
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
    perplexity: 'https://api.perplexity.ai',
    openrouter: 'https://openrouter.ai/api/v1',
  };
  return legacy[provider] ?? '';
}

function migrateLegacy(): Settings | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const old = JSON.parse(raw) as {
      provider?: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      search?: boolean;
      depth?: 'quick' | 'standard' | 'deep';
    };
    const map: Record<string, ProviderId> = {
      deepseek: 'deepseek',
      mimo: 'mimo',
      glm: 'glm',
      kimi: 'kimi',
      openai: 'openai',
    };
    const id: ProviderId = map[old.provider || ''] ?? 'custom';
    const config: ProviderConfig = {
      model: old.model || presetOf(id).defaultModel,
      apiKey: old.apiKey || '',
      baseUrl: id === 'custom' ? old.baseUrl || legacyBaseUrl(old.provider || '') : old.baseUrl || '',
    };
    return {
      configs: config.apiKey ? { [id]: config } : {},
      activeId: id,
      search: old.search ?? true,
      depth: old.depth ?? 'standard',
    };
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const activeId = (parsed.activeId as ProviderId) || DEFAULT_SETTINGS.activeId;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        configs: parsed.configs ?? {},
        activeId: PROVIDERS.some((p) => p.id === activeId) ? activeId : DEFAULT_SETTINGS.activeId,
      };
    }
    const migrated = migrateLegacy();
    if (migrated) return migrated;
  } catch {
    /* 存储损坏时回落到默认值 */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 隐私模式下写入失败时静默降级 */
  }
}
