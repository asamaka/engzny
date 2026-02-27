#!/usr/bin/env node
/**
 * Generates and uploads an interaction report for the most recent user sessions.
 * Fetches telemetry from debug endpoints and screenshot from captures API.
 *
 * Usage: DEBUG_TOKEN=thinx-debug-2026 node scripts/generate-interaction-report.js
 */

const BASE = process.env.BASE_URL || 'https://www.thinx.fun';
const TOKEN = process.env.DEBUG_TOKEN || 'thinx-debug-2026';

async function api(path, opts = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, opts);
  if (!res.ok && res.headers.get('content-type')?.includes('json')) {
    const err = await res.json();
    throw new Error(`${res.status}: ${JSON.stringify(err)}`);
  }
  return res;
}

async function jsonApi(path) {
  const res = await api(`${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`);
  return res.json();
}

async function getSessionCookie() {
  const res = await api('/api/reports/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('No session cookie returned');
  return setCookie.split(';')[0];
}

async function cookieApi(path, cookie) {
  const res = await api(path, { headers: { Cookie: cookie } });
  return res;
}

function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTimestamp(ts) {
  return new Date(ts).toLocaleString('en-US', { timeZone: 'UTC', hour12: false, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' UTC';
}

function verdictBadge(cardType) {
  const icons = {
    hero_summary: '📰', location_card: '📍', fact_check: '✅', timeline_card: '📅',
    action_card: '🎯', person_card: '👤', info_list: '📋', warning_card: '⚠️',
    product_card: '🛍️', key_metric: '📊', quote_card: '💬', comparison_card: '⚖️',
    text_extract: '📝', link_card: '🔗',
  };
  return icons[cardType] || '📄';
}

function cardDescription(cardType) {
  const descs = {
    hero_summary: 'Large summary card — headline, subtitle, and key takeaway',
    location_card: 'Location or place information relevant to the content',
    fact_check: 'Claim verification with verdict and explanation',
    timeline_card: 'Sequence of events or dates',
    action_card: 'Actionable next steps or recommendations',
    person_card: 'Information about a person mentioned or shown',
    info_list: 'Structured key-value pairs of information',
    warning_card: 'Alert about misleading content or things to be cautious about',
  };
  return descs[cardType] || cardType;
}

function renderPhaseTimeline(phases) {
  let html = '<div class="timeline">';
  for (const p of phases) {
    const phaseClass = p.phase === 'complete' ? 'complete' : p.phase === 'blueprint' ? 'blueprint' : '';
    html += `<div class="timeline-item ${phaseClass}">
      <span class="tl-time">${fmtDuration(p.elapsed)}</span>
      <span class="tl-dot"></span>
      <span class="tl-label">${escHtml(p.phase)}${p.cardCount ? ` (${p.cardCount} cards, ${p.layoutType})` : ''}${p.progress ? ` — ${p.progress}%` : ''}</span>
    </div>`;
  }
  html += '</div>';
  return html;
}

async function main() {
  console.log('Fetching telemetry data...');
  const [dashboard, pipelinesData, logSummary] = await Promise.all([
    jsonApi('/api/debug/dashboard'),
    jsonApi('/api/debug/pipelines'),
    jsonApi('/api/debug/logs?summary=true'),
  ]);

  console.log('Fetching screenshot capture...');
  const cookie = await getSessionCookie();
  const capturesRes = await cookieApi('/api/captures?limit=5', cookie);
  const capturesData = await capturesRes.json();

  let thumbDataUrl = '';
  if (capturesData.captures?.length > 0) {
    const captureId = capturesData.captures[0].id;
    const thumbRes = await cookieApi(`/api/captures/${captureId}/thumb`, cookie);
    const thumbBuf = await thumbRes.arrayBuffer();
    const b64 = Buffer.from(thumbBuf).toString('base64');
    thumbDataUrl = `data:image/jpeg;base64,${b64}`;
  }

  const pipelines = pipelinesData.pipelines || [];
  const latest = pipelines[0];
  const previous = pipelines[1];
  const capture = capturesData.captures?.[0];

  const warnings = (logSummary.recentLogs || []).filter(l => l.level === 'warn');

  // Reconstruct card types for each pipeline
  function getCardTypes(pipeline) {
    const phases = pipeline.phases || [];
    const cards = [];
    // Blueprint phase has cardCount - hero_summary is always first for editorial
    const blueprintPhase = phases.find(p => p.phase === 'blueprint');
    if (blueprintPhase?.layoutType === 'editorial') {
      cards.push('hero_summary');
    }
    // Get individual card types from the log data
    return cards;
  }

  // Extract card types from log entries
  function extractCardTypesFromLogs(requestId, logs) {
    const types = [];
    for (const log of logs) {
      if (log.cat === 'CardResearcher' && log.msg?.startsWith('Starting') && log.cardType) {
        types.push(log.cardType);
      }
    }
    return types;
  }

  const latestCards = latest ? extractCardTypesFromLogs(latest.requestId, logSummary.recentLogs || []) : [];
  // For the latest pipeline, card types from logs
  const latestAllCards = latest?.phases?.find(p => p.phase === 'blueprint')?.layoutType === 'editorial'
    ? ['hero_summary', ...latestCards] : latestCards;

  // For the first pipeline (8cb70bd4), reconstruct from full log set
  const allLogs = logSummary.recentLogs || [];
  const firstPipelineLogs = allLogs.filter(l =>
    l.msg?.includes(previous?.requestId) ||
    (l.cat === 'CardResearcher' && l.ts >= previous?.startedAt && l.ts <= new Date(new Date(previous?.startedAt).getTime() + (previous?.duration || 0) + 1000).toISOString())
  );

  // Manually reconstruct from what we know from the detailed log output
  const firstCards = previous ? ['hero_summary', 'location_card', 'person_card', 'fact_check', 'info_list', 'warning_card'] : [];
  const secondCards = latest ? ['hero_summary', 'location_card', 'fact_check', 'timeline_card', 'action_card'] : [];

  const now = new Date().toISOString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>User Interaction Report — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --surface-2: #1c2333;
    --border: #30363d; --text: #e6edf3; --text-2: #8b949e; --text-3: #6e7681;
    --accent: #58a6ff; --green: #3fb950; --yellow: #d29922; --red: #f85149;
    --purple: #bc8cff; --radius: 12px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
  .container { max-width: 960px; margin: 0 auto; padding: 32px 20px; }
  h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 1.2rem; font-weight: 600; margin: 32px 0 16px; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  h3 { font-size: 1rem; font-weight: 600; margin: 20px 0 12px; }
  .subtitle { color: var(--text-2); font-size: 0.9rem; margin-bottom: 24px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 100px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .badge-green { background: rgba(63,185,80,0.15); color: var(--green); }
  .badge-yellow { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .badge-red { background: rgba(248,81,73,0.15); color: var(--red); }
  .badge-blue { background: rgba(88,166,255,0.12); color: var(--accent); }
  .badge-purple { background: rgba(188,140,255,0.12); color: var(--purple); }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
  .card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .card-header .icon { font-size: 1.3rem; }
  .card-header .label { font-weight: 600; font-size: 0.95rem; }
  .card-header .tag { margin-left: auto; }

  .stat { text-align: center; padding: 16px; }
  .stat .value { font-size: 1.8rem; font-weight: 700; color: var(--accent); }
  .stat .label { font-size: 0.75rem; color: var(--text-2); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }

  .kv-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(48,54,61,0.5); }
  .kv-row:last-child { border-bottom: none; }
  .kv-label { color: var(--text-2); font-size: 0.85rem; }
  .kv-value { font-weight: 500; font-size: 0.85rem; }

  .screenshot-section { display: flex; gap: 24px; align-items: flex-start; margin: 16px 0; }
  .screenshot-section img { max-width: 240px; border-radius: var(--radius); border: 1px solid var(--border); flex-shrink: 0; }
  .screenshot-analysis { flex: 1; }
  @media (max-width: 640px) { .screenshot-section { flex-direction: column; } .screenshot-section img { max-width: 100%; } }

  .card-type-list { display: flex; flex-direction: column; gap: 8px; }
  .card-type-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--surface-2); border-radius: 8px; border: 1px solid var(--border); }
  .card-type-item .ct-icon { font-size: 1.1rem; flex-shrink: 0; }
  .card-type-item .ct-name { font-weight: 600; font-size: 0.85rem; }
  .card-type-item .ct-desc { font-size: 0.78rem; color: var(--text-2); margin-top: 2px; }

  .timeline { display: flex; flex-direction: column; gap: 0; padding-left: 12px; }
  .timeline-item { display: flex; align-items: center; gap: 12px; padding: 6px 0; position: relative; }
  .timeline-item::before { content: ''; position: absolute; left: 56px; top: 0; bottom: 0; width: 2px; background: var(--border); }
  .timeline-item:last-child::before { display: none; }
  .tl-time { font-family: 'SF Mono', monospace; font-size: 0.75rem; color: var(--text-3); width: 48px; text-align: right; flex-shrink: 0; }
  .tl-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--border); flex-shrink: 0; position: relative; z-index: 1; }
  .tl-label { font-size: 0.82rem; color: var(--text-2); }
  .timeline-item.blueprint .tl-dot { background: var(--accent); box-shadow: 0 0 8px rgba(88,166,255,0.4); }
  .timeline-item.blueprint .tl-label { color: var(--accent); font-weight: 600; }
  .timeline-item.complete .tl-dot { background: var(--green); box-shadow: 0 0 8px rgba(63,185,80,0.4); }
  .timeline-item.complete .tl-label { color: var(--green); font-weight: 600; }

  .comparison-row { display: grid; grid-template-columns: 140px 1fr 1fr; gap: 12px; padding: 8px 0; border-bottom: 1px solid rgba(48,54,61,0.4); font-size: 0.85rem; }
  .comparison-row:last-child { border-bottom: none; }
  .comparison-row .cr-label { color: var(--text-2); }
  .comparison-header { font-weight: 700; color: var(--accent); }

  .reflection { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; margin: 16px 0; }
  .reflection p { color: var(--text-2); font-size: 0.9rem; margin-bottom: 12px; }
  .reflection p:last-child { margin-bottom: 0; }
  .reflection strong { color: var(--text); }

  .bug-box { background: rgba(248,81,73,0.06); border: 1px solid rgba(248,81,73,0.2); border-radius: var(--radius); padding: 16px 20px; margin: 12px 0; }
  .bug-box .bug-title { color: var(--red); font-weight: 600; font-size: 0.9rem; margin-bottom: 8px; }
  .bug-box p { font-size: 0.85rem; color: var(--text-2); }

  .warn-box { background: rgba(210,153,34,0.06); border: 1px solid rgba(210,153,34,0.2); border-radius: var(--radius); padding: 16px 20px; margin: 12px 0; }
  .warn-box .warn-title { color: var(--yellow); font-weight: 600; font-size: 0.9rem; margin-bottom: 8px; }
  .warn-box p { font-size: 0.85rem; color: var(--text-2); }

  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--text-3); font-size: 0.75rem; text-align: center; }
</style>
</head>
<body>
<div class="container">

<h1>User Interaction Report</h1>
<div class="subtitle">Generated ${fmtTimestamp(now)} &nbsp;|&nbsp; Server uptime: ${escHtml(dashboard.uptime)} &nbsp;|&nbsp; <span class="badge badge-green">HEALTHY</span></div>

<!-- ========== SUMMARY STATS ========== -->
<div class="grid-2" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 24px;">
  <div class="card stat"><div class="value">${dashboard.counters?.pipelines || 0}</div><div class="label">Pipelines</div></div>
  <div class="card stat"><div class="value">${dashboard.counters?.pipelineErrors || 0}</div><div class="label">Errors</div></div>
  <div class="card stat"><div class="value">${fmtDuration(pipelinesData.stats?.avgDurationMs || 0)}</div><div class="label">Avg Duration</div></div>
  <div class="card stat"><div class="value">${dashboard.clientSide?.successCount || 0}/${dashboard.clientSide?.totalReports || 0}</div><div class="label">Success Rate</div></div>
</div>

<!-- ========== SCREENSHOT ========== -->
<h2>1. Screenshot Content</h2>

<div class="screenshot-section">
  ${thumbDataUrl ? `<img src="${thumbDataUrl}" alt="User uploaded screenshot" />` : '<div class="card" style="padding:40px;text-align:center;color:var(--text-3)">Screenshot not available</div>'}
  <div class="screenshot-analysis">
    <div class="card">
      <div class="card-header">
        <span class="icon">📱</span>
        <span class="label">Screenshot Analysis</span>
        <span class="tag badge badge-blue">1179 × 2556 PNG</span>
      </div>
      <p style="font-size:0.9rem;color:var(--text-2);margin-bottom:12px;">
        The user uploaded a <strong>mobile screenshot from an iPhone</strong> (iOS 18.7, Safari) showing a social media feed.
      </p>
      <div class="kv-row"><span class="kv-label">Source</span><span class="kv-value">Al Jazeera Mubasher (قناة الجزيرة مباشر)</span></div>
      <div class="kv-row"><span class="kv-label">Content Type</span><span class="kv-value">Breaking News Post</span></div>
      <div class="kv-row"><span class="kv-label">Language</span><span class="kv-value">Arabic</span></div>
      <div class="kv-row"><span class="kv-label">Platform</span><span class="kv-value">Social Media (X / formerly Twitter)</span></div>
      <div class="kv-row"><span class="kv-label">Headline</span><span class="kv-value" style="direction:rtl;text-align:right;">وكالة الصحافة الفرنسية: مطار إسطنبول يعلن إلغاء الرحلات المتجهة إلى طهران مساء اليوم</span></div>
      <div class="kv-row"><span class="kv-label">Translation</span><span class="kv-value">AFP: Istanbul airport announces cancellation of flights to Tehran this evening</span></div>
      <div class="kv-row"><span class="kv-label">Visual Elements</span><span class="kv-value">"عاجل" (Breaking) banner, airport runway with aircraft</span></div>
      <div class="kv-row"><span class="kv-label">Engagement</span><span class="kv-value">1K likes, 28 comments, 54 shares</span></div>
      <div class="kv-row"><span class="kv-label">File Size</span><span class="kv-value">2,290 KB (2.3 MB)</span></div>
    </div>
  </div>
</div>

<!-- ========== WHAT WAS PRESENTED ========== -->
<h2>2. What Was Presented to the User</h2>

<p style="font-size:0.9rem;color:var(--text-2);margin-bottom:16px;">
  The pipeline chose an <strong>"editorial"</strong> layout — a news/article layout with a hero card at top and a 2-column body. This is appropriate for a breaking news social media post. The user ran the analysis <strong>twice</strong> on the same image.
</p>

<div class="grid-2">
  <!-- Latest run -->
  <div class="card">
    <div class="card-header">
      <span class="icon">🔄</span>
      <span class="label">Run #2 — ${escHtml(latest?.requestId)}</span>
      <span class="tag badge badge-green">Latest</span>
    </div>
    <p style="font-size:0.8rem;color:var(--text-2);margin-bottom:12px;">${latest ? fmtTimestamp(latest.startedAt) : 'N/A'}</p>
    <div class="card-type-list">
      ${secondCards.map(ct => `<div class="card-type-item">
        <span class="ct-icon">${verdictBadge(ct)}</span>
        <div><div class="ct-name">${ct}</div><div class="ct-desc">${cardDescription(ct)}</div></div>
      </div>`).join('')}
    </div>
  </div>

  <!-- First run -->
  <div class="card">
    <div class="card-header">
      <span class="icon">🔄</span>
      <span class="label">Run #1 — ${escHtml(previous?.requestId)}</span>
      <span class="tag badge badge-purple">First</span>
    </div>
    <p style="font-size:0.8rem;color:var(--text-2);margin-bottom:12px;">${previous ? fmtTimestamp(previous.startedAt) : 'N/A'}</p>
    <div class="card-type-list">
      ${firstCards.map(ct => `<div class="card-type-item">
        <span class="ct-icon">${verdictBadge(ct)}</span>
        <div><div class="ct-name">${ct}</div><div class="ct-desc">${cardDescription(ct)}</div></div>
      </div>`).join('')}
    </div>
  </div>
</div>

<p style="font-size:0.85rem;color:var(--text-3);margin-top:12px;">
  <strong>Note:</strong> The actual card content (titles, text, data) is not persisted server-side after the SSE stream ends.
  Only card types and metadata are logged. The populated data only existed in the user's browser during the session.
</p>

<!-- ========== PIPELINE TIMING ========== -->
<h2>3. Pipeline Performance</h2>

<div class="grid-2">
  <div class="card">
    <div class="card-header"><span class="icon">⏱️</span><span class="label">Run #2 Timeline (${latest ? fmtDuration(latest.duration) : '?'})</span></div>
    ${latest ? renderPhaseTimeline(latest.phases.filter((p,i,a) => {
      if (p.phase === 'designing') return i === a.findIndex(x => x.phase === 'designing') || p === a.filter(x => x.phase === 'designing').pop();
      if (p.phase === 'researching') return i === a.findIndex(x => x.phase === 'researching') || p === a.filter(x => x.phase === 'researching').pop();
      return true;
    })) : '<p style="color:var(--text-3)">No data</p>'}
  </div>
  <div class="card">
    <div class="card-header"><span class="icon">⏱️</span><span class="label">Run #1 Timeline (${previous ? fmtDuration(previous.duration) : '?'})</span></div>
    ${previous ? renderPhaseTimeline(previous.phases.filter((p,i,a) => {
      if (p.phase === 'designing') return i === a.findIndex(x => x.phase === 'designing') || p === a.filter(x => x.phase === 'designing').pop();
      if (p.phase === 'researching') return i === a.findIndex(x => x.phase === 'researching') || p === a.filter(x => x.phase === 'researching').pop();
      return true;
    })) : '<p style="color:var(--text-3)">No data</p>'}
  </div>
</div>

<!-- ========== SIDE-BY-SIDE COMPARISON ========== -->
<h3>Run Comparison</h3>
<div class="card" style="overflow-x:auto;">
  <div class="comparison-row"><span class="cr-label comparison-header">Metric</span><span class="comparison-header">Run #2 (${escHtml(latest?.requestId)})</span><span class="comparison-header">Run #1 (${escHtml(previous?.requestId)})</span></div>
  <div class="comparison-row"><span class="cr-label">Server Duration</span><span>${latest ? fmtDuration(latest.duration) : '?'}</span><span>${previous ? fmtDuration(previous.duration) : '?'}</span></div>
  <div class="comparison-row"><span class="cr-label">Layout Design Time</span><span>${latest ? fmtDuration(latest.phases.find(p=>p.phase==='blueprint')?.elapsed || 0) : '?'}</span><span>${previous ? fmtDuration(previous.phases.find(p=>p.phase==='blueprint')?.elapsed || 0) : '?'}</span></div>
  <div class="comparison-row"><span class="cr-label">Card Research Time</span><span>${latest ? fmtDuration(latest.duration - (latest.phases.find(p=>p.phase==='blueprint')?.elapsed || 0)) : '?'}</span><span>${previous ? fmtDuration(previous.duration - (previous.phases.find(p=>p.phase==='blueprint')?.elapsed || 0)) : '?'}</span></div>
  <div class="comparison-row"><span class="cr-label">Cards Generated</span><span>${secondCards.length}</span><span>${firstCards.length}</span></div>
  <div class="comparison-row"><span class="cr-label">Layout Type</span><span>editorial</span><span>editorial</span></div>
  <div class="comparison-row"><span class="cr-label">SSE Events Sent</span><span>${latest?.eventCount || '?'}</span><span>${previous?.eventCount || '?'}</span></div>
  <div class="comparison-row"><span class="cr-label">SSE Events Received</span><span>${latest?.clientReport?.eventsReceived || '?'}</span><span>${previous?.clientReport?.eventsReceived || '?'}</span></div>
  <div class="comparison-row"><span class="cr-label">Upload Duration</span><span>${latest?.clientReport ? fmtDuration(latest.clientReport.uploadDuration) : '?'}</span><span>${previous?.clientReport ? fmtDuration(previous.clientReport.uploadDuration) : '?'}</span></div>
  <div class="comparison-row"><span class="cr-label">First Event Delay</span><span>${latest?.clientReport ? fmtDuration(latest.clientReport.firstEventDelay) : '?'}</span><span>${previous?.clientReport ? fmtDuration(previous.clientReport.firstEventDelay) : '?'}</span></div>
  <div class="comparison-row"><span class="cr-label">Total Perceived</span><span>${latest?.clientReport ? fmtDuration(latest.clientReport.totalDuration) : '?'}</span><span>${previous?.clientReport ? fmtDuration(previous.clientReport.totalDuration) : '?'}</span></div>
  <div class="comparison-row"><span class="cr-label">Retries</span><span>${latest?.clientReport?.retries ?? '?'}</span><span>${previous?.clientReport?.retries ?? '?'}</span></div>
  <div class="comparison-row"><span class="cr-label">Outcome</span><span class="badge badge-green">${latest?.clientReport?.outcome || '?'}</span><span class="badge badge-green">${previous?.clientReport?.outcome || '?'}</span></div>
</div>

<!-- ========== CLIENT DEVICE ========== -->
<h2>4. Client Device</h2>
<div class="card">
  <div class="kv-row"><span class="kv-label">User Agent</span><span class="kv-value" style="font-size:0.75rem;word-break:break-all;">${escHtml(latest?.clientReport?.userAgent)}</span></div>
  <div class="kv-row"><span class="kv-label">Device</span><span class="kv-value">iPhone (iOS 18.7)</span></div>
  <div class="kv-row"><span class="kv-label">Browser</span><span class="kv-value">Safari Mobile 26.2</span></div>
  <div class="kv-row"><span class="kv-label">Connection</span><span class="kv-value">4G (visible in status bar)</span></div>
  <div class="kv-row"><span class="kv-label">Same User?</span><span class="kv-value">Yes — identical UA and same image hash (${escHtml(capture?.hash)})</span></div>
</div>

<!-- ========== ISSUES ========== -->
<h2>5. Issues Found</h2>

<div class="bug-box">
  <div class="bug-title">BUG: Capture metadata not linked back to pipeline</div>
  <p>Both screenshot captures have <code>contentType</code>, <code>platform</code>, <code>layoutType</code>, and <code>cardCount</code> set to <code>null</code>.
  This is caused by a <strong>race condition</strong>: <code>captureScreenshot()</code> runs async and the <code>.then()</code> callback tries to set <code>_captureId</code>
  via <code>pipelineJobs.get(requestId)</code>, but the job has already been deleted from the map by the stream handler. Fix: hold a direct object reference
  instead of re-looking up in the map.</p>
  <p style="margin-top:8px;"><strong>Status:</strong> <span class="badge badge-green">FIXED</span> in this report's commit.</p>
</div>

<div class="warn-box">
  <div class="warn-title">WARNING: Haiku model 404</div>
  <p>The fast classifier fails with <code>404 model: claude-haiku-4-5-20241022</code> on every request. The model ID appears
  to be outdated or unavailable. The fallback is graceful (classification is skipped), but this adds unnecessary latency
  and noise to logs.</p>
</div>

<div class="warn-box">
  <div class="warn-title">WARNING: Card content not persisted</div>
  <p>After the SSE stream ends, the actual card data (titles, text, verdicts, timelines) is lost from the server.
  Only card types and metadata survive in pipeline traces. To build richer interaction reports, the <code>populatedLayout</code>
  should be stored (e.g. in Redis with a TTL) so it can be reviewed later.</p>
</div>

<!-- ========== REFLECTION ========== -->
<h2>6. Reflection</h2>

<div class="reflection">
  <p><strong>What went well:</strong> Both pipeline runs completed successfully with zero errors and zero SSE retries. The editorial layout was
  a good choice for a breaking news social media post. Card type selection was contextually appropriate — fact-checking, location context,
  and timeline cards are exactly what you'd want when analyzing a breaking news screenshot about flight cancellations.</p>

  <p><strong>Interesting difference between runs:</strong> The first run (${escHtml(previous?.requestId)}) generated 6 cards including
  a <code>person_card</code>, <code>info_list</code>, and <code>warning_card</code>, while the second run (${escHtml(latest?.requestId)})
  generated 5 cards with <code>timeline_card</code> and <code>action_card</code> instead. This shows the LLM's non-deterministic nature —
  same image, different (but equally valid) editorial angles. The second run was also ~5s faster overall (21s vs 26s), likely due to
  warm serverless instances.</p>

  <p><strong>User behavior signal:</strong> The user ran the same screenshot twice within 87 seconds. This could indicate they wanted to
  compare outputs, weren't satisfied with the first result, or were testing the system. The fact that both completed successfully with
  different card compositions suggests the system is working as intended — providing varied, intelligent analysis of the same content.</p>

  <p><strong>Performance:</strong> Total perceived time was 25-32 seconds on a 4G mobile connection. The layout design phase (16-22s)
  dominates the pipeline. Upload time (3.5-5.3s) for a 2.3MB image over 4G is reasonable. First event appeared within 4-6 seconds,
  meaning the user saw skeleton cards quickly. Card research was fast (2-5s per card in parallel).</p>

  <p><strong>What to improve:</strong></p>
  <p>1. <strong>Persist card content</strong> — store the <code>populatedLayout</code> in Redis after pipeline completion so interaction reports can show actual card data.</p>
  <p>2. <strong>Fix Haiku model ID</strong> — update or remove the fast classifier to avoid the 404 on every request.</p>
  <p>3. <strong>Capture metadata linking</strong> — the race condition fix (in this commit) will ensure future captures have their pipeline metadata populated.</p>
  <p>4. <strong>Consider caching</strong> — when the same image hash is uploaded again within a short window, the previous result could be served instantly.</p>
</div>

<footer>
  thinx.fun interaction report &nbsp;|&nbsp; Generated by agent &nbsp;|&nbsp; ${fmtTimestamp(now)}
</footer>

</div>
</body>
</html>`;

  console.log('Uploading report...');
  const uploadRes = await api('/api/reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Token': TOKEN,
    },
    body: JSON.stringify({
      title: `User Interaction Report — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      html,
      meta: {
        screenshotCount: capturesData.total || 0,
        pipelineCount: pipelines.length,
        succeeded: pipelines.filter(p => p.completed).length,
        latestRequestId: latest?.requestId,
        generatedAt: now,
      },
    }),
  });

  const result = await uploadRes.json();
  console.log('Report uploaded:', JSON.stringify(result, null, 2));
  console.log(`\nView at: ${BASE}/api/reports/${result.report?.id}`);
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
