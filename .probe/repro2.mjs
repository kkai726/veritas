import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET || 'https://kkai726.github.io/veritas/';

const cases = [
  { name: 'deepseek / dummy key', provider: 'deepseek', model: 'deepseek-chat' },
  { name: 'openrouter / dummy key', provider: 'openrouter', model: 'openai/gpt-4.1' },
  { name: 'gemini / dummy key', provider: 'gemini', model: 'gemini-2.5-flash' },
  { name: 'perplexity / dummy key', provider: 'perplexity', model: 'sonar' },
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

for (const c of cases) {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate((s) => {
    localStorage.setItem('veritas.settings.v1', JSON.stringify({
      provider: s.provider, model: s.model, apiKey: 'sk-dummy-key-for-test', baseUrl: '', search: false, depth: 'quick',
    }));
  }, c);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.type('textarea.composer-input', '纯净水在 4℃ 时密度最大，约为 1 g/cm3。这是一段用于测试的文本内容。');
  await page.waitForFunction(() => {
    const b = document.querySelector('button.cta');
    return b && !b.disabled && /开始核查/.test(b.textContent || '');
  }, { timeout: 15000 });
  await page.click('button.cta');
  await page.waitForFunction(() => !!document.querySelector('.banner--error'), { timeout: 45000 }).catch(() => {});
  const banner = await page.evaluate(() => document.querySelector('.banner--error')?.textContent?.trim() || '(no banner)');
  console.log(`### ${c.name}\n  ${banner}\n`);
  await page.close();
}

await browser.close();
