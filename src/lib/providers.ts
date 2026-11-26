import { presetOf, resolveBaseUrl } from './settings';
import type { Settings } from './types';
import { hostOf } from './utils';

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

class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function describeStatus(status: number, body: string): string {
  const detail = body.slice(0, 400).replace(/\s+/g, ' ').trim();
  const map: Record<number, string> = {
    400: '请求被拒绝（模型或参数不被支持）',
    401: 'API Key 无效或已过期',
    403: '没有访问权限（可能未开通该模型）',
    404: '接口或模型不存在，请检查 Base URL 与模型名',
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

async function requestJson(
  url: string,
  init: RequestInit,
  parentSignal?: AbortSignal,
): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  const onAbort = () => ctrl.abort();
  parentSignal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.text();
    if (!res.ok) throw new ProviderError(describeStatus(res.status, body), res.status);
    try {
      return JSON.parse(body);
    } catch {
      throw new ProviderError(`返回内容不是合法 JSON：${body.slice(0, 200)}`);
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ProviderError(parentSignal?.aborted ? '已取消' : '请求超时，请重试或换用更快的模型');
    }
    throw new ProviderError(
      `网络请求失败：${err instanceof Error ? err.message : String(err)}。若浏览器拦截了跨域请求，可改用 OpenRouter 或自建网关。`,
    );
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
    return requestJson(`${base}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    }, signal);
  };

  let data: any;
  try {
    data = await callResponses(useSearch);
  } catch (err) {
    const e = err as ProviderError;
    if (useSearch && (e.status === 400 || e.status === 404)) {
      notes.push('当前模型不支持 web_search 工具，已自动降级为无联网模式。');
      data = await callResponses(false);
    } else if (e.status === 404 || e.status === 400) {
      notes.push('未找到 Responses 接口，已回退到 Chat Completions。');
      return runChatCompatible({ ...opts, system }, 'openai', notes);
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

  if (!text.trim()) throw new ProviderError('模型返回了空结果，请重试或更换模型。');
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
  const endpoint = `${base}/chat/completions`;
  const search = settings.search && flavor !== 'deepseek';
  const model =
    flavor === 'openrouter' && search && !settings.model.endsWith(':online')
      ? `${settings.model}:online`
      : settings.model;

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
    data = await requestJson(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
        ...(flavor === 'openrouter' ? { 'HTTP-Referer': location.origin, 'X-Title': 'Veritas' } : {}),
      },
      body: JSON.stringify(body),
    }, signal);
  } catch (err) {
    const e = err as ProviderError;
    if (e.status === 400 && body.response_format) {
      delete body.response_format;
      notes.push('网关不支持 JSON 模式，已改用常规输出。');
      data = await requestJson(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(body),
      }, signal);
    } else {
      throw e;
    }
  }

  const choice = data?.choices?.[0];
  const text = chatText(choice?.message?.content);
  if (!text.trim()) throw new ProviderError('模型返回了空结果，请重试或更换模型。');

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
export async function runModel(opts: RunOptions): Promise<RunResult> {
  const { provider } = opts.settings;
  switch (provider) {
    case 'openai':
      return runOpenAI(opts);
    case 'gemini':
      return runGemini(opts);
    case 'perplexity':
      return runChatCompatible(opts, 'perplexity');
    case 'openrouter':
      return runChatCompatible(opts, 'openrouter');
    case 'deepseek':
      return runChatCompatible(opts, 'deepseek');
    case 'custom':
      return runChatCompatible(opts, 'custom');
    default:
      throw new ProviderError(`未知的服务商：${provider}`);
  }
}

export async function testConnection(settings: Settings): Promise<string> {
  const base = resolveBaseUrl(settings);
  const preset = presetOf(settings.provider);
  if (!base) throw new Error('请先填写 Base URL');

  if (settings.provider === 'gemini') {
    const res = await fetch(
      `${base}/models/${encodeURIComponent(settings.model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
      },
    );
    if (!res.ok) throw new Error(describeStatus(res.status, await res.text()));
    return `${preset.name} · ${settings.model} 连接正常`;
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    }),
  });
  if (!res.ok) throw new Error(describeStatus(res.status, await res.text()));
  return `${preset.name} · ${settings.model} 连接正常`;
}

export { ProviderError };
