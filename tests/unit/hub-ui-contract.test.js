const fs = require('fs');
const path = require('path');

describe('Hub UI contract (Daisy-first)', () => {
  const hubPath = path.join(__dirname, '../../public/hub-v2.html');
  const apiPath = path.join(__dirname, '../../api/index.js');
  const hubHtml = fs.readFileSync(hubPath, 'utf8');
  const apiIndex = fs.readFileSync(apiPath, 'utf8');
  const secondaryPages = [
    'job.html',
    'canvas.html',
    'scan.html',
    'scan-view.html',
    'keypoints.html',
    'demo.html',
  ];

  test('head includes pre-built Tailwind+DaisyUI CSS and no custom <style> blocks', () => {
    const headMarkup = hubHtml.split('<body>')[0];
    expect(headMarkup).toContain('/styles/output.css');
    expect(headMarkup).not.toContain('@tailwindcss/browser');
    expect(headMarkup).not.toMatch(/<style[\s>]/i);
  });

  test('hub does NOT load Tailwind browser JIT (performance)', () => {
    expect(hubHtml).not.toContain('@tailwindcss/browser');
  });

  test('hub contains no inline style attributes', () => {
    expect(hubHtml).not.toMatch(/style="/i);
  });

  test('hub defines layout-to-theme mapping for shared styles', () => {
    expect(hubHtml).toContain('const LAYOUT_THEME_MAP = {');
    expect(hubHtml).toContain("breaking_news: 'coffee'");
    expect(hubHtml).toContain("dashboard: 'dim'");
    expect(hubHtml).toContain("product_showcase: 'synthwave'");
    expect(hubHtml).toContain('function applyLayoutTheme(layoutType)');
  });

  test('render capture fallback avoids custom card/progress CSS blocks', () => {
    const buildStart = apiIndex.indexOf('function buildCardViewHtml');
    const buildEnd = apiIndex.indexOf("app.get('/api/r/:requestId/render'");
    const fnBody = apiIndex.slice(buildStart, buildEnd);
    expect(fnBody).toContain('daisyui@5/themes.css');
    expect(fnBody).not.toContain('.card-grid{');
    expect(fnBody).not.toMatch(/<style>/i);
  });

  test('secondary customer pages use pre-built CSS with no style blocks', () => {
    for (const page of secondaryPages) {
      const html = fs.readFileSync(path.join(__dirname, '../../public', page), 'utf8');
      expect(html).toContain('/styles/output.css');
      expect(html).not.toContain('@tailwindcss/browser');
      expect(html).not.toMatch(/<style[\s>]/i);
    }
  });

  test('pre-built CSS file exists and is reasonably sized', () => {
    const cssPath = path.join(__dirname, '../../public/styles/output.css');
    expect(fs.existsSync(cssPath)).toBe(true);
    const stat = fs.statSync(cssPath);
    expect(stat.size).toBeGreaterThan(10000);
    expect(stat.size).toBeLessThan(500000);
  });

  test('capture libraries are lazy-loaded, not in page head', () => {
    const headMarkup = hubHtml.split('<body>')[0];
    expect(headMarkup).not.toContain('html2canvas');
    expect(headMarkup).not.toContain('dom-to-image');
    expect(hubHtml).toContain('function loadDomToImage()');
  });
});

