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

/** 渲染进程里没有跨域限制，模型请求统一从主进程发出 */
ipcMain.handle('veritas:http', async (_event, req) => {
  const controller = new AbortController();
  const timeout = Number(req?.timeoutMs) || 240000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(req.url, {
      method: req.method || 'POST',
      headers: req.headers || {},
      body: req.body,
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
      window.veritasNative.httpPost({
        url: 'https://api.deepseek.com/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-smoke-test' },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }] }),
        timeoutMs: 20000,
      }).then((r) => ({ status: r.status, head: String(r.text || r.error).slice(0, 120), runtime: Boolean(window.veritasNative) }))
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
