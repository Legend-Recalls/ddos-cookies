import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';

async function harvestCookies(url, maxRetries = 3) {
  let browser, page;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[harvest] Attempt ${attempt} - Launching Chromium...`);
      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-features=site-per-process'
        ]
      });

      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      console.log(`[harvest] Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

      console.log('[harvest] Waiting 7 seconds for JS challenge...');
      await page.waitForTimeout(7000);

      console.log('[harvest] Waiting for <body>...');
      await page.waitForSelector('body', { visible: true, timeout: 15000 });

      console.log('[harvest] Extracting cookies...');
      const cookies = await page.cookies();

      console.log(`[harvest] Success! Got ${cookies.length} cookies.`);
      await browser.close();

      return cookies;
    } catch (err) {
      console.warn(`[harvest] Attempt ${attempt} failed: ${err.message}`);

      if (page) try { await page.close(); } catch {}
      if (browser) try { await browser.close(); } catch {}

      if (attempt === maxRetries) throw err;

      const waitTime = 3000 * attempt;
      console.log(`[harvest] Retrying in ${waitTime} ms...`);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
}

(async () => {
  try {
    const url = process.env.TARGET || 'https://animepahe.ru';
    const cookies = await harvestCookies(url);

    await fs.writeFile('cookies.json', JSON.stringify(cookies, null, 2), 'utf-8');
    await fs.writeFile('cookies.txt', cookies.map(c => `${c.name}=${c.value}`).join('; '), 'utf-8');

    console.log('[harvest] Cookies saved to cookies.json and cookies.txt');
  } catch (e) {
    console.error('Harvest failed:', e);
    process.exit(1);
  }
})();
