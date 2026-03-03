/**
 * Server-side DOM snapshot → JPEG renderer using Puppeteer.
 *
 * On Vercel: uses @sparticuz/chromium (headless, serverless-compatible).
 * Locally:   uses system Chrome (google-chrome / chromium-browser).
 */

let _browserPromise = null;

async function getBrowser() {
  if (_browserPromise) return _browserPromise;

  _browserPromise = (async () => {
    const puppeteer = require('puppeteer-core');

    // Vercel / AWS Lambda: use @sparticuz/chromium
    try {
      const chromium = require('@sparticuz/chromium');
      return await puppeteer.launch({
        args: chromium.args,
        defaultViewport: null,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
    } catch {
      // Local dev: find system Chrome
      const paths = [
        '/usr/local/bin/google-chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        process.env.CHROME_PATH,
      ].filter(Boolean);

      for (const p of paths) {
        try {
          require('fs').accessSync(p);
          return await puppeteer.launch({
            executablePath: p,
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
          });
        } catch {}
      }
      throw new Error('No Chrome/Chromium binary found');
    }
  })();

  return _browserPromise;
}

/**
 * Render an HTML string to a JPEG buffer.
 * @param {string} html  Complete HTML document (with inlined styles)
 * @param {object} opts  { width, height, quality, deviceScaleFactor }
 * @returns {Promise<Buffer>} JPEG image buffer
 */
async function renderToImage(html, opts = {}) {
  const width = opts.width || 390;
  const height = opts.height || 844;
  const quality = opts.quality || 80;
  const scale = Math.min(opts.deviceScaleFactor || 2, 3);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 10000 });

    // Wait for fonts (Inter, Material Symbols) — up to 3s
    await page.evaluate(() => document.fonts?.ready).catch(() => {});

    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality,
      fullPage: true,
    });

    return screenshot;
  } finally {
    await page.close();
  }
}

/**
 * Render DOM snapshot HTML to a base64 JPEG string ready for storage.
 */
async function renderSnapshotToBase64(html, clientState) {
  const width = clientState?.viewport?.width || 390;
  const height = clientState?.viewport?.height || 844;
  const scale = clientState?.viewport?.devicePixelRatio || 2;

  const buf = await renderToImage(html, {
    width,
    height,
    quality: 80,
    deviceScaleFactor: Math.min(scale, 2),
  });

  return buf.toString('base64');
}

async function shutdown() {
  if (_browserPromise) {
    try {
      const browser = await _browserPromise;
      await browser.close();
    } catch {}
    _browserPromise = null;
  }
}

module.exports = { renderToImage, renderSnapshotToBase64, shutdown };
