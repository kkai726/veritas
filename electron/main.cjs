const { app, BrowserWindow, ipcMain, protocol, shell, net, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');

const DIST = path.join(__dirname, '..', 'dist');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/* ------------------------------------------------------------------ 网络出口
 *
 * 三层递进，任何一层拿到结果就返回：
 *
 *   1. Chromium 网络栈（net.fetch）：解析与连接都由浏览器网络服务处理，
 *      **会走系统代理 / PAC**，也使用 Chromium 的 DNS 与证书库。
 *      Node 的 fetch 不走系统代理，用户的机器一旦挂了代理或公司网络，
 *      Node 侧就会直接 getaddrinfo ENOENT（域名在本地解析不到）。
 *   2. Node fetch（undici）：Chromium 栈被企业策略拦掉时兜底。
 *   3. DoH 解析 + 指定 IP 直连：本地 DNS 被劫持 / 污染时的最后手段。
 *      用 223.5.5.5 的 JSON 接口拿到 A 记录，再带原 hostname 建 TLS 连接
 *      （SNI 与证书校验仍按域名，安全性与正常请求一致）。
 */

const DNS_LIKE = /getaddrinfo|ENOTFOUND|EAI_AGAIN|ENOENT|ERR_NAME_NOT_RESOLVED|Name or service not known/i;

function errText(err) {
  if (!err) return '未知错误';
  if (err.name === 'AbortError') return '请求超时';
  const cause = err.cause && (err.cause.code || err.cause.message);
  return String(cause || err.code || err.message || err);
}

function classify(raw) {
  if (/ENOTFOUND|ENOENT|ERR_NAME_NOT_RESOLVED|not known/i.test(raw)) return 'dns-notfound';
  if (/EAI_AGAIN/i.test(raw)) return 'dns-temp';
  if (/ECONNREFUSED/i.test(raw)) return 'refused';
  if (/ETIMEDOUT|timed?\s?out|超时/i.test(raw)) return 'timeout';
  if (/CERT_|certificate|SSL|TLS/i.test(raw)) return 'tls';
  return 'network';
}

function headersFor(req) {
  return {
    'User-Agent': UA,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(req.headers || {}),
  };
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

async function viaChromium(req, timeoutMs) {
  if (!net || typeof net.fetch !== 'function') throw new Error('当前 Electron 版本没有 net.fetch');
  const method = req.method || 'POST';
  const gate = withTimeout(timeoutMs);
  try {
    const res = await net.fetch(req.url, {
      method,
      headers: headersFor(req),
      body: method === 'GET' || method === 'HEAD' ? undefined : req.body,
      redirect: 'follow',
      signal: gate.signal,
    });
    return { status: res.status, text: await res.text() };
  } finally {
    gate.done();
  }
}

async function viaNode(req, timeoutMs) {
  const host = new URL(req.url).hostname;
  const ips = await resolveHost(host);
  if (!ips.length) throw new Error(`ENOTFOUND ${host}`);

  let lastError = null;
  for (const ip of ips.slice(0, 2)) {
    try {
      return await viaPinnedIp(req, timeoutMs, ip);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`ENOTFOUND ${host}`);
}

/**
 * 解析主机名，**不依赖 getaddrinfo**。
 *
 * Windows + 代理软件（TUN 模式、改过 DNS、装过 hosts）时常出现
 * getaddrinfo ENOENT 而实际 DNS 查询正常的情况：PowerShell 能解析、
 * 浏览器能打开，只有 Node 的 dns.lookup 报「域名不存在」。
 * 所以这里依次尝试 lookup（尊重 hosts）→ c-ares resolve4 → DoH。
 */
const resolveCache = new Map();

async function resolveHost(host) {
  const cached = resolveCache.get(host);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.ips;

  let ips = [];
  try {
    const all = await dns.promises.lookup(host, { all: true });
    ips = all.map((a) => a.address).filter((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip));
  } catch {
    ips = [];
  }

  if (!ips.length) {
    try {
      ips = await dns.promises.resolve4(host);
    } catch {
      ips = [];
    }
  }

  if (!ips.length) ips = await dohResolve(host);

  if (ips.length) resolveCache.set(host, { at: Date.now(), ips });
  return ips;
}

/** 走 IP 直连的 DoH 查询（不依赖本地 DNS） */
function dohResolve(hostname, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const url = `http://223.5.5.5/resolve?name=${encodeURIComponent(hostname)}&type=A`;
    const req = http.get(url, { headers: { Accept: 'application/dns-json' }, timeout: timeoutMs }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const ips = (data.Answer || [])
            .filter((a) => a && a.type === 1 && /^\d{1,3}(\.\d{1,3}){3}$/.test(String(a.data)))
            .map((a) => String(a.data));
          resolve(Array.from(new Set(ips)));
        } catch {
          resolve([]);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve([]);
    });
    req.on('error', () => resolve([]));
  });
}

/** 用指定 IP 建立连接，但 TLS 仍按域名校验（SNI / 证书不受影响） */
function viaPinnedIp(req, timeoutMs, address) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(req.url);
    } catch {
      reject(new Error('地址不合法'));
      return;
    }
    const mod = target.protocol === 'http:' ? http : https;
    const method = req.method || 'POST';
    const body = method === 'GET' || method === 'HEAD' ? null : req.body;
    const headers = headersFor(req);
    if (body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-length')) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const request = mod.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        servername: target.hostname,
        // Node 20+ 默认开启 autoSelectFamily，会以 { all: true } 调 lookup，
        // 此时必须回数组，否则报 ERR_INVALID_IP_ADDRESS
        lookup: (_host, options, cb) =>
          options && options.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4),
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const charset = (/charset=([\w-]+)/i.exec(String(res.headers['content-type'] || ''))?.[1] || 'utf-8').toLowerCase();
          let text;
          try {
            text = new TextDecoder(charset === 'gb2312' ? 'gbk' : charset).decode(buf);
          } catch {
            text = buf.toString('utf8');
          }
          resolve({ status: res.statusCode || 0, text });
        });
      },
    );

    request.setTimeout(timeoutMs, () => request.destroy(new Error('请求超时')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

ipcMain.handle('veritas:http', async (_event, req) => {
  const t0 = Date.now();
  const timeout = Number(req?.timeoutMs) || 240000;
  const tried = [];

  try {
    const r = await viaChromium(req, timeout);
    return { ...r, via: 'chromium', ms: Date.now() - t0 };
  } catch (err) {
    tried.push(`Chromium: ${errText(err)}`);
  }

  try {
    const r = await viaNode(req, Math.max(10_000, timeout));
    return { ...r, via: 'node', ms: Date.now() - t0 };
  } catch (err) {
    tried.push(`Node: ${errText(err)}`);
  }

  let host = '';
  try {
    host = new URL(req.url).hostname;
  } catch {
    host = '';
  }

  const raw = tried.join(' · ');
  return {
    status: 0,
    text: '',
    error: host ? `${raw}（${host} 解析：${(await resolveHost(host).catch(() => [])).join(' / ') || '失败'}）` : raw,
    code: classify(raw),
    via: 'none',
    ms: Date.now() - t0,
  };
});

/** 设置页「测试连接」用的网络诊断：分别看系统 DNS、代理、两条通道 */
ipcMain.handle('veritas:net-check', async (_event, arg) => {
  const url = String(arg?.url || '');
  const out = { url, host: '', dns: null, resolve: null, proxy: '', chromium: null, node: null, doh: null };

  try {
    out.host = new URL(url).hostname;
  } catch {
    return { ...out, error: '地址不合法' };
  }

  out.dns = await new Promise((resolve) => {
    const t = Date.now();
    dns.lookup(out.host, { all: true }, (err, addresses) => {
      if (err) resolve({ ok: false, ms: Date.now() - t, error: err.code || err.message });
      else resolve({ ok: true, ms: Date.now() - t, addresses: addresses.map((a) => a.address) });
    });
  });

  // getaddrinfo 失败但 c-ares 能解析，是最常见的「只有 Node 上不去网」场景
  try {
    const ips = await dns.promises.resolve4(out.host);
    out.resolve = { ok: true, addresses: ips };
  } catch (err) {
    out.resolve = { ok: false, error: err.code || err.message };
  }

  try {
    out.proxy = await session.defaultSession.resolveProxy(url);
  } catch {
    out.proxy = '未知';
  }

  const probe = async (fn) => {
    const t = Date.now();
    try {
      const r = await fn();
      return { ok: true, status: r.status, ms: Date.now() - t };
    } catch (err) {
      return { ok: false, ms: Date.now() - t, error: errText(err) };
    }
  };

  const req = { url, method: 'GET', headers: {}, timeoutMs: 8000 };
  out.chromium = await probe(() => viaChromium(req, 8000));
  out.node = await probe(() => viaNode(req, 8000));
  out.doh = { ips: await dohResolve(out.host) };
  return out;
});

async function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 880,
    minWidth: 880,
    minHeight: 640,
    backgroundColor: '#f7f5ef',
    title: 'Veritas · 事实核查台',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  await win.loadURL('app://veritas/index.html');

  if (process.env.VERITAS_SMOKE) {
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const post = await window.veritasNative.httpPost({
          url: 'https://api.deepseek.com/v1/chat/completions',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-smoke-test' },
          body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }] }),
          timeoutMs: 20000,
        });
        const search = await window.veritasNative.httpGet({
          url: 'https://html.duckduckgo.com/html/?q=WHO+pandemic+2023',
          headers: {},
          timeoutMs: 20000,
        });
        const page = await window.veritasNative.httpGet({
          url: 'https://r.jina.ai/https://en.wikipedia.org/wiki/Pandemic',
          headers: {},
          timeoutMs: 30000,
        });
        const zh = await window.veritasNative.httpGet({
          url: 'https://www.so.com/s?q=' + encodeURIComponent('世界卫生组织 新冠 突发公共卫生事件'),
          headers: {},
          timeoutMs: 20000,
        });
        const zhDoc = new DOMParser().parseFromString(String(zh.text || ''), 'text/html');
        const first = zhDoc.querySelector('li.res-list h3 a');
        const check = await window.veritasNative.netCheck({ url: 'https://open.bigmodel.cn/api/paas/v4' });
        const glm = await window.veritasNative.httpPost({
          url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer smoke.invalid' },
          body: JSON.stringify({ model: 'glm-4.6', messages: [{ role: 'user', content: 'ping' }] }),
          timeoutMs: 20000,
        });
        return {
          postStatus: post.status,
          postVia: post.via,
          postHead: String(post.text || post.error).slice(0, 90),
          ddgStatus: search.status,
          ddgHasResults: String(search.text || '').includes('result__a'),
          jinaStatus: page.status,
          jinaChars: String(page.text || '').length,
          zhStatus: zh.status,
          zhResults: zhDoc.querySelectorAll('li.res-list').length,
          zhFirstUrl: first ? first.getAttribute('data-mdurl') : null,
          glmStatus: glm.status,
          glmVia: glm.via,
          glmHead: String(glm.text || glm.error).slice(0, 80),
          check: JSON.stringify(check),
          runtime: Boolean(window.veritasNative),
        };
      })()
    `);
    console.log('SMOKE', JSON.stringify(result));
    app.quit();
  }
}

app.whenReady().then(async () => {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (!pathname || pathname === '/') pathname = '/index.html';

    const filePath = path.normalize(path.join(DIST, pathname));
    if (!filePath.startsWith(DIST)) {
      return new Response('forbidden', { status: 403 });
    }

    try {
      const data = await fs.readFile(filePath);
      return new Response(data, {
        headers: { 'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' },
      });
    } catch {
      try {
        const html = await fs.readFile(path.join(DIST, 'index.html'));
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      } catch {
        return new Response('not found', { status: 404 });
      }
    }
  });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
