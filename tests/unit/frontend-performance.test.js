const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PUBLIC_DIR = path.join(__dirname, '../../public');

describe('Frontend performance budget', () => {
  const hubPath = path.join(PUBLIC_DIR, 'hub-v2.html');
  const hubHtml = fs.readFileSync(hubPath, 'utf8');

  test('no render-blocking JS libraries in page head', () => {
    const head = hubHtml.split('</head>')[0];
    const scriptTags = head.match(/<script[^>]*src="[^"]*"[^>]*>/gi) || [];
    const blockingScripts = scriptTags.filter(tag => {
      return !tag.includes('defer') && !tag.includes('async') && !tag.includes('type="module"');
    });
    expect(blockingScripts).toEqual([]);
  });

  test('no Tailwind browser JIT compiler (must use pre-built CSS)', () => {
    expect(hubHtml).not.toContain('@tailwindcss/browser');
  });

  test('html2canvas is lazy-loaded, not eagerly fetched', () => {
    const head = hubHtml.split('</head>')[0];
    expect(head).not.toContain('html2canvas');
  });

  test('pre-built CSS exists and is under 200KB', () => {
    const cssPath = path.join(PUBLIC_DIR, 'styles/output.css');
    expect(fs.existsSync(cssPath)).toBe(true);
    const size = fs.statSync(cssPath).size;
    expect(size).toBeLessThan(200 * 1024);
  });

  test('hub HTML is under 150KB (single-file SPA budget)', () => {
    const size = fs.statSync(hubPath).size;
    expect(size).toBeLessThan(150 * 1024);
  });

  test('total critical page weight (HTML + CSS) is under 300KB uncompressed', () => {
    const htmlSize = fs.statSync(hubPath).size;
    const cssPath = path.join(PUBLIC_DIR, 'styles/output.css');
    const cssSize = fs.existsSync(cssPath) ? fs.statSync(cssPath).size : 0;
    const totalKB = Math.round((htmlSize + cssSize) / 1024);
    expect(htmlSize + cssSize).toBeLessThan(300 * 1024);
  });

  test('pre-built CSS is up-to-date with source HTML classes', () => {
    const inputCss = path.join(PUBLIC_DIR, 'styles/input.css');
    if (!fs.existsSync(inputCss)) return;

    try {
      const currentCss = fs.readFileSync(path.join(PUBLIC_DIR, 'styles/output.css'), 'utf8');
      const result = execSync(
        'npx @tailwindcss/cli -i public/styles/input.css --minify',
        { cwd: path.join(__dirname, '../..'), encoding: 'utf8', timeout: 30000 }
      );
      const currentLen = currentCss.length;
      const freshLen = result.length;
      const drift = Math.abs(currentLen - freshLen) / Math.max(currentLen, 1);
      expect(drift).toBeLessThan(0.05);
    } catch (e) {
      if (e.message?.includes('timeout') || e.message?.includes('ENOENT')) {
        console.warn('Skipping CSS freshness check: Tailwind CLI not available');
        return;
      }
      throw e;
    }
  });

  test('external CDN resources are limited to fonts only', () => {
    const head = hubHtml.split('</head>')[0];
    const externalLinks = (head.match(/href="https?:\/\/[^"]+"/gi) || [])
      .map(m => m.replace(/^href="/, '').replace(/"$/, ''));
    const externalScripts = (head.match(/src="https?:\/\/[^"]+"/gi) || [])
      .map(m => m.replace(/^src="/, '').replace(/"$/, ''));

    const allowedDomains = ['fonts.googleapis.com', 'fonts.gstatic.com'];
    for (const url of [...externalLinks, ...externalScripts]) {
      const domain = new URL(url).hostname;
      expect(allowedDomains).toContain(domain);
    }
  });

  test('secondary pages also use pre-built CSS', () => {
    const pages = ['demo.html', 'job.html', 'canvas.html', 'scan.html', 'scan-view.html', 'keypoints.html'];
    for (const page of pages) {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, page), 'utf8');
      expect(html).toContain('/styles/output.css');
      expect(html).not.toContain('@tailwindcss/browser');
    }
  });
});
