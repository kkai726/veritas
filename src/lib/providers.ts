import { isOfficialEndpoint, presetOf, resolveBaseUrl } from './settings';
import { postJson, runtime } from './transport';
import type { ProviderConfig, ProviderId } from './types';
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
  provider: ProviderId;
  config: ProviderConfig;
  system: string;
  user: string;
  signal?: AbortSignal;
  /** 只在应用内检索失败时，才允许模型自己联网（OpenAI web_search） */
  allowModelSearch?: boolean;
  /** 输出预算：深度越高留得越多，赶时间时先砍这里 */
  maxTokens?: number;
}

const REQUEST_TIMEOUT = 240_000;

export type FailureCode = 'http' | 'network' | 'cors' | 'header' | 'timeout' | 'aborted' | 'config';

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
    402: '账户余额不足',
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

const GATEWAY_HINT = '在「模型设置 → 接口地址」里填一个自建转发网关（仓库 worker/ 目录有现成模板）。';

function networkFailure(id: ProviderId, base: string, elapsed: number, raw: string): ProviderError {
  const host = hostOf(base) || base;
  const onWeb = runtime() === 'web';

  if (id === 'openai' && isOfficialEndpoint(id, base) && onWeb) {
    return new ProviderError('OpenAI 官方接口不允许浏览器直连，请求被 CORS 拦下了。', {
      code: 'cors',
      hint: `不是 Key 的问题：它的响应里没有 Access-Control-Allow-Origin。请用桌面端 / 安卓端打开，或${GATEWAY_HINT}`,
    });
  }

  if (elapsed < 1200) {
    return new ProviderError(`连不上 ${host}（${elapsed}ms 就被断开）`, {
      code: 'network',
      hint: `多半是域名解析失败或被网络策略拒绝：检查接口地址是否写错、是否要挂代理、防火墙是否拦截。原始报错：${raw}`,
    });
  }

  return new ProviderError(`连接 ${host} 失败`, {
    code: 'network',
    hint: `请求在 ${elapsed}ms 时中断，常见原因：网络不通、证书被拦截、网关挡了域名。原始报错：${raw}`,
  });
}

interface RequestContext {
  provider: ProviderId;
  base: string;
}

async function requestJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  ctx: RequestContext,
  parentSignal?: AbortSignal,
): Promise<any> {
  const started = performance.now();

  let res;
  try {
    res = await postJson(
      url,
      { 'Content-Type': 'application/json', ...headers },
      JSON.stringify(body),
      { timeoutMs: REQUEST_TIMEOUT, signal: parentSignal },
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);

    if (/non ISO-8859-1|Failed to read the 'headers'|Invalid value/i.test(raw)) {
      throw new ProviderError('请求头里有浏览器无法编码的字符', {
        code: 'header',
        hint: 'API Key 或接口地址里混进了中文、全角符号或零宽字符。清空后重新粘贴一次（只保留英文、数字和 - _ .）。',
      });
    }

    if (err instanceof DOMException && err.name === 'AbortError') {
      if (parentSignal?.aborted) throw new ProviderError('已取消', { code: 'aborted' });
      throw new ProviderError('请求超时', {
        code: 'timeout',
        hint: '模型 4 分钟没有返回。换更快的模型、把深度调成「快速」，或减少段落数量再试。',
      });
    }

    if (location.protocol === 'https:' && url.startsWith('http://')) {
      throw new ProviderError('接口地址是 http，被混合内容策略拦下了', {
        code: 'cors',
        hint: '页面本身是 https，不能请求 http 接口。把接口地址换成 https。',
      });
    }

    throw networkFailure(ctx.provider, ctx.base, Math.round(performance.now() - started), raw);
  }

  if (res.status < 200 || res.status >= 300) {
    throw new ProviderError(describeStatus(res.status, res.text), {
      status: res.status,
      code: 'http',
    });
  }

  try {
    return JSON.parse(res.text);
  } catch {
    throw new ProviderError(`返回内容不是合法 JSON：${res.text.slice(0, 200)}`, { code: 'http' });
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

/* ------------------------------------------- OpenAI：Responses + web_search */
async function runOpenAIResponses(opts: RunOptions, notes: string[]): Promise<RunResult | null> {
  const { config, system, user, signal } = opts;
  const base = resolveBaseUrl('openai', config);
  const ctx: RequestContext = { provider: 'openai', base };

  const call = (withTools: boolean) => {
    const body: Record<string, unknown> = {
      model: config.model,
      instructions: system,
      input: user,
      store: false,
      max_output_tokens: opts.maxTokens ?? 8000,
    };
    if (withTools) {
      body.tools = [{ type: 'web_search' }];
      body.tool_choice = 'auto';
    }
    return requestJson(`${base}/responses`, { Authorization: `Bearer ${config.apiKey}` }, body, ctx, signal);
  };

  const wantTools = opts.allowModelSearch !== false;
  let data: any;
  try {
    data = await call(wantTools);
  } catch (err) {
    const e = err as ProviderError;
    if (e.status === 400 || e.status === 404 || e.status === 422) {
      try {
        data = await call(false);
        notes.push('当前模型不支持 web_search 工具，本次未使用模型自带检索。');
      } catch {
        return null;
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
        if (ann?.type === 'url_citation' && ann.url) citations.push(citeFromLink(ann.url, ann.title));
      }
    }
  }

  if (!text.trim()) return null;
  return { text, citations, searchUsed: searched || citations.length > 0, notes };
}

function emptyDetail(data: any): string {
  const choice = data?.choices?.[0];
  const usage = data?.usage ?? {};
  const parts: string[] = [];
  if (choice?.finish_reason) parts.push(`finish_reason=${choice.finish_reason}`);
  const refusal = choice?.message?.refusal;
  if (refusal) parts.push(`refusal=${String(refusal).slice(0, 40)}`);
  if (usage.completion_tokens != null) {
    parts.push(`completion_tokens=${usage.completion_tokens}`);
  }
  if (usage.reasoning_tokens != null) parts.push(`reasoning_tokens=${usage.reasoning_tokens}`);
  const reasoning = choice?.message?.reasoning_content;
  if (typeof reasoning === 'string' && reasoning.trim()) parts.push('仅返回了思考过程');
  return parts.join(' · ');
}

/* ------------------------------------------- OpenAI 兼容 /chat/completions */
async function runChat(opts: RunOptions, notes: string[]): Promise<RunResult> {
  const { provider, config, system, user, signal } = opts;
  const base = resolveBaseUrl(provider, config);
  const ctx: RequestContext = { provider, base };
  const endpoint = `${base}/chat/completions`;
  const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}` };

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  const call = async (
    useJson: boolean,
    maxTokens: number,
    tokenKey: 'max_tokens' | 'max_completion_tokens' = 'max_tokens',
  ): Promise<any> => {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: 0.2,
      stream: false,
      [tokenKey]: maxTokens,
    };
    if (useJson) body.response_format = { type: 'json_object' };

    try {
      return await requestJson(endpoint, headers, body, ctx, signal);
    } catch (err) {
      const e = err as ProviderError;
      if (e.status === 400 && useJson) {
        notes.push('该网关不支持 JSON 模式，已改用常规输出。');
        return call(false, maxTokens, tokenKey);
      }
      if (e.status === 400 && tokenKey === 'max_tokens' && /max_completion_tokens/i.test(e.message)) {
        return call(useJson, maxTokens, 'max_completion_tokens');
      }
      throw e;
    }
  };

  const budget = opts.maxTokens ?? 8000;
  let data = await call(true, budget);
  let choice = data?.choices?.[0];
  let text = chatText(choice?.message?.content);

  // 空结果最常见的原因是 max_tokens 被思考过程吃光（推理模型），这里自动加额度重试
  if (!text.trim()) {
    const truncated = choice?.finish_reason === 'length';
    notes.push(
      truncated
        ? '模型输出在额度上限处被截断（推理过程占用了大部分 token），已提高额度重试。'
        : '模型首次返回为空，已自动重试一次。',
    );
    data = await call(true, truncated ? Math.max(24_000, budget * 3) : Math.max(16_000, budget * 2));
    choice = data?.choices?.[0];
    text = chatText(choice?.message?.content);
  }

  if (!text.trim()) {
    const detail = emptyDetail(data);
    throw new ProviderError(
      `模型返回了空结果${detail ? `（${detail}）` : ''}，请重试或更换模型。`,
      {
        code: 'http',
        hint:
          '常见原因：推理模型把 max_tokens 全部用于思考、网关只回了 reasoning_content、或触发了内容过滤。' +
          '可以先在设置里点「测试连接」，或换一个非推理模型（如 deepseek-chat / glm-4.6）。',
      },
    );
  }

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

function normalizeConfig(id: ProviderId, config: ProviderConfig): ProviderConfig {
  const apiKey = sanitizeSecret(config.apiKey || '');
  const baseUrl = (config.baseUrl || '').trim();
  const model = (config.model || '').trim();

  if (apiKey && !isHeaderSafe(apiKey)) {
    throw new ProviderError('API Key 里含有中文或全角字符', {
      code: 'header',
      hint: '原生通道与浏览器都无法把非 ASCII 字符放进请求头。重新复制 Key，注意别带上中文标点。',
    });
  }
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    throw new ProviderError('接口地址必须以 https:// 开头', {
      code: 'config',
      hint: `当前填写的是「${baseUrl}」。填完整地址，例如 https://api.deepseek.com/v1。`,
    });
  }
  if (!resolveBaseUrl(id, { ...config, apiKey, baseUrl, model })) {
    throw new ProviderError('还没填接口地址', {
      code: 'config',
      hint: '自定义服务商需要填一个 OpenAI 兼容的 Base URL，例如 https://your-gateway.com/v1。',
    });
  }

  return { apiKey, baseUrl, model };
}

export async function runModel(opts: RunOptions): Promise<RunResult> {
  const config = normalizeConfig(opts.provider, opts.config);
  const next: RunOptions = { ...opts, config };
  const notes: string[] = [];

  if (opts.provider === 'openai') {
    const result = await runOpenAIResponses(next, notes);
    if (result) return result;
    notes.push('Responses 接口不可用，已回退到 Chat Completions。');
  }
  return runChat(next, notes);
}

export async function testConnection(id: ProviderId, config: ProviderConfig): Promise<string> {
  const clean = normalizeConfig(id, config);
  const base = resolveBaseUrl(id, clean);
  const preset = presetOf(id);
  const started = performance.now();

  let data: any;
  try {
    data = await requestJson(
      `${base}/chat/completions`,
      { Authorization: `Bearer ${clean.apiKey}` },
      {
        model: clean.model,
        messages: [{ role: 'user', content: '只回复两个字：可用' }],
        max_tokens: 16,
        stream: false,
      },
      { provider: id, base },
    );
  } catch (err) {
    const e = err as ProviderError;
    if (e.status === 404) {
      throw new ProviderError('模型不存在或接口地址不对', {
        code: 'config',
        hint: `当前模型「${clean.model}」在该地址上没有找到。检查模型名，或把接口地址改成 ${preset.baseUrl || '你的网关地址'}。`,
      });
    }
    throw e;
  }

  const choice = data?.choices?.[0];
  if (!choice) {
    throw new ProviderError('接口返回格式不像 OpenAI 兼容协议（没有 choices 字段）', {
      code: 'config',
      hint: '确认接口地址指向 /v1 这样的 OpenAI 兼容入口，并且模型名是该服务真实存在的。',
    });
  }

  const ms = Math.round(performance.now() - started);
  return `${preset.name} · ${clean.model} 连接正常（${ms} ms）`;
}
