/**
 * Pipeline Reports — live (48hr TTL) + persistent archive (30 days).
 *
 * Every pipeline run is saved twice:
 *   1. Live report  — 48hr TTL for real-time monitoring
 *   2. Archive copy — 30-day TTL for historical review + search
 *
 * Storage keys (Redis):
 *   livereport:{id}              → JSON (TTL 48hr)
 *   livereport:{id}:thumb        → JPEG base64 (TTL 48hr)
 *   livereport:{id}:render       → JPEG base64 of rendered view (TTL 48hr)
 *   livereport:{id}:dom          → HTML string — DOM snapshot (TTL 48hr)
 *   livereport:{id}:clientstate  → JSON — viewport, cards, layout, perf (TTL 48hr)
 *   livereports:index            → JSON array of IDs
 *
 *   archive:{id}                 → full JSON  (TTL 30d)
 *   archive:{id}:thumb           → JPEG base64 (TTL 30d)
 *   archive:{id}:render          → JPEG base64 of rendered view (TTL 30d)
 *   archive:{id}:dom             → HTML string — DOM snapshot (TTL 30d)
 *   archive:{id}:clientstate     → JSON — viewport, cards, layout, perf (TTL 30d)
 *   archives:index               → JSON array of summary objects (searchable)
 */

const LIVE_TTL = 48 * 3600;     // 48 hours
const ARCHIVE_TTL = 30 * 86400;  // 30 days
const MAX_LIVE_INDEX = 100;
const MAX_ARCHIVE_INDEX = 500;

const { logger } = require('./logger');
const improvementTrigger = require('./improvement-trigger');

let _getRedis = null;
const mem = {
  reports: new Map(), index: [],
  archive: new Map(), archiveIndex: [],
};

function init(getRedisFunc) {
  _getRedis = getRedisFunc;
  improvementTrigger.init(getRedisFunc);
}

async function redis() { return _getRedis ? await _getRedis() : null; }

function tryParse(str, fb) {
  if (str == null) return fb;
  try { return JSON.parse(str); } catch { return fb; }
}

function buildSummary(entry) {
  const fc = entry.factcheck;
  return {
    requestId: entry.requestId,
    createdAt: entry.createdAt,
    contentType: entry.contentType || null,
    platform: entry.platform || null,
    layoutType: entry.layoutType || null,
    cardCount: entry.cardCount || null,
    cardTypes: (entry.cards || []).map(c => c.cardType).filter(Boolean),
    duration: entry.duration || null,
    outcome: entry.outcome || null,
    imageSize: entry.imageSize || null,
    hasThumb: !!entry.thumb,
    heroTitle: entry.cards?.[0]?.data?.title || fc?.explanation || null,
    intent: entry.contentAnalysis?.intent || (fc ? `[${fc.verdict}] ${fc.explanation || ''}`.trim() : null),
    ...(fc ? { factcheck: { verdict: fc.verdict, explanation: fc.explanation, angles: fc.angles, citationCount: fc.citationCount } } : {}),
  };
}

// ── Live reports (1hr TTL) ──────────────────────────────────

async function saveLiveReport(requestId, data) {
  const entry = {
    requestId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + LIVE_TTL * 1000).toISOString(),
    ...data,
  };

  const r = await redis();
  if (r) {
    await r.setex(`livereport:${requestId}`, LIVE_TTL, JSON.stringify(entry));
    if (data.thumb) {
      await r.setex(`livereport:${requestId}:thumb`, LIVE_TTL, data.thumb);
    }
    let idx = await r.get('livereports:index');
    idx = Array.isArray(idx) ? idx : tryParse(idx, []);
    idx.unshift(requestId);
    if (idx.length > MAX_LIVE_INDEX) idx = idx.slice(0, MAX_LIVE_INDEX);
    await r.set('livereports:index', JSON.stringify(idx));
  } else {
    mem.reports.set(requestId, entry);
    mem.index.unshift(requestId);
    if (mem.index.length > MAX_LIVE_INDEX) {
      const old = mem.index.splice(MAX_LIVE_INDEX);
      for (const id of old) mem.reports.delete(id);
    }
    setTimeout(() => {
      mem.reports.delete(requestId);
      mem.index = mem.index.filter(i => i !== requestId);
    }, LIVE_TTL * 1000);
  }

  // Save to persistent archive (30-day TTL).
  // Awaited so it completes before the caller ends the HTTP response —
  // on Vercel serverless, fire-and-forget work after res.end() is unreliable.
  try {
    await saveArchive(requestId, entry);
  } catch (err) {
    logger.warn('LiveReports', 'Archive save failed (best-effort)', { requestId, err: err.message });
  }

  try {
    await improvementTrigger.onReportSaved(entry);
  } catch (err) {
    logger.warn('LiveReports', 'Improvement trigger failed (best-effort)', { requestId, err: err.message });
  }

  return entry;
}

async function getLiveReport(requestId) {
  const r = await redis();
  if (r) {
    const raw = await r.get(`livereport:${requestId}`);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  return mem.reports.get(requestId) || null;
}

async function getLiveReportThumb(requestId) {
  const r = await redis();
  if (r) return await r.get(`livereport:${requestId}:thumb`);
  const entry = mem.reports.get(requestId);
  return entry?.thumb || null;
}

async function listLiveReports() {
  const r = await redis();
  if (r) {
    let idx = await r.get('livereports:index');
    idx = Array.isArray(idx) ? idx : tryParse(idx, []);
    const entries = [];
    for (const id of idx) {
      const raw = await r.get(`livereport:${id}`);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        entries.push({ ...buildSummary(parsed), expiresAt: parsed.expiresAt });
      }
    }
    return entries;
  }
  return mem.index.map(id => {
    const e = mem.reports.get(id);
    if (!e) return null;
    return { ...buildSummary(e), expiresAt: e.expiresAt };
  }).filter(Boolean);
}

// ── Archive (30-day persistent) ─────────────────────────────

async function saveArchive(requestId, entry) {
  const summary = buildSummary(entry);
  const r = await redis();
  if (r) {
    await r.setex(`archive:${requestId}`, ARCHIVE_TTL, JSON.stringify(entry));
    if (entry.thumb) {
      await r.setex(`archive:${requestId}:thumb`, ARCHIVE_TTL, entry.thumb);
    }
    let idx = await r.get('archives:index');
    idx = Array.isArray(idx) ? idx : tryParse(idx, []);
    // Don't duplicate
    idx = idx.filter(s => s.requestId !== requestId);
    idx.unshift(summary);
    if (idx.length > MAX_ARCHIVE_INDEX) idx = idx.slice(0, MAX_ARCHIVE_INDEX);
    await r.set('archives:index', JSON.stringify(idx));
  } else {
    mem.archive.set(requestId, entry);
    mem.archiveIndex = mem.archiveIndex.filter(s => s.requestId !== requestId);
    mem.archiveIndex.unshift(summary);
    if (mem.archiveIndex.length > MAX_ARCHIVE_INDEX) {
      const removed = mem.archiveIndex.splice(MAX_ARCHIVE_INDEX);
      for (const s of removed) mem.archive.delete(s.requestId);
    }
  }
}

async function getArchive(requestId) {
  const r = await redis();
  if (r) {
    const raw = await r.get(`archive:${requestId}`);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  return mem.archive.get(requestId) || null;
}

async function getArchiveThumb(requestId) {
  const r = await redis();
  if (r) return await r.get(`archive:${requestId}:thumb`);
  const entry = mem.archive.get(requestId);
  return entry?.thumb || null;
}

/**
 * Get a report from live store first, fall back to archive.
 */
async function getReport(requestId) {
  const live = await getLiveReport(requestId);
  if (live) return live;
  return getArchive(requestId);
}

async function getReportThumb(requestId) {
  const live = await getLiveReportThumb(requestId);
  if (live) return live;
  return getArchiveThumb(requestId);
}

/**
 * Search/filter archived reports.
 * Filters: q (text), contentType, layoutType, outcome, from, to, cardType
 * All filters are optional, combined with AND.
 */
async function searchArchive({ q, contentType, layoutType, outcome, from, to, cardType, limit = 50, offset = 0 } = {}) {
  const r = await redis();
  let idx;
  if (r) {
    const raw = await r.get('archives:index');
    idx = Array.isArray(raw) ? raw : tryParse(raw, []);
  } else {
    idx = [...mem.archiveIndex];
  }

  let filtered = idx;

  if (q) {
    const ql = q.toLowerCase();
    filtered = filtered.filter(s =>
      (s.heroTitle && s.heroTitle.toLowerCase().includes(ql)) ||
      (s.intent && s.intent.toLowerCase().includes(ql)) ||
      (s.contentType && s.contentType.toLowerCase().includes(ql)) ||
      (s.platform && s.platform.toLowerCase().includes(ql)) ||
      (s.requestId && s.requestId.toLowerCase().includes(ql)) ||
      (s.factcheck?.verdict && s.factcheck.verdict.toLowerCase().includes(ql)) ||
      (s.factcheck?.explanation && s.factcheck.explanation.toLowerCase().includes(ql))
    );
  }
  if (contentType) filtered = filtered.filter(s => s.contentType === contentType);
  if (layoutType) filtered = filtered.filter(s => s.layoutType === layoutType);
  if (outcome) filtered = filtered.filter(s => s.outcome === outcome);
  if (cardType) filtered = filtered.filter(s => s.cardTypes && s.cardTypes.includes(cardType));
  if (from) {
    const fromDate = new Date(from).getTime();
    filtered = filtered.filter(s => new Date(s.createdAt).getTime() >= fromDate);
  }
  if (to) {
    const toDate = new Date(to).getTime();
    filtered = filtered.filter(s => new Date(s.createdAt).getTime() <= toDate);
  }

  return {
    total: filtered.length,
    reports: filtered.slice(offset, offset + limit),
  };
}

// ── Render captures (device screenshot + DOM snapshot + client state) ──

async function saveRenderCapture(requestId, base64Jpeg, { domSnapshot, clientState } = {}) {
  const r = await redis();
  if (r) {
    await r.setex(`livereport:${requestId}:render`, LIVE_TTL, base64Jpeg);
    await r.setex(`archive:${requestId}:render`, ARCHIVE_TTL, base64Jpeg);
    if (domSnapshot) {
      await r.setex(`livereport:${requestId}:dom`, LIVE_TTL, domSnapshot);
      await r.setex(`archive:${requestId}:dom`, ARCHIVE_TTL, domSnapshot);
    }
    if (clientState) {
      const cs = typeof clientState === 'string' ? clientState : JSON.stringify(clientState);
      await r.setex(`livereport:${requestId}:clientstate`, LIVE_TTL, cs);
      await r.setex(`archive:${requestId}:clientstate`, ARCHIVE_TTL, cs);
    }
  } else {
    const setOnEntry = (entry) => {
      if (!entry) return;
      entry._renderCapture = base64Jpeg;
      if (domSnapshot) entry._domSnapshot = domSnapshot;
      if (clientState) entry._clientState = clientState;
    };
    setOnEntry(mem.reports.get(requestId));
    setOnEntry(mem.archive.get(requestId));
  }
}

async function getRenderCapture(requestId) {
  const r = await redis();
  if (r) {
    const live = await r.get(`livereport:${requestId}:render`);
    if (live) return live;
    return await r.get(`archive:${requestId}:render`);
  }
  const entry = mem.reports.get(requestId) || mem.archive.get(requestId);
  return entry?._renderCapture || null;
}

async function getDomSnapshot(requestId) {
  const r = await redis();
  if (r) {
    const live = await r.get(`livereport:${requestId}:dom`);
    if (live) return live;
    return await r.get(`archive:${requestId}:dom`);
  }
  const entry = mem.reports.get(requestId) || mem.archive.get(requestId);
  return entry?._domSnapshot || null;
}

async function getClientState(requestId) {
  const r = await redis();
  if (r) {
    const live = await r.get(`livereport:${requestId}:clientstate`);
    if (live) return typeof live === 'string' ? JSON.parse(live) : live;
    const archived = await r.get(`archive:${requestId}:clientstate`);
    if (archived) return typeof archived === 'string' ? JSON.parse(archived) : archived;
    return null;
  }
  const entry = mem.reports.get(requestId) || mem.archive.get(requestId);
  return entry?._clientState || null;
}

async function getStorageStatus() {
  const r = await redis();
  return r ? 'redis' : 'memory';
}

function _resetForTest() {
  mem.reports.clear(); mem.index.length = 0;
  mem.archive.clear(); mem.archiveIndex.length = 0;
}

module.exports = {
  init,
  saveLiveReport, getLiveReport, getLiveReportThumb, listLiveReports,
  getArchive, getArchiveThumb, getReport, getReportThumb,
  saveRenderCapture, getRenderCapture, getDomSnapshot, getClientState,
  searchArchive, getStorageStatus,
  _resetForTest,
};
