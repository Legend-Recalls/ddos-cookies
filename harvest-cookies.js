// harvest-cookies.js (ESM)
import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function harvestCookies(url, maxRetries = 3) {
  let browser = null;
  let page = null;

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
        ],
      });

      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      console.log(`[harvest] Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

      // Use sleep instead of page.waitForTimeout (works everywhere)
      console.log('[harvest] Waiting 7 seconds for JS challenge to settle...');
      await sleep(7000);

      // Wait for <body> or any element that indicates the page is ready
      console.log('[harvest] Waiting for <body> to be visible...');
      await page.waitForSelector('body', { visible: true, timeout: 15000 });

      console.log('[harvest] Extracting cookies...');
      const cookies = await page.cookies();

      // Grab content if you need it
      const content = await page.content();

      console.log(`[harvest] Success! Got ${cookies.length} cookies.`);
      await page.close();
      await browser.close();

      return { cookies, content };
    } catch (err) {
      console.warn(`[harvest] Attempt ${attempt} failed: ${err && err.message ? err.message : err}`);

      try { if (page) await page.close(); } catch (e) {}
      try { if (browser) await browser.close(); } catch (e) {}

      if (attempt === maxRetries) throw err;

      const waitTime = 3000 * attempt;
      console.log(`[harvest] Retrying in ${waitTime} ms...`);
      await sleep(waitTime);
    } finally {
      page = null;
      browser = null;
    }
  }
}

(async () => {
  try {
    const url = process.env.TARGET || 'https://animepahe.ru';
    const { cookies, content } = await harvestCookies(url);

    // Save JSON and simple cookie string
    await fs.writeFile('cookies.json', JSON.stringify(cookies, null, 2), 'utf-8');
    await fs.writeFile('cookies.txt', cookies.map(c => `${c.name}=${c.value}`).join('; '), 'utf-8');

    console.log('[harvest] Cookies saved to cookies.json and cookies.txt');
    console.log('Page content length:', (content || '').length);
  } catch (e) {
    console.error('Harvest failed:', e);
    process.exit(1);
  }
})();
