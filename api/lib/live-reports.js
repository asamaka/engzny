/**
 * Live Pipeline Reports — auto-generated on every production run.
 *
 * Stores the full populatedLayout (with card content), screenshot thumbnail,
 * pipeline trace, and client report. Each report has a 1-hour TTL.
 *
 * Storage keys (Redis):
 *   livereport:{requestId}       → JSON report data   (TTL 1hr)
 *   livereport:{requestId}:thumb → base64 JPEG thumb  (TTL 1hr)
 *   livereports:index            → JSON array of IDs   (no TTL, pruned)
 */

const REPORT_TTL = 3600; // 1 hour
const MAX_INDEX = 100;

let _getRedis = null;
const mem = { reports: new Map(), index: [] };

function init(getRedisFunc) { _getRedis = getRedisFunc; }

async function redis() { return _getRedis ? await _getRedis() : null; }

function tryParse(str, fb) { try { return JSON.parse(str); } catch { return fb; } }

async function saveLiveReport(requestId, data) {
  const entry = {
    requestId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + REPORT_TTL * 1000).toISOString(),
    ...data,
  };

  const r = await redis();
  if (r) {
    await r.setex(`livereport:${requestId}`, REPORT_TTL, JSON.stringify(entry));
    if (data.thumb) {
      await r.setex(`livereport:${requestId}:thumb`, REPORT_TTL, data.thumb);
    }
    let idx = await r.get('livereports:index');
    idx = Array.isArray(idx) ? idx : tryParse(idx, []);
    idx.unshift(requestId);
    if (idx.length > MAX_INDEX) idx = idx.slice(0, MAX_INDEX);
    await r.set('livereports:index', JSON.stringify(idx));
  } else {
    mem.reports.set(requestId, entry);
    mem.index.unshift(requestId);
    if (mem.index.length > MAX_INDEX) {
      const old = mem.index.splice(MAX_INDEX);
      for (const id of old) mem.reports.delete(id);
    }
    // In-memory TTL cleanup
    setTimeout(() => {
      mem.reports.delete(requestId);
      mem.index = mem.index.filter(i => i !== requestId);
    }, REPORT_TTL * 1000);
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
        // Return summary only (no full card data or thumb in listing)
        entries.push({
          requestId: parsed.requestId,
          createdAt: parsed.createdAt,
          expiresAt: parsed.expiresAt,
          contentType: parsed.contentType,
          layoutType: parsed.layoutType,
          cardCount: parsed.cardCount,
          duration: parsed.duration,
          outcome: parsed.outcome,
          imageSize: parsed.imageSize,
          hasThumb: !!parsed.thumb,
        });
      }
    }
    return entries;
  }
  return mem.index.map(id => {
    const e = mem.reports.get(id);
    if (!e) return null;
    return {
      requestId: e.requestId,
      createdAt: e.createdAt,
      expiresAt: e.expiresAt,
      contentType: e.contentType,
      layoutType: e.layoutType,
      cardCount: e.cardCount,
      duration: e.duration,
      outcome: e.outcome,
      imageSize: e.imageSize,
      hasThumb: !!e.thumb,
    };
  }).filter(Boolean);
}

module.exports = { init, saveLiveReport, getLiveReport, getLiveReportThumb, listLiveReports };
