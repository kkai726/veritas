import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET || 'http://localhost:4175/';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1150, deviceScaleFactor: 1 });

// 1) 设置面板（OpenAI 选中 + 新接口地址字段）
await page.goto(`${URL}?panel=settings`, { waitUntil: 'networkidle2' });
await page.screenshot({ path: '.probe/settings.png' });

// 2) OpenAI 报错横幅
await page.evaluate(() => {
  localStorage.setItem('veritas.settings.v1', JSON.stringify({
    provider: 'openai', model: 'gpt-4.1', apiKey: 'sk-test-123', baseUrl: '', search: true, depth: 'standard',
  }));
});
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.type('textarea.composer-input', '纯净水在 4℃ 时密度最大，约为 1 g/cm3。这是一段用于测试的文本内容，用于触发一次真实请求。');
await page.waitForFunction(() => {
  const b = document.querySelector('button.cta');
  return b && !b.disabled;
}, { timeout: 15000 });
await page.click('button.cta');
await page.waitForSelector('.banner--error', { timeout: 45000 });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: '.probe/error.png' });

await browser.close();
