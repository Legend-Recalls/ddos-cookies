const puppeteer = require('puppeteer');

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
          '--single-process', // Might reduce memory
          '--disable-gpu',
          '--disable-features=site-per-process',
        ],
      });

      page = await browser.newPage();

      // Set a reasonable viewport
      await page.setViewport({ width: 1280, height: 800 });

      console.log(`[harvest] Navigating to ${url} with networkidle0...`);
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

      // Wait extra time to allow JS challenges to finish
      console.log('[harvest] Waiting 7 seconds for JS challenge to settle...');
      await page.waitForTimeout(7000);

      // Wait for a page element that only appears after challenge passes
      // You may need to tweak this selector for your target site
      console.log('[harvest] Waiting for <body> element to be visible...');
      await page.waitForSelector('body', { visible: true, timeout: 15000 });

      // Now safely get cookies
      console.log('[harvest] Extracting cookies...');
      const cookies = await page.cookies();

      // Also grab page content if needed
      const content = await page.content();

      console.log(`[harvest] Success! Got ${cookies.length} cookies.`);
      await browser.close();

      return { cookies, content };
    } catch (err) {
      console.warn(`[harvest] Attempt ${attempt} failed with error: ${err.message}`);

      if (page) try { await page.close(); } catch {} 
      if (browser) try { await browser.close(); } catch {}

      if (attempt === maxRetries) {
        console.error('[harvest] Max retries reached, aborting.');
        throw err;
      }

      // Exponential backoff before retrying
      const waitTime = 3000 * attempt;
      console.log(`[harvest] Retrying in ${waitTime} ms...`);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
}

(async () => {
  try {
    const url = 'https://animepahe.ru';
    const { cookies, content } = await harvestCookies(url);
    console.log('Page content length:', content.length);
    await fs.writeFile('cookies.json', JSON.stringify(cookies, null, 2), 'utf-8');
  console.log('[harvest] Cookies saved to cookies.json');
    // TODO: Save cookies to file or process them as needed

  } catch (e) {
    console.error('Harvest failed:', e);
  }
})();
