import { isOfficialEndpoint, presetOf, resolveBaseUrl } from './settings';
import type { ProviderId, Settings } from './types';
import { hostOf, isHeaderSafe, sanitizeSecret } from './utils';

export interface RawCitation {
  title: string;
  url: string;
  publisher: string;
}

export interface RunResult {
  text: string;
  citations: RawCitation[];
  searchUsed: boolean;
  notes: string[];
}

export interface RunOptions {
  settings: Settings;
  system: string;
  user: string;
  signal?: AbortSignal;
}

const REQUEST_TIMEOUT = 240_000;

export type FailureCode = 'http' | 'network' | 'cors' | 'header' | 'timeout' | 'aborted';

export class ProviderError extends Error {
  status?: number;
  code: FailureCode;
  hint?: string;

  constructor(message: string, opts: { status?: number; code?: FailureCode; hint?: string } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = opts.status;
    this.code = opts.code ?? 'http';
    this.hint = opts.hint;
  }
}

function describeStatus(status: number, body: string): string {
  const detail = body.slice(0, 400).replace(/\s+/g, ' ').trim();
  const map: Record<number, string> = {
    400: '请求被拒绝（模型或参数不被支持）',
    401: 'API Key 无效或已过期',
    403: '没有访问权限（可能未开通该模型）',
    404: '接口或模型不存在，请检查接口地址与模型名',
    413: '内容超出模型的上下文长度',
    422: '参数格式不被接受',
    429: '触发限流或余额不足',
    500: '上游服务异常',
    502: '上游网关错误',
    503: '上游服务暂不可用',
    504: '上游响应超时',
  };
  const base = map[status] ?? `请求失败 (${status})`;
  return detail ? `${base} — ${detail}` : base;
}

const GATEWAY_HINT =
  '在「模型设置 → 接口地址」里填一个自建转发网关即可（仓库 worker/ 目录有现成模板，两分钟部署）。';

function networkFailure(
  provider: ProviderId,
  base: string,
  elapsed: number,
  raw: string,
): ProviderError {
  const host = hostOf(base) || base;
  const official = isOfficialEndpoint(provider, base);

  if (provider === 'openai' && official) {
    return new ProviderError('OpenAI 官方接口不允许浏览器直连，请求被 CORS 拦下了。', {
      code: 'cors',
      hint: `不是 Key 的问题：它的响应里没有 Access-Control-Allow-Origin。改用 OpenRouter（模型填 openai/gpt-4.1），或${GATEWAY_HINT}也可以换 Gemini / Perplexity / DeepSeek。`,
    });
  }

  if (elapsed < 1200) {
    return new ProviderError(`连不上 ${host}（${elapsed}ms 就被断开）`, {
      code: 'network',
      hint: `这么快失败通常是域名解析不了或被网络策略直接拒绝：接口地址是否写错、是否需要在系统代理里放行这个域名、浏览器扩展（广告/隐私拦截）是否把它拦了。本地原始报错：${raw}`,
    });
  }

  return new ProviderError(`连接 ${host} 失败`, {
    code: 'network',
    hint: `请求在 ${elapsed}ms 时中断，多为网络被中断或证书问题。若在国内网络，${host} 可能不可达；可改用可达的服务商，或${GATEWAY_HINT}本地原始报错：${raw}`,
  });
}

interface RequestContext {
  provider: ProviderId;
  base: string;
}

async function requestJson(
  url: string,
  init: RequestInit,
  ctx: RequestContext,
  parentSignal?: AbortSignal,
): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  const onAbort = () => ctrl.abort();
  parentSignal?.addEventListener('abort', onAbort);
  const started = performance.now();

  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.text();
    if (!res.ok) {
      throw new ProviderError(describeStatus(res.status, body), { status: res.status, code: 'http' });
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new ProviderError(`返回内容不是合法 JSON：${body.slice(0, 200)}`, { code: 'http' });
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err;

    const raw = err instanceof Error ? err.message : String(err);

    if (/non ISO-8859-1|Failed to read the 'headers'|Invalid value/i.test(raw)) {
      throw new ProviderError('请求头里有浏览器无法编码的字符', {
        code: 'header',
        hint: 'API Key 或接口地址里混入了中文、全角符号或零宽字符。请清空后重新粘贴一次（只保留英文、数字和 - _）。',
      });
    }

    if (err instanceof DOMException && err.name === 'AbortError') {
      if (parentSignal?.aborted) {
        throw new ProviderError('已取消', { code: 'aborted' });
      }
      throw new ProviderError('请求超时', {
        code: 'timeout',
        hint: '模型 4 分钟没有返回。可以换更快的模型、把深度调成「快速」，或者关掉联网检索再试。',
      });
    }

    if (location.protocol === 'https:' && url.startsWith('http://')) {
      throw new ProviderError('接口地址是 http，被浏览器的混合内容策略拦下了', {
        code: 'cors',
        hint: '页面本身是 https，无法请求 http 接口。请把接口地址换成 https。',
      });
    }

    throw networkFailure(ctx.provider, ctx.base, Math.round(performance.now() - started), raw);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

function citeFromLink(url: string, title?: string, publisher?: string): RawCitation {
  if (!/^https?:\/\//i.test(url)) return { title: title || url, url, publisher: publisher || '' };
  return {
    title: (title || '').trim() || hostOf(url) || url,
    url: url.trim(),
    publisher: (publisher || '').trim() || hostOf(url),
  };
}

function chatText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return String((part as any).text ?? '');
        return '';
      })
      .join('');
  }
  return '';
}

/* ------------------------------------------------------------------ OpenAI */
async function runOpenAI(opts: RunOptions): Promise<RunResult> {
  const { settings, system, user, signal } = opts;
  const base = resolveBaseUrl(settings);
  const ctx: RequestContext = { provider: 'openai', base };
  const notes: string[] = [];
  const useSearch = settings.search;

  const callResponses = async (withTools: boolean) => {
    const body: Record<string, unknown> = {
      model: settings.model,
      instructions: system,
      input: user,
      store: false,
      max_output_tokens: 8000,
    };
    if (withTools) {
      body.tools = [{ type: 'web_search' }];
      body.tool_choice = 'auto';
    }
    return requestJson(
      `${base}/responses`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      ctx,
      signal,
    );
  };

  let data: any;
  try {
    data = await callResponses(useSearch);
  } catch (err) {
    const e = err as ProviderError;
    if (e.status === 400 || e.status === 404) {
      if (useSearch) {
        notes.push('当前模型不支持 web_search 工具，已自动降级为无联网模式。');
        data = await callResponses(false);
      } else {
        notes.push('未找到 Responses 接口，已回退到 Chat Completions。');
        return runChatCompatible({ ...opts, system }, 'openai', notes);
      }
    } else {
      throw e;
    }
  }

  let text = '';
  const citations: RawCitation[] = [];
  let searched = false;

  for (const item of data?.output ?? []) {
    if (item?.type === 'web_search_call' || item?.type === 'web_search_call_preview') searched = true;
    if (item?.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part?.type !== 'output_text' && part?.type !== 'text') continue;
      text += part.text ?? '';
      for (const ann of part.annotations ?? []) {
        if (ann?.type === 'url_citation' && ann.url) {
          citations.push(citeFromLink(ann.url, ann.title));
        }
      }
    }
  }

  if (!text.trim()) throw new ProviderError('模型返回了空结果，请重试或更换模型。', { code: 'http' });
  return { text, citations, searchUsed: searched || citations.length > 0, notes };
}

/* ------------------------------------------------------------------ Gemini */
async function runGemini(opts: RunOptions): Promise<RunResult> {
  const { settings, system, user, signal } = opts;
  const base = resolveBaseUrl(settings);
  const search = settings.search;
  const payload: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
  };
  if (search) payload.tools = [{ google_search: {} }];

  const data = await requestJson(
    `${base}/models/${encodeURIComponent(settings.model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { provider: 'gemini', base },
    signal,
  );

  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p: any) => p && typeof p.text === 'string' && !p.thought)
    .map((p: any) => p.text)
    .join('');

  if (!text.trim()) {
    const block = data?.promptFeedback?.blockReason;
    throw new ProviderError(
      block ? `内容被安全策略拦截：${block}` : '模型返回了空结果，请重试或更换模型。',
      { code: 'http' },
    );
  }

  const citations: RawCitation[] = [];
  for (const chunk of cand?.groundingMetadata?.groundingChunks ?? []) {
    const web = chunk?.web;
    if (web?.uri) citations.push(citeFromLink(web.uri, web.title));
  }

  return {
    text,
    citations,
    searchUsed: citations.length > 0 || (cand?.groundingMetadata?.webSearchQueries?.length ?? 0) > 0,
    notes: [],
  };
}

/* -------------------------------------------------- OpenAI 兼容 /chat/completions */
async function runChatCompatible(
  opts: RunOptions,
  flavor: 'openai' | 'openrouter' | 'perplexity' | 'deepseek' | 'custom',
  notes: string[] = [],
): Promise<RunResult> {
  const { settings, system, user, signal } = opts;
  const base = resolveBaseUrl(settings);
  const ctx: RequestContext = { provider: flavor === 'custom' ? 'custom' : flavor, base };
  const endpoint = `${base}/chat/completions`;
  const search = settings.search && flavor !== 'deepseek';
  const model =
    flavor === 'openrouter' && search && !settings.model.endsWith(':online')
      ? `${settings.model}:online`
      : settings.model;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };
  if (flavor === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'Veritas';
  }

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    max_tokens: 8000,
  };
  if (flavor === 'perplexity') body.return_citations = true;
  if (flavor === 'deepseek' || flavor === 'custom') body.response_format = { type: 'json_object' };

  let data: any;
  try {
    data = await requestJson(
      endpoint,
      { method: 'POST', headers, body: JSON.stringify(body) },
      ctx,
      signal,
    );
  } catch (err) {
    const e = err as ProviderError;
    if (e.status === 400 && body.response_format) {
      delete body.response_format;
      notes.push('网关不支持 JSON 模式，已改用常规输出。');
      data = await requestJson(
        endpoint,
        { method: 'POST', headers, body: JSON.stringify(body) },
        ctx,
        signal,
      );
    } else {
      throw e;
    }
  }

  const choice = data?.choices?.[0];
  const text = chatText(choice?.message?.content);
  if (!text.trim()) throw new ProviderError('模型返回了空结果，请重试或更换模型。', { code: 'http' });

  const citations: RawCitation[] = [];
  for (const c of data?.citations ?? []) {
    if (typeof c === 'string') citations.push(citeFromLink(c));
  }
  for (const r of data?.search_results ?? []) {
    if (r?.url) citations.push(citeFromLink(r.url, r.title, r.publisher ?? hostOf(r.url)));
  }
  for (const ann of choice?.message?.annotations ?? []) {
    if (ann?.type === 'url_citation' && ann.url_citation?.url) {
      citations.push(citeFromLink(ann.url_citation.url, ann.url_citation.title));
    }
  }

  return { text, citations, searchUsed: citations.length > 0, notes };
}

/* ------------------------------------------------------------------ Runner */

/** 清洗用户输入：去掉零宽字符与换行，避免请求头非法导致「Failed to fetch」 */
function normalizeSettings(settings: Settings): Settings {
  const apiKey = sanitizeSecret(settings.apiKey);
  const baseUrl = (settings.baseUrl || '').trim();

  if (apiKey && !isHeaderSafe(apiKey)) {
    throw new ProviderError('API Key 里含有中文或全角字符', {
      code: 'header',
      hint: '浏览器无法把非 ASCII 字符放进请求头。请重新复制 Key，粘贴时注意不要连带中文标点。',
    });
  }
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    throw new ProviderError('接口地址必须以 https:// 开头', {
      code: 'header',
      hint: `当前填写的是「${baseUrl}」。改成完整地址，例如 https://your-gateway.workers.dev/openai/v1。`,
    });
  }

  return { ...settings, apiKey, baseUrl };
}

export async function runModel(opts: RunOptions): Promise<RunResult> {
  const settings = normalizeSettings(opts.settings);
  const next: RunOptions = { ...opts, settings };
  switch (settings.provider) {
    case 'openai':
      return runOpenAI(next);
    case 'gemini':
      return runGemini(next);
    case 'perplexity':
      return runChatCompatible(next, 'perplexity');
    case 'openrouter':
      return runChatCompatible(next, 'openrouter');
    case 'deepseek':
      return runChatCompatible(next, 'deepseek');
    case 'custom':
      return runChatCompatible(next, 'custom');
    default:
      throw new ProviderError(`未知的服务商：${settings.provider}`, { code: 'http' });
  }
}

export async function testConnection(settings: Settings): Promise<string> {
  const clean = normalizeSettings(settings);
  const base = resolveBaseUrl(clean);
  const preset = presetOf(clean.provider);
  if (!base) throw new ProviderError('请先填写接口地址', { code: 'header' });

  if (clean.provider === 'gemini') {
    await requestJson(
      `${base}/models/${encodeURIComponent(clean.model)}:generateContent?key=${encodeURIComponent(clean.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
      },
      { provider: 'gemini', base },
    );
    return `${preset.name} · ${clean.model} 连接正常`;
  }

  await requestJson(
    `${base}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clean.apiKey}` },
      body: JSON.stringify({
        model: clean.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    },
    { provider: clean.provider, base },
  );
  return `${preset.name} · ${clean.model} 连接正常`;
}
