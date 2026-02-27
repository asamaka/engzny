#!/usr/bin/env node

/**
 * Runs selected screenshots from the test dataset through the thinx.fun
 * analysis pipeline, captures the layout + card results, and generates
 * a side-by-side visual comparison HTML report.
 *
 * Usage:
 *   node scripts/run-dataset-pipeline.js [--count N] [--categories cat1,cat2] [--port PORT]
 *
 * Requires: local server running (or starts one), ANTHROPIC_API_KEY set.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DATASET_DIR = path.join(__dirname, '..', 'tests', 'dataset');
const MANIFEST_PATH = path.join(DATASET_DIR, 'manifest.json');
const REPORT_PATH = path.join(DATASET_DIR, 'pipeline-report.html');

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = 'https://www.thinx.fun';
const PIPELINE_TIMEOUT_MS = 90000;

// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { count: 4, categories: null, port: DEFAULT_PORT, dryRun: false, production: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--count': opts.count = parseInt(args[++i], 10) || 4; break;
      case '--categories': opts.categories = args[++i].split(',').map(s => s.trim()); break;
      case '--port': opts.port = parseInt(args[++i], 10) || DEFAULT_PORT; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--production': opts.production = true; break;
      case '--help':
        console.log(`
Usage: node scripts/run-dataset-pipeline.js [options]

Runs dataset screenshots through the analysis pipeline and generates
a visual comparison report.

Options:
  --count N            Number of screenshots to test (default: 4)
  --categories a,b     Limit to specific categories
  --port PORT          Server port (default: 3000)
  --production         Use production server (https://www.thinx.fun)
  --dry-run            Generate report layout with just source images (no pipeline)
  --help               Show this help

Requires ANTHROPIC_API_KEY env var for local, or --production to use live server.
`);
        process.exit(0);
    }
  }
  return opts;
}

function log(msg) { console.log(`[pipeline-test] ${msg}`); }

function imageToBase64DataUrl(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
  const mime = mimeMap[ext] || 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const proto = urlObj.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = proto.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Invalid JSON: ${body.substring(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function listenSSE(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const events = [];
    let layout = null;
    const cards = {};
    let meta = null;

    const urlObj = new URL(url);
    const proto = urlObj.protocol === 'https:' ? https : http;
    const req = proto.get({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname,
      headers: { 'Accept': 'text/event-stream' },
    }, (res) => {
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        let currentEvent = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.substring(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.substring(6));
              events.push({ event: currentEvent, data, timestamp: Date.now() });

              if (currentEvent === 'layout_update' || currentEvent === 'layout_preview') {
                layout = data;
              } else if (currentEvent === 'card') {
                cards[data.cardId] = data;
              } else if (currentEvent === 'complete') {
                meta = data.meta || data;
                req.destroy();
                resolve({ layout, cards, meta, events });
              } else if (currentEvent === 'error') {
                req.destroy();
                reject(new Error(data.message || 'Pipeline error'));
              }
            } catch { /* skip non-JSON lines */ }
            currentEvent = null;
          } else if (line === '') {
            currentEvent = null;
          }
        }
      });

      res.on('end', () => {
        resolve({ layout, cards, meta, events });
      });
    });

    req.on('error', reject);
    setTimeout(() => { req.destroy(); reject(new Error('SSE timeout')); }, timeoutMs);
  });
}

async function runPipeline(baseUrl, imagePath) {
  const dataUrl = imageToBase64DataUrl(imagePath);
  const startRes = await postJSON(`${baseUrl}/api/hub/v2/start`, { image: dataUrl });
  const { requestId } = startRes;
  if (!requestId) throw new Error(`No requestId returned: ${JSON.stringify(startRes)}`);

  const result = await listenSSE(`${baseUrl}/api/hub/v2/stream/${requestId}`, PIPELINE_TIMEOUT_MS);
  return { requestId, ...result };
}

// ---------------------------------------------------------------------------
// HTML report generation
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCardHtml(cardType, data) {
  if (!data) return '<div class="card-empty">No data</div>';

  const title = data.title || data.name || data.headline || '';
  const subtitle = data.subtitle || data.description || data.summary || '';

  let content = '';
  switch (cardType) {
    case 'hero_summary':
      content = `
        <div class="card-badge">${escapeHtml(data.badge || 'Summary')}</div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(subtitle)}</p>
        ${data.takeaway ? `<div class="card-takeaway">${escapeHtml(data.takeaway)}</div>` : ''}
      `;
      break;
    case 'key_metric':
      content = `
        <div class="card-metric-value">${escapeHtml(data.value || data.metric || '—')}</div>
        <div class="card-metric-label">${escapeHtml(data.label || title)}</div>
        ${data.context ? `<p class="card-context">${escapeHtml(data.context)}</p>` : ''}
      `;
      break;
    case 'info_list':
      const items = data.items || [];
      content = `
        <h3>${escapeHtml(title)}</h3>
        <ul>${items.map(i => `<li>${escapeHtml(typeof i === 'string' ? i : i.text || i.label || JSON.stringify(i))}</li>`).join('')}</ul>
      `;
      break;
    case 'fact_check':
      content = `
        <div class="card-verdict ${(data.verdict || '').toLowerCase().includes('true') ? 'verdict-true' : 'verdict-false'}">${escapeHtml(data.verdict || 'Unverified')}</div>
        <h3>${escapeHtml(data.claim || title)}</h3>
        <p>${escapeHtml(data.explanation || subtitle)}</p>
      `;
      break;
    case 'text_extract':
      content = `
        <h3>${escapeHtml(title || 'Text Extract')}</h3>
        <pre class="card-extract">${escapeHtml(data.text || data.content || subtitle)}</pre>
      `;
      break;
    case 'warning_card':
      content = `
        <div class="card-warning-icon">&#9888;</div>
        <h3>${escapeHtml(title || 'Warning')}</h3>
        <p>${escapeHtml(data.message || subtitle)}</p>
      `;
      break;
    case 'person_card':
      content = `
        <h3>${escapeHtml(data.name || title)}</h3>
        <p class="card-role">${escapeHtml(data.role || data.title || '')}</p>
        <p>${escapeHtml(data.bio || subtitle)}</p>
      `;
      break;
    case 'quote_card':
      content = `
        <blockquote>"${escapeHtml(data.quote || data.text || '')}"</blockquote>
        <p class="card-attribution">— ${escapeHtml(data.attribution || data.source || 'Unknown')}</p>
      `;
      break;
    default:
      content = `
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(subtitle)}</p>
        ${Object.entries(data).filter(([k]) => !['title','subtitle','description','summary'].includes(k)).map(([k, v]) =>
          `<div class="card-field"><span class="field-key">${escapeHtml(k)}:</span> <span>${escapeHtml(typeof v === 'string' ? v : JSON.stringify(v))}</span></div>`
        ).join('')}
      `;
  }

  return content;
}

function generateReport(results) {
  const rows = results.map(r => {
    const imgSrc = imageToBase64DataUrl(path.join(DATASET_DIR, r.image.path));
    const layoutType = r.result?.layout?.layout?.type || 'unknown';
    const contentType = r.result?.layout?.contentAnalysis?.contentType || 'unknown';
    const cardCount = Object.keys(r.result?.cards || {}).length;
    const totalDuration = r.result?.meta?.totalDuration || 0;

    const cardsHtml = Object.values(r.result?.cards || {}).map(card => `
      <div class="result-card card-type-${card.cardType}">
        <div class="card-type-label">${escapeHtml(card.cardType)}</div>
        ${renderCardHtml(card.cardType, card.data)}
      </div>
    `).join('');

    const topQuestions = (r.result?.layout?.contentAnalysis?.topQuestions || [])
      .map(q => `<li>${escapeHtml(q)}</li>`).join('');

    return `
      <div class="comparison-row ${r.error ? 'has-error' : ''}">
        <div class="source-side">
          <img src="${imgSrc}" alt="${escapeHtml(r.image.filename)}" />
          <div class="source-meta">
            <strong>${escapeHtml(r.image.filename)}</strong>
            <span class="meta-cat">${escapeHtml(r.image.category)}</span>
            <span class="meta-dim">${r.image.width}x${r.image.height}</span>
          </div>
        </div>
        <div class="result-side">
          ${r.error
            ? `<div class="error-box">Error: ${escapeHtml(r.error)}</div>`
            : `
              <div class="result-header">
                <span class="layout-badge">${escapeHtml(layoutType)}</span>
                <span class="content-badge">${escapeHtml(contentType)}</span>
                <span class="card-count">${cardCount} cards</span>
                <span class="duration">${(totalDuration / 1000).toFixed(1)}s</span>
              </div>
              ${topQuestions ? `<ul class="top-questions">${topQuestions}</ul>` : ''}
              <div class="cards-grid">${cardsHtml}</div>
            `
          }
        </div>
      </div>
    `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>thinx.fun Pipeline Test Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0d12; color: #e8ecf2; padding: 20px; }
    h1 { text-align: center; margin: 20px 0 30px; font-size: 1.5rem; color: #6c9fff; }
    .summary { text-align: center; color: #8d99ae; margin-bottom: 30px; font-size: 0.9rem; }
    .comparison-row { display: grid; grid-template-columns: 300px 1fr; gap: 24px; margin-bottom: 40px; padding: 20px; background: #151a22; border-radius: 16px; border: 1px solid #1e2736; }
    .comparison-row.has-error { border-color: #ff6b6b33; }
    .source-side { display: flex; flex-direction: column; align-items: center; }
    .source-side img { max-width: 280px; max-height: 500px; border-radius: 12px; object-fit: contain; border: 1px solid #2d3a4e; background: #000; }
    .source-meta { margin-top: 10px; text-align: center; font-size: 0.75rem; color: #8d99ae; }
    .source-meta strong { display: block; color: #e8ecf2; font-size: 0.8rem; margin-bottom: 4px; word-break: break-all; }
    .meta-cat { background: #6c9fff22; color: #6c9fff; padding: 2px 8px; border-radius: 100px; margin-right: 6px; }
    .meta-dim { color: #5c6878; }
    .result-side { min-width: 0; }
    .result-header { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
    .layout-badge { background: #b48eff22; color: #b48eff; padding: 4px 12px; border-radius: 100px; font-size: 0.8rem; font-weight: 600; }
    .content-badge { background: #5bdb8a22; color: #5bdb8a; padding: 4px 12px; border-radius: 100px; font-size: 0.8rem; }
    .card-count { color: #8d99ae; font-size: 0.8rem; }
    .duration { color: #ffd15c; font-size: 0.8rem; }
    .top-questions { list-style: none; margin-bottom: 16px; }
    .top-questions li { color: #8d99ae; font-size: 0.78rem; padding: 2px 0; }
    .top-questions li::before { content: "? "; color: #6c9fff; }
    .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
    .result-card { background: #1b222c; border-radius: 12px; padding: 16px; border: 1px solid #2d3a4e; }
    .card-type-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; color: #5c6878; margin-bottom: 8px; }
    .result-card h3 { font-size: 0.95rem; margin-bottom: 6px; color: #e8ecf2; }
    .result-card p { font-size: 0.82rem; color: #8d99ae; line-height: 1.4; }
    .result-card ul { padding-left: 16px; font-size: 0.82rem; color: #8d99ae; }
    .result-card li { margin-bottom: 3px; }
    .card-badge { display: inline-block; background: #6c9fff22; color: #6c9fff; padding: 2px 10px; border-radius: 100px; font-size: 0.7rem; font-weight: 600; margin-bottom: 8px; }
    .card-takeaway { margin-top: 10px; padding: 8px 12px; background: #6c9fff0a; border-left: 3px solid #6c9fff; font-size: 0.8rem; color: #b0bdd0; border-radius: 0 8px 8px 0; }
    .card-metric-value { font-size: 1.8rem; font-weight: 700; color: #6c9fff; }
    .card-metric-label { font-size: 0.8rem; color: #8d99ae; margin-top: 2px; }
    .card-context { margin-top: 6px; }
    .card-extract { font-family: monospace; font-size: 0.75rem; background: #0f1319; padding: 10px; border-radius: 8px; white-space: pre-wrap; color: #b0bdd0; max-height: 200px; overflow: auto; }
    .card-warning-icon { font-size: 1.5rem; margin-bottom: 6px; }
    .card-verdict { font-weight: 700; font-size: 0.9rem; margin-bottom: 6px; }
    .verdict-true { color: #5bdb8a; }
    .verdict-false { color: #ff6b6b; }
    .card-role { color: #6c9fff; font-size: 0.78rem; margin-bottom: 4px; }
    .card-attribution { font-size: 0.78rem; color: #5c6878; margin-top: 6px; }
    .card-field { font-size: 0.78rem; margin-top: 3px; }
    .field-key { color: #5c6878; }
    blockquote { font-style: italic; color: #b0bdd0; padding: 8px 14px; border-left: 3px solid #b48eff; background: #b48eff08; border-radius: 0 8px 8px 0; }
    .error-box { background: #ff6b6b11; border: 1px solid #ff6b6b33; color: #ff6b6b; padding: 16px; border-radius: 12px; }
    .card-empty { color: #5c6878; font-style: italic; }
    @media (max-width: 700px) { .comparison-row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>thinx.fun Pipeline Test Report</h1>
  <div class="summary">
    Generated: ${new Date().toISOString()} |
    ${results.length} screenshots tested |
    ${results.filter(r => !r.error).length} succeeded |
    ${results.filter(r => r.error).length} failed
  </div>
  ${rows}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const baseUrl = opts.production ? DEFAULT_HOST : `http://localhost:${opts.port}`;

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('No dataset manifest. Run: node scripts/fetch-screenshot-dataset.js');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  let images = manifest.images;

  if (opts.categories) {
    images = images.filter(i => opts.categories.includes(i.category));
  }

  // Pick a diverse sample: one per category, then fill remaining
  const byCategory = {};
  for (const img of images) {
    if (!byCategory[img.category]) byCategory[img.category] = [];
    byCategory[img.category].push(img);
  }

  const selected = [];
  const catKeys = Object.keys(byCategory);
  for (const cat of catKeys) {
    if (selected.length >= opts.count) break;
    const catImages = byCategory[cat];
    // Pick portrait-oriented images first (more typical mobile screenshots)
    const portrait = catImages.filter(i => i.height > i.width);
    selected.push(portrait.length > 0 ? portrait[0] : catImages[0]);
  }
  // Fill remaining from all images
  for (const img of images) {
    if (selected.length >= opts.count) break;
    if (!selected.find(s => s.hash === img.hash)) selected.push(img);
  }

  log(`Selected ${selected.length} screenshots for pipeline testing`);
  for (const img of selected) {
    log(`  ${img.category}/${img.filename} (${img.width}x${img.height})`);
  }

  if (opts.dryRun) {
    log('\nDry-run mode: generating report layout with source images only');
    const results = selected.map(img => ({
      image: img,
      result: { layout: null, cards: {}, meta: null, events: [] },
      elapsed: 0,
      error: 'Dry run — no pipeline execution',
    }));
    const html = generateReport(results);
    fs.writeFileSync(REPORT_PATH, html);
    log(`Report saved: ${path.relative(process.cwd(), REPORT_PATH)}`);
    return;
  }

  if (opts.production) {
    log(`Using production server: ${baseUrl}`);
  } else {
    if (!process.env.ANTHROPIC_API_KEY) {
      log('\nERROR: ANTHROPIC_API_KEY environment variable is not set.');
      log('Set it with: export ANTHROPIC_API_KEY=sk-ant-...');
      log('Or use --production to test against the live server.');
      log('Or use --dry-run to generate report layout without pipeline execution.');
      process.exit(1);
    }

    // Verify local server is running
    try {
      await new Promise((resolve, reject) => {
        http.get(`${baseUrl}/api/health`, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve(d));
        }).on('error', reject);
      });
      log(`Server is running at ${baseUrl}`);
    } catch {
      log(`Server not reachable at ${baseUrl}. Starting it...`);
      const { spawn } = require('child_process');
      const server = spawn('node', ['api/index.js'], {
        env: { ...process.env, PORT: String(opts.port) },
        stdio: 'pipe',
        detached: true,
      });
      server.unref();
      await new Promise(r => setTimeout(r, 3000));
      log(`Server started (PID: ${server.pid})`);
    }
  }

  // Run each screenshot through the pipeline
  const results = [];
  for (let i = 0; i < selected.length; i++) {
    const img = selected[i];
    const imgPath = path.join(DATASET_DIR, img.path);
    log(`\n[${i + 1}/${selected.length}] Running: ${img.category}/${img.filename}...`);

    try {
      const t0 = Date.now();
      const result = await runPipeline(baseUrl, imgPath);
      const elapsed = Date.now() - t0;

      const cardCount = Object.keys(result.cards).length;
      const layoutType = result.layout?.layout?.type || '?';
      const contentType = result.layout?.contentAnalysis?.contentType || '?';
      log(`  Layout: ${layoutType} | Content: ${contentType} | Cards: ${cardCount} | ${(elapsed / 1000).toFixed(1)}s`);

      for (const card of Object.values(result.cards)) {
        const title = card.data?.title || card.data?.name || card.data?.claim || '(no title)';
        log(`    [${card.cardType}] ${title.substring(0, 60)}`);
      }

      results.push({ image: img, result, elapsed, error: null });
    } catch (err) {
      log(`  ERROR: ${err.message}`);
      results.push({ image: img, result: { layout: null, cards: {}, meta: null, events: [] }, elapsed: 0, error: err.message });
    }
  }

  // Generate HTML report
  const html = generateReport(results);
  fs.writeFileSync(REPORT_PATH, html);
  log(`\nReport saved: ${path.relative(process.cwd(), REPORT_PATH)}`);
  log(`Open in browser to view side-by-side comparison.`);

  // Summary
  const succeeded = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);
  log(`\n=== Results ===`);
  log(`Succeeded: ${succeeded.length}/${results.length}`);
  if (failed.length > 0) {
    log(`Failed: ${failed.map(r => r.image.filename).join(', ')}`);
  }
  if (succeeded.length > 0) {
    const avgDuration = succeeded.reduce((s, r) => s + r.elapsed, 0) / succeeded.length;
    log(`Avg duration: ${(avgDuration / 1000).toFixed(1)}s`);
  }
}

main().catch(err => {
  console.error('[pipeline-test] Fatal:', err.message);
  process.exit(1);
});
