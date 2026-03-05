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

  test('head includes DaisyUI/Tailwind and only theme bridge <style>', () => {
    const headMarkup = hubHtml.split('<body>')[0];
    expect(headMarkup).toContain('cdn.jsdelivr.net/npm/daisyui@5/themes.css');
    expect(headMarkup).toContain('cdn.jsdelivr.net/npm/daisyui@5');
    expect(headMarkup).toContain('cdn.jsdelivr.net/npm/@tailwindcss/browser@4');
    const styleBlocks = headMarkup.match(/<style[\s>][\s\S]*?<\/style>/gi) || [];
    expect(styleBlocks.length).toBeLessThanOrEqual(1);
    if (styleBlocks.length === 1) {
      expect(styleBlocks[0]).toContain('--thinx-');
      expect(styleBlocks[0]).not.toMatch(/\.[a-zA-Z]/);
    }
  });

  test('hub uses no hardcoded text-white in card renderers', () => {
    const scriptBody = hubHtml.split('<script>')[1] || '';
    expect(scriptBody).not.toContain("text-white");
  });

  test('hub uses no hardcoded rgba/oklch colors in Tailwind classes', () => {
    const classPatterns = hubHtml.match(/class="[^"]*(?:rgba|oklch)\([^"]*"/g) || [];
    expect(classPatterns).toEqual([]);
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

  test('secondary customer pages use Daisy/Tailwind with no style blocks', () => {
    for (const page of secondaryPages) {
      const html = fs.readFileSync(path.join(__dirname, '../../public', page), 'utf8');
      expect(html).toContain('cdn.jsdelivr.net/npm/daisyui@5/themes.css');
      expect(html).toContain('cdn.jsdelivr.net/npm/daisyui@5');
      expect(html).toContain('cdn.jsdelivr.net/npm/@tailwindcss/browser@4');
      expect(html).not.toMatch(/<style[\s>]/i);
    }
  });
});

