const { app, BrowserWindow, ipcMain, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const DIST = path.join(__dirname, '..', 'dist');

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

/** 渲染进程里没有跨域限制，模型请求与检索请求统一从主进程发出 */
ipcMain.handle('veritas:http', async (_event, req) => {
  const controller = new AbortController();
  const timeout = Number(req?.timeoutMs) || 240000;
  const timer = setTimeout(() => controller.abort(), timeout);
  const method = req?.method || 'POST';

  try {
    const res = await fetch(req.url, {
      method,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(req.headers || {}),
      },
      body: method === 'GET' || method === 'HEAD' ? undefined : req.body,
      signal: controller.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    return { status: res.status, text };
  } catch (err) {
    const message =
      err && err.name === 'AbortError'
        ? `请求超时（${Math.round(timeout / 1000)}s）`
        : String((err && err.cause && err.cause.message) || (err && err.message) || err);
    return { status: 0, text: '', error: message };
  } finally {
    clearTimeout(timer);
  }
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
        return {
          postStatus: post.status,
          postHead: String(post.text || post.error).slice(0, 90),
          ddgStatus: search.status,
          ddgHasResults: String(search.text || '').includes('result__a'),
          jinaStatus: page.status,
          jinaChars: String(page.text || '').length,
          zhStatus: zh.status,
          zhResults: zhDoc.querySelectorAll('li.res-list').length,
          zhFirstUrl: first ? first.getAttribute('data-mdurl') : null,
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
