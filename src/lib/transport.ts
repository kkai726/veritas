/**
 * 统一的 HTTP 出口。
 *
 * 浏览器里 fetch 受同源策略约束：服务商不回 CORS 头，页面就拿不到结果
 * （OpenAI 就是这样）。桌面端与安卓端都在原生层发请求，天然没有这个限制，
 * 所以这里按运行环境挑一条通道：
 *
 *   Electron  → 主进程 ipcMain（Node 里发请求）
 *   Capacitor → CapacitorHttp 原生插件
 *   浏览器    → fetch
 */

export interface HttpResult {
  status: number;
  text: string;
}

interface NativeBridge {
  httpPost(req: {
    url: string;
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
  }): Promise<HttpResult>;
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
 * 安卓壳通过 addJavascriptInterface 注入 veritasAndroid.post，
 * 回调走 window.__veritasNativeResolve(id, status, text)。
 */
function androidBridge(): NativeBridge | null {
  const w = window as any;
  const api = w.veritasAndroid;
  if (!api?.post) return null;

  return {
    httpPost: (req) =>
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
          api.post(id, req.url, headerLines, req.body, req.timeoutMs);
        } catch (err) {
          delete w.__veritasCallbacks[id];
          reject(err as Error);
        }
      }),
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
    return {
      httpPost: async (req) => {
        const res = await w.veritasNative.httpPost(req);
        if (res && !res.status && res.error) throw new Error(String(res.error));
        return { status: Number(res?.status ?? 0), text: String(res?.text ?? '') };
      },
    };
  }

  const android = androidBridge();
  if (android) return android;

  const http = resolveCapacitorHttp();
  if (http?.request) {
    return {
      httpPost: async ({ url, headers, body, timeoutMs }) => {
        let data: unknown = body;
        try {
          data = JSON.parse(body);
        } catch {
          /* 非 JSON 就原样发字符串 */
        }
        const res = await http.request({
          url,
          method: 'POST',
          headers,
          data,
          responseType: 'text',
          connectTimeout: 30_000,
          readTimeout: timeoutMs,
        });
        const text =
          typeof res.data === 'string'
            ? res.data
            : res.data == null
              ? ''
              : JSON.stringify(res.data);
        return { status: Number(res.status ?? 0), text };
      },
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

/** 原生环境标记：CSP/权限提示与故障排查用 */
export function hasNativeTransport(): boolean {
  return runtime() !== 'web';
}
