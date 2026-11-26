/**
 * Veritas 转发网关（Cloudflare Worker）
 *
 * 作用：把浏览器发来的请求原样转发给模型服务商，并补上 CORS 响应头。
 * 这样 OpenAI 这类「POST 响应不带 Access-Control-Allow-Origin」的接口
 * 也能在纯前端页面里被读取。
 *
 * 只转发到下面白名单里的域名，不是开放代理。
 * 部署：npx wrangler deploy（详见同目录 README.md）
 */

const UPSTREAMS = {
  '/openai': 'https://api.openai.com',
  '/gemini': 'https://generativelanguage.googleapis.com',
  '/deepseek': 'https://api.deepseek.com',
  '/openrouter': 'https://openrouter.ai/api',
  '/perplexity': 'https://api.perplexity.ai',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, http-referer, x-title, x-api-key',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'x-request-id, request-id, retry-after',
};

// 需要从转发请求里剔除的头（由运行时自己决定）
const DROP_REQUEST_HEADERS = [
  'host',
  'origin',
  'referer',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
];

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const prefix = Object.keys(UPSTREAMS).find(
      (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
    );

    if (!prefix) {
      return json(
        {
          error: 'unknown_route',
          message: `路径需以 ${Object.keys(UPSTREAMS).join(' / ')} 开头，例如 /openai/v1/responses`,
        },
        404,
      );
    }

    const rest = url.pathname.slice(prefix.length) || '/';
    const target = `${UPSTREAMS[prefix]}${rest}${url.search}`;

    const headers = new Headers(request.headers);
    DROP_REQUEST_HEADERS.forEach((h) => headers.delete(h));

    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'follow',
      });
    } catch (err) {
      return json({ error: 'upstream_unreachable', message: String(err), target }, 502);
    }

    const responseHeaders = new Headers(upstream.headers);
    Object.entries(CORS_HEADERS).forEach(([k, v]) => responseHeaders.set(k, v));
    // 让浏览器能读到流式/分块响应
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
