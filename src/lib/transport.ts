/**
 * 统一的 HTTP 出口。
 *
 * 浏览器里 fetch 受同源策略约束：服务商不回 CORS 头，页面就拿不到结果
 * （OpenAI 就是这样）。桌面端与安卓端都在原生层发请求，天然没有这个限制，
 * 所以这里按运行环境挑一条通道：
 *
 *   Electron  → 主进程 ipcMain（Node 里发请求）
 *   安卓壳    → @JavascriptInterface 注入的 veritasAndroid 桥
 *   浏览器    → fetch
 *
 * 检索（搜索页、正文页）走 GET，模型请求走 POST，两条都从这里出去。
 */

export interface HttpResult {
  status: number;
  text: string;
}

/** 原生层抛回来的网络错误：带上失败分类，便于给出针对性提示 */
export interface TransportError extends Error {
  code?: string;
  via?: string;
}

interface PostReq {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

interface GetReq {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

interface NativeBridge {
  httpPost(req: PostReq): Promise<HttpResult>;
  httpGet(req: GetReq): Promise<HttpResult>;
}

type Runtime = 'desktop' | 'android' | 'web';

function resolveCapacitorHttp(): any | null {
  const cap = (window as any).Capacitor;
  return cap?.Plugins?.CapacitorHttp ?? null;
}

export function runtime(): Runtime {
  const w = window as any;
  if (w.veritasNative?.httpPost) return 'desktop';
  if (w.veritasAndroid?.post) return 'android';
  if (resolveCapacitorHttp()) return 'android';
  return 'web';
}

export function runtimeLabel(): string {
  switch (runtime()) {
    case 'desktop':
      return '桌面端';
    case 'android':
      return '安卓端';
    default:
      return '网页端';
  }
}

/**
 * 安卓壳通过 addJavascriptInterface 注入 veritasAndroid.post / .get，
 * 回调走 window.__veritasNativeResolve(id, status, text)。
 */
function androidBridge(): NativeBridge | null {
  const w = window as any;
  const api = w.veritasAndroid;
  if (!api?.post) return null;

  const call = (fn: 'post' | 'get', req: PostReq | GetReq) =>
    new Promise<HttpResult>((resolve, reject) => {
      w.__veritasCallbacks = w.__veritasCallbacks || {};
      const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      w.__veritasCallbacks[id] = (status: number, text: string) => {
        delete w.__veritasCallbacks[id];
        if (!status) reject(new Error(text || '原生请求失败'));
        else resolve({ status, text });
      };
      const headerLines = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      try {
        if (fn === 'post') {
          api.post(id, req.url, headerLines, (req as PostReq).body, req.timeoutMs);
        } else if (typeof api.get === 'function') {
          api.get(id, req.url, headerLines, req.timeoutMs);
        } else {
          throw new Error('当前安装包版本过旧，不支持检索请求，请更新 APK');
        }
      } catch (err) {
        delete w.__veritasCallbacks[id];
        reject(err as Error);
      }
    });

  return {
    httpPost: (req) => call('post', req),
    httpGet: (req) => call('get', req),
  };
}

if (typeof window !== 'undefined') {
  const w = window as any;
  if (typeof w.__veritasNativeResolve !== 'function') {
    w.__veritasNativeResolve = (id: string, status: number, text: string) => {
      const cb = w.__veritasCallbacks?.[id];
      if (typeof cb === 'function') cb(status, text);
    };
  }
}

/** 原生通道不经过浏览器同源策略，网页端返回 null */
function nativeBridge(): NativeBridge | null {
  const w = window as any;
  if (w.veritasNative?.httpPost) {
    const unwrap = (res: any): HttpResult => {
      if (res && !res.status && res.error) {
        const err = new Error(String(res.error)) as TransportError;
        err.code = typeof res.code === 'string' ? res.code : undefined;
        err.via = typeof res.via === 'string' ? res.via : undefined;
        throw err;
      }
      return { status: Number(res?.status ?? 0), text: String(res?.text ?? '') };
    };
    return {
      httpPost: async (req) => unwrap(await w.veritasNative.httpPost(req)),
      httpGet: async (req) =>
        unwrap(await (typeof w.veritasNative.httpGet === 'function'
          ? w.veritasNative.httpGet(req)
          : w.veritasNative.httpPost({ ...req, body: '', method: 'GET' }))),
    };
  }

  const android = androidBridge();
  if (android) return android;

  const http = resolveCapacitorHttp();
  if (http?.request) {
    const send = async (method: 'GET' | 'POST', req: PostReq | GetReq): Promise<HttpResult> => {
      let data: unknown;
      if (method === 'POST') {
        try {
          data = JSON.parse((req as PostReq).body);
        } catch {
          data = (req as PostReq).body;
        }
      }
      const res = await http.request({
        url: req.url,
        method,
        headers: req.headers,
        data,
        responseType: 'text',
        connectTimeout: 30_000,
        readTimeout: req.timeoutMs,
      });
      const text =
        typeof res.data === 'string'
          ? res.data
          : res.data == null
            ? ''
            : JSON.stringify(res.data);
      return { status: Number(res.status ?? 0), text };
    };
    return {
      httpPost: (req) => send('POST', req),
      httpGet: (req) => send('GET', req),
    };
  }

  return null;
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<HttpResult> {
  const bridge = nativeBridge();
  if (bridge) {
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    return bridge.httpPost({ url, headers, body, timeoutMs: opts.timeoutMs });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** 读取一个页面 / 接口（检索、正文抓取都走这里） */
export async function getText(
  url: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<HttpResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const headers = opts.headers ?? {};
  const bridge = nativeBridge();

  if (bridge) {
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const result = await bridge.httpGet({ url, headers, timeoutMs });
    if (!result.status) throw new Error('原生请求没有返回状态');
    return result;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** 原生环境标记：CSP/权限提示与故障排查用 */
export function hasNativeTransport(): boolean {
  return runtime() !== 'web';
}

/* --------------------------------------------------------------- 网络诊断 */

export interface NetProbe {
  ok: boolean;
  status?: number;
  ms: number;
  error?: string;
}

export interface NetCheckResult {
  url: string;
  host: string;
  dns: { ok: boolean; ms: number; addresses?: string[]; error?: string } | null;
  resolve?: { ok: boolean; addresses?: string[]; error?: string } | null;
  proxy: string;
  chromium: NetProbe | null;
  node: NetProbe | null;
  doh: { ips: string[] } | null;
  error?: string;
}

/** 桌面端才有：分别探测系统 DNS、系统代理、Chromium 通道、Node 通道 */
export async function netCheck(url: string): Promise<NetCheckResult | null> {
  const w = window as any;
  if (typeof w.veritasNative?.netCheck !== 'function') return null;
  try {
    return (await w.veritasNative.netCheck({ url })) as NetCheckResult;
  } catch {
    return null;
  }
}

/** 把诊断结果压成一行人话，附在错误提示后面 */
export function describeNetCheck(r: NetCheckResult | null): string {
  if (!r) return '';
  const bits: string[] = [];

  if (r.dns?.ok) bits.push(`DNS 正常（${r.dns.addresses?.slice(0, 2).join(' / ') || '已解析'}）`);
  else if (r.resolve?.ok && r.resolve.addresses?.length)
    bits.push(`系统解析接口失败（${r.dns?.error || '未知'}），但 DNS 查询可用：${r.resolve.addresses.slice(0, 2).join(' / ')}`);
  else bits.push(`DNS 解析失败（${r.dns?.error || '未知'}）`);

  const proxy = (r.proxy || '').trim();
  bits.push(proxy.startsWith('PROXY') || proxy.startsWith('HTTPS') ? `系统代理 ${proxy}` : '直连（无系统代理）');

  if (r.chromium) bits.push(r.chromium.ok ? `系统网络通道正常（${r.chromium.status}）` : `系统网络通道失败：${r.chromium.error}`);
  if (r.node) bits.push(r.node.ok ? `程序内通道正常（${r.node.status}）` : `程序内通道失败：${r.node.error}`);
  if (r.doh?.ips?.length) bits.push(`DoH 可用（${r.doh.ips.slice(0, 2).join(' / ')}）`);

  return bits.join(' · ');
}
