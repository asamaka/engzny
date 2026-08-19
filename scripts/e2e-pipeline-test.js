#!/usr/bin/env node
/**
 * E2E Pipeline Test
 *
 * Sends a real screenshot through the production pipeline and captures
 * every SSE event with precise timestamps. Outputs a timing report
 * showing staleness gaps and LLM trace summary.
 *
 * Usage: node scripts/e2e-pipeline-test.js [--url URL] [--image PATH_OR_URL]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const BASE_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'https://www.thinx.fun';

const IMAGE_ARG = process.argv.includes('--image')
  ? process.argv[process.argv.indexOf('--image') + 1]
  : null;

const SAMPLE_SCREENSHOT_URL = 'https://upload.wikimedia.org/wikipedia/en/thumb/1/17/Google_Pixel_9_Pro.png/220px-Google_Pixel_9_Pro.png';

function log(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const doFetch = (fetchUrl, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      mod.get(fetchUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doFetch(res.headers.location, redirects + 1);
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    };
    doFetch(url);
  });
}

function parseSSEStream(rawText) {
  const events = [];
  let current = { event: null, data: '' };

  for (const line of rawText.split('\n')) {
    if (line.startsWith('event: ')) {
      current.event = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      current.data += line.slice(6);
    } else if (line === '' && current.event) {
      try {
        events.push({ event: current.event, data: JSON.parse(current.data) });
      } catch {
        events.push({ event: current.event, data: current.data });
      }
      current = { event: null, data: '' };
    }
  }
  return events;
}

async function getTestImage() {
  if (IMAGE_ARG) {
    if (IMAGE_ARG.startsWith('http')) {
      log(`Downloading image from ${IMAGE_ARG}...`);
      const buf = await fetchUrl(IMAGE_ARG);
      const ext = IMAGE_ARG.match(/\.(jpe?g|png|gif|webp)/i)?.[1] || 'png';
      const mediaType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      return { base64: buf.toString('base64'), mediaType };
    }
    const filePath = path.resolve(IMAGE_ARG);
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mediaType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
    return { base64: buf.toString('base64'), mediaType };
  }

  log(`Downloading sample screenshot from Wikipedia...`);
  const buf = await fetchUrl(SAMPLE_SCREENSHOT_URL);
  return { base64: buf.toString('base64'), mediaType: 'image/png' };
}

function connectSSE(url) {
  return new Promise((resolve, reject) => {
    const events = [];
    const startTime = Date.now();
    let lastEventTime = startTime;
    let rawBuffer = '';

    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' }
    }, (res) => {
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => reject(new Error(`SSE returned ${res.statusCode}: ${Buffer.concat(chunks).toString()}`)));
        return;
      }

      res.setEncoding('utf8');
      let pendingEvent = null;
      let pendingData = '';

      res.on('data', (chunk) => {
        rawBuffer += chunk;
        const lines = rawBuffer.split('\n');
        rawBuffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event: ')) {
            pendingEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            pendingData += line.slice(6);
          } else if (line === '' && pendingEvent) {
            const now = Date.now();
            const elapsed = now - startTime;
            const gap = now - lastEventTime;
            lastEventTime = now;

            let parsed;
            try { parsed = JSON.parse(pendingData); } catch { parsed = pendingData; }

            const evt = {
              event: pendingEvent,
              data: parsed,
              elapsed,
              gap,
              timestamp: new Date(now).toISOString(),
            };
            events.push(evt);

            const summary = pendingEvent === 'progress'
              ? `${parsed.phase} ${parsed.progress}% - ${parsed.message}`
              : pendingEvent === 'blueprint'
              ? `${(parsed.cards || []).length} skeleton cards`
              : pendingEvent === 'layout_preview'
              ? `${parsed.contentAnalysis?.contentType || '?'} - ${(parsed.cards || []).length} cards`
              : pendingEvent === 'layout_update'
              ? `${parsed.layout?.type} layout - ${(parsed.cards || []).length} cards`
              : pendingEvent === 'card'
              ? `${parsed.cardType} (${parsed.cardId}) ${parsed.completedCount}/${parsed.totalCount}`
              : pendingEvent === 'complete'
              ? `done!`
              : pendingEvent === 'error'
              ? `ERROR: ${parsed.message}`
              : '';

            const gapFlag = gap > 5000 ? ' ⚠️ STALE' : gap > 3000 ? ' ⏳' : '';
            log(`SSE [${pendingEvent}] +${(elapsed/1000).toFixed(1)}s (gap ${(gap/1000).toFixed(1)}s${gapFlag}) ${summary}`);

            if (pendingEvent === 'complete' || pendingEvent === 'error') {
              req.destroy();
              resolve(events);
            }

            pendingEvent = null;
            pendingData = '';
          }
        }
      });

      res.on('end', () => resolve(events));

      setTimeout(() => {
        req.destroy();
        resolve(events);
      }, 120000);
    });

    req.on('error', reject);
  });
}

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  thinx.fun E2E Pipeline Test');
  console.log(`  Target: ${BASE_URL}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 0: Health check
  log('Checking health...');
  const health = await httpRequest(`${BASE_URL}/api/health`);
  if (health.status !== 200) {
    console.error(`Health check failed: ${health.status} ${health.body.toString()}`);
    process.exit(1);
  }
  log(`Health OK: ${health.body.toString().slice(0, 100)}`);

  // Step 1: Get test image
  const { base64, mediaType } = await getTestImage();
  log(`Image ready: ${mediaType}, ${Math.round(base64.length * 0.75 / 1024)}KB`);

  // Step 2: POST to start pipeline
  const t0 = Date.now();
  log('POST /api/hub/v2/start ...');
  const startPayload = JSON.stringify({ image: base64, mediaType });
  const startRes = await httpRequest(`${BASE_URL}/api/hub/v2/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: startPayload,
  });

  const uploadDuration = Date.now() - t0;
  if (startRes.status !== 200) {
    console.error(`Start failed: ${startRes.status} ${startRes.body.toString()}`);
    process.exit(1);
  }

  const { requestId } = JSON.parse(startRes.body.toString());
  log(`Upload complete in ${uploadDuration}ms — requestId: ${requestId}`);

  // Step 3: Connect SSE stream
  log(`GET /api/hub/v2/stream/${requestId} ...`);
  const sseStart = Date.now();
  const events = await connectSSE(`${BASE_URL}/api/hub/v2/stream/${requestId}`);
  const totalDuration = Date.now() - t0;

  // Step 4: Analyze results
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  TIMELINE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log(`Upload:       ${uploadDuration}ms`);
  console.log(`SSE connect:  ${events[0] ? events[0].elapsed : '?'}ms`);
  console.log(`Total:        ${(totalDuration/1000).toFixed(1)}s`);
  console.log(`Events:       ${events.length}`);
  console.log('');

  // Timeline table
  console.log('┌─────────┬────────────────┬──────────┬──────────┬────────────────────────────────────────────────┐');
  console.log('│ Time    │ Event          │ Gap      │ Stale?   │ Details                                        │');
  console.log('├─────────┼────────────────┼──────────┼──────────┼────────────────────────────────────────────────┤');

  let maxGap = 0;
  let staleCount = 0;

  for (const evt of events) {
    const time = `+${(evt.elapsed/1000).toFixed(1)}s`.padEnd(7);
    const name = evt.event.padEnd(14);
    const gap = `${(evt.gap/1000).toFixed(1)}s`.padEnd(8);
    const stale = evt.gap > 5000 ? 'YES ⚠️  ' : evt.gap > 3000 ? 'slow    ' : '        ';
    if (evt.gap > 5000) staleCount++;
    if (evt.gap > maxGap) maxGap = evt.gap;

    let detail = '';
    if (evt.event === 'progress') {
      detail = `${evt.data.phase} ${evt.data.progress}% — ${evt.data.message || ''}`;
    } else if (evt.event === 'blueprint') {
      detail = `${(evt.data.cards||[]).length} skeleton cards`;
    } else if (evt.event === 'layout_preview') {
      detail = `${evt.data.contentAnalysis?.contentType} → ${(evt.data.cards||[]).length} cards (${evt.data.layout?.type})`;
    } else if (evt.event === 'layout_update') {
      detail = `${evt.data.layout?.type} layout → ${(evt.data.cards||[]).length} cards`;
    } else if (evt.event === 'card') {
      const meta = evt.data.data?._researchMeta || {};
      const webBadge = meta.webSearch ? ' [WEB]' : meta.perplexity ? ' [PPLX]' : '';
      detail = `${evt.data.cardType} (${evt.data.cardId}) ${meta.duration ? (meta.duration/1000).toFixed(1)+'s' : ''}${webBadge} ${evt.data.completedCount}/${evt.data.totalCount}`;
    } else if (evt.event === 'complete') {
      detail = `${evt.data.meta?.totalDuration ? (evt.data.meta.totalDuration/1000).toFixed(1)+'s total' : ''} ${evt.data.meta?.cardsResearched || '?'} cards researched`;
    } else if (evt.event === 'connected') {
      detail = `requestId: ${evt.data.requestId}`;
    } else if (evt.event === 'error') {
      detail = evt.data.message || 'unknown error';
    }

    console.log(`│ ${time} │ ${name} │ ${gap} │ ${stale} │ ${detail.slice(0,48).padEnd(48)} │`);
  }

  console.log('└─────────┴────────────────┴──────────┴──────────┴────────────────────────────────────────────────┘');

  // Phase breakdown
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  PHASE BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════\n');

  const connected = events.find(e => e.event === 'connected');
  const blueprint = events.find(e => e.event === 'blueprint');
  const preview = events.find(e => e.event === 'layout_preview');
  const layoutUpdate = events.find(e => e.event === 'layout_update');
  const firstCard = events.find(e => e.event === 'card');
  const lastCard = [...events].reverse().find(e => e.event === 'card');
  const complete = events.find(e => e.event === 'complete');
  const errorEvt = events.find(e => e.event === 'error');

  if (connected) console.log(`  SSE Connected:       +${(connected.elapsed/1000).toFixed(1)}s`);
  if (blueprint) console.log(`  Skeleton Blueprint:  +${(blueprint.elapsed/1000).toFixed(1)}s`);
  if (preview)   console.log(`  Fast Classify:       +${(preview.elapsed/1000).toFixed(1)}s (Haiku)`);
  if (layoutUpdate) console.log(`  Layout Design:       +${(layoutUpdate.elapsed/1000).toFixed(1)}s (Sonnet)`);
  if (firstCard) console.log(`  First Card:          +${(firstCard.elapsed/1000).toFixed(1)}s`);
  if (lastCard)  console.log(`  Last Card:           +${(lastCard.elapsed/1000).toFixed(1)}s`);
  if (complete)  console.log(`  Pipeline Complete:   +${(complete.elapsed/1000).toFixed(1)}s`);
  if (errorEvt)  console.log(`  ERROR:               +${(errorEvt.elapsed/1000).toFixed(1)}s — ${errorEvt.data.message}`);

  console.log('');
  if (preview && blueprint) {
    console.log(`  Classify → Skeleton upgrade:   ${((preview.elapsed - blueprint.elapsed)/1000).toFixed(1)}s`);
  }
  if (layoutUpdate && (preview || blueprint)) {
    const ref = preview || blueprint;
    console.log(`  Design phase duration:         ${((layoutUpdate.elapsed - ref.elapsed)/1000).toFixed(1)}s`);
  }
  if (firstCard && layoutUpdate) {
    console.log(`  Layout → First card:           ${((firstCard.elapsed - layoutUpdate.elapsed)/1000).toFixed(1)}s`);
  }
  if (lastCard && firstCard && lastCard !== firstCard) {
    console.log(`  Research spread (first-last):  ${((lastCard.elapsed - firstCard.elapsed)/1000).toFixed(1)}s`);
  }

  // Card details
  const cardEvents = events.filter(e => e.event === 'card');
  if (cardEvents.length > 0) {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  CARD RESEARCH DETAILS');
    console.log('═══════════════════════════════════════════════════════\n');

    for (const ce of cardEvents) {
      const d = ce.data.data || {};
      const meta = d._researchMeta || {};
      const cardType = ce.data.cardType;
      const model = meta.model || '?';
      const dur = meta.duration ? `${(meta.duration/1000).toFixed(1)}s` : '?';
      const web = meta.webSearch ? 'Claude Web Search' : meta.perplexity ? 'Perplexity Sonar' : 'Vision only';
      const citations = (meta.citations || d._webCitations || []).length;
      const err = meta.error ? ` ERROR: ${meta.error}` : '';

      console.log(`  ${ce.data.cardId} (${cardType})`);
      console.log(`    Model: ${model}  Duration: ${dur}  Research: ${web}${citations ? `  Citations: ${citations}` : ''}${err}`);

      // Show key data fields
      const preview = {};
      for (const [k, v] of Object.entries(d)) {
        if (k.startsWith('_')) continue;
        if (typeof v === 'string' && v.length > 0) preview[k] = v.length > 80 ? v.slice(0, 77) + '...' : v;
        else if (typeof v === 'number') preview[k] = v;
        else if (Array.isArray(v)) preview[k] = `[${v.length} items]`;
      }
      if (Object.keys(preview).length > 0) {
        for (const [k, v] of Object.entries(preview)) {
          console.log(`    ${k}: ${v}`);
        }
      }
      console.log('');
    }
  }

  // Staleness report
  console.log('═══════════════════════════════════════════════════════');
  console.log('  STALENESS REPORT');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log(`  Max gap between events:  ${(maxGap/1000).toFixed(1)}s`);
  console.log(`  Stale gaps (>5s):        ${staleCount}`);
  console.log(`  Total events:            ${events.length}`);
  console.log(`  Total pipeline time:     ${(totalDuration/1000).toFixed(1)}s`);

  const rating = maxGap <= 3000 ? 'EXCELLENT' : maxGap <= 5000 ? 'GOOD' : maxGap <= 10000 ? 'ACCEPTABLE' : 'POOR — user may feel stuck';
  console.log(`  Engagement rating:       ${rating}`);
  console.log('');

  // Also pull the debug pipeline trace for this request
  const DEBUG_TOKEN = 'thinx-debug-2026';
  try {
    const traceRes = await httpRequest(`${BASE_URL}/api/debug/pipelines?token=${DEBUG_TOKEN}`);
    if (traceRes.status === 200) {
      const traces = JSON.parse(traceRes.body.toString());
      const thisTrace = (traces.pipelines || traces || []).find(t => t.requestId === requestId);
      if (thisTrace) {
        console.log('═══════════════════════════════════════════════════════');
        console.log('  SERVER-SIDE PIPELINE TRACE');
        console.log('═══════════════════════════════════════════════════════\n');
        console.log(JSON.stringify(thisTrace, null, 2));
      }
    }
  } catch {}

  // Pull the LLM trace from report endpoint
  try {
    const reportRes = await httpRequest(`${BASE_URL}/api/r/${requestId}/data?pin=0427`, {
      headers: { 'Cookie': 'report_pin=0427' }
    });
    if (reportRes.status === 200) {
      const report = JSON.parse(reportRes.body.toString());
      if (report.llmTraceSummary) {
        console.log('\n═══════════════════════════════════════════════════════');
        console.log('  LLM TRACE SUMMARY (from live report)');
        console.log('═══════════════════════════════════════════════════════\n');
        const s = report.llmTraceSummary;
        console.log(`  Traces:        ${s.traceCount}`);
        console.log(`  Models:        ${(s.models || []).join(', ')}`);
        console.log(`  Input tokens:  ${s.totalInputTokens}`);
        console.log(`  Output tokens: ${s.totalOutputTokens}`);
        console.log(`  Total LLM ms:  ${s.totalLlmDuration}ms (${(s.totalLlmDuration/1000).toFixed(1)}s)`);
      }
      if (report.llmTraces && report.llmTraces.length > 0) {
        console.log('\n  Individual LLM Calls:');
        for (const t of report.llmTraces) {
          const inp = t.response?.usage?.input_tokens || 0;
          const out = t.response?.usage?.output_tokens || 0;
          const web = t.response?.webSearchUsed ? ' [WEB SEARCH]' : '';
          const pplx = t.request?.perplexityUsed ? ' [PERPLEXITY]' : '';
          console.log(`    ${t.phase.padEnd(10)} ${t.agent.padEnd(18)} ${t.model.padEnd(30)} ${(t.duration/1000).toFixed(1)}s  ${inp}→${out} tok${web}${pplx}${t.error ? ` ERR: ${t.error}` : ''}`);
        }
      }
    }
  } catch {}

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
}

run().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
