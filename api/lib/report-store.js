/**
 * Report storage — uses a shared Redis client (injected via init())
 * with in-memory fallback when Redis is unavailable.
 *
 * Storage layout:
 *   report:{id}       → JSON metadata  (TTL 30d)
 *   report:{id}:html  → raw HTML       (TTL 30d)
 *   reports:index     → JSON array of IDs
 */

const crypto = require('crypto');

const REPORT_TTL = 30 * 24 * 3600;
const MAX_REPORTS = 50;
const MAX_REPORT_SIZE = 5 * 1024 * 1024;

let _getRedis = null;
const mem = { reports: new Map(), index: [] };

function init(getRedisFunc) { _getRedis = getRedisFunc; }

async function redis() { return _getRedis ? await _getRedis() : null; }

function generateId() { return crypto.randomBytes(6).toString('hex'); }

async function getStorageType() { return (await redis()) ? 'redis' : 'memory'; }

function tryParse(str, fallback) {
  if (str == null) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

async function saveReport({ title, html, meta = {} }) {
  if (!html || html.length > MAX_REPORT_SIZE) {
    throw new Error(`Report too large (max ${MAX_REPORT_SIZE / 1024 / 1024}MB)`);
  }
  const id = generateId();
  const entry = { id, title: title || `Report ${id}`, createdAt: new Date().toISOString(), size: html.length, meta };

  const r = await redis();
  if (r) {
    await r.setex(`report:${id}`, REPORT_TTL, JSON.stringify(entry));
    await r.setex(`report:${id}:html`, REPORT_TTL, html);
    let idx = await r.get('reports:index');
    idx = Array.isArray(idx) ? idx : tryParse(idx, []);
    idx.unshift(id);
    if (idx.length > MAX_REPORTS) idx = idx.slice(0, MAX_REPORTS);
    await r.set('reports:index', JSON.stringify(idx));
  } else {
    mem.reports.set(id, { entry, html });
    mem.index.unshift(id);
    if (mem.index.length > MAX_REPORTS) mem.reports.delete(mem.index.pop());
  }
  return entry;
}

async function listReports() {
  const r = await redis();
  if (r) {
    let idx = await r.get('reports:index');
    idx = Array.isArray(idx) ? idx : tryParse(idx, []);
    const entries = [];
    for (const id of idx) {
      const raw = await r.get(`report:${id}`);
      if (raw) entries.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
    }
    return entries;
  }
  return mem.index.map(id => mem.reports.get(id)?.entry).filter(Boolean);
}

async function getReport(id) {
  const r = await redis();
  if (r) {
    const html = await r.get(`report:${id}:html`);
    if (!html) return null;
    const meta = await r.get(`report:${id}`);
    return { entry: typeof meta === 'string' ? JSON.parse(meta) : meta, html };
  }
  return mem.reports.get(id) || null;
}

async function deleteReport(id) {
  const r = await redis();
  if (r) {
    await r.del(`report:${id}`);
    await r.del(`report:${id}:html`);
    let idx = await r.get('reports:index');
    idx = Array.isArray(idx) ? idx : tryParse(idx, []);
    await r.set('reports:index', JSON.stringify(idx.filter(i => i !== id)));
  } else {
    mem.reports.delete(id);
    mem.index = mem.index.filter(i => i !== id);
  }
}

module.exports = { init, saveReport, listReports, getReport, deleteReport, getStorageType };
