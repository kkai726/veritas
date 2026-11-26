import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET || 'https://kkai726.github.io/veritas/';

const cases = [
  { name: 'clean key', key: 'sk-test-1234567890' },
  { name: 'key with trailing newline', key: 'sk-test-1234567890\n' },
  { name: 'key with zero-width char', key: 'sk-test-1234\u200b567890' },
  { name: 'key with full-width char', key: 'sk-test-1234５67890' },
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

for (const c of cases) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('requestfailed', (r) => logs.push(`[fail] ${r.url().slice(0, 60)} :: ${r.failure()?.errorText}`));

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate((key) => {
    localStorage.setItem('veritas.settings.v1', JSON.stringify({
      provider: 'openai', model: 'gpt-4.1', apiKey: key, baseUrl: '', search: true, depth: 'quick',
    }));
  }, c.key);
  await page.reload({ waitUntil: 'networkidle2' });

  await page.type('textarea.composer-input', '纯净水在 4℃ 时密度最大，约为 1 g/cm3。这是一段用于测试的文本内容。');
  await page.waitForFunction(() => {
    const b = document.querySelector('button.cta');
    return b && !b.disabled && /开始核查/.test(b.textContent || '');
  }, { timeout: 15000 });
  await page.click('button.cta');

  await page.waitForFunction(() => {
    const b = document.querySelector('.banner--error');
    return !!b;
  }, { timeout: 45000 }).catch(() => {});

  const banner = await page.evaluate(() => document.querySelector('.banner--error')?.textContent?.trim() || '(no banner)');
  console.log(`\n### ${c.name}\n  banner: ${banner}`);
  console.log('  logs  :', logs.slice(0, 4).join(' | ') || '(none)');
  await page.close();
}

await browser.close();
