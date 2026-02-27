/**
 * Report storage — persists test reports in Redis (with in-memory fallback).
 *
 * Each report is stored as:
 *   report:{id}       → { id, title, createdAt, meta, size }  (metadata, TTL 30d)
 *   report:{id}:html  → raw HTML string                        (content, TTL 30d)
 *   reports:index     → [ id1, id2, ... ]                      (index list)
 */

const crypto = require('crypto');

const REPORT_TTL = 30 * 24 * 3600; // 30 days
const MAX_REPORTS = 50;
const MAX_REPORT_SIZE = 5 * 1024 * 1024; // 5 MB

// In-memory fallback store
const memStore = {
  reports: new Map(),
  index: [],
};

let _redis = null;
let _redisChecked = false;

async function getRedis() {
  if (_redisChecked) return _redis;
  _redisChecked = true;

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const { Redis } = require('@upstash/redis');
      _redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    } catch { /* fall through to in-memory */ }
  }
  return _redis;
}

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

async function getStorageType() {
  const redis = await getRedis();
  return redis ? 'redis' : 'memory';
}

async function saveReport({ title, html, meta = {} }) {
  if (!html || html.length > MAX_REPORT_SIZE) {
    throw new Error(`Report too large (${((html || '').length / 1024 / 1024).toFixed(1)}MB, max ${MAX_REPORT_SIZE / 1024 / 1024}MB)`);
  }

  const id = generateId();
  const now = new Date().toISOString();
  const entry = {
    id,
    title: title || `Report ${id}`,
    createdAt: now,
    size: html.length,
    meta,
  };

  const redis = await getRedis();
  if (redis) {
    await redis.setex(`report:${id}`, REPORT_TTL, JSON.stringify(entry));
    await redis.setex(`report:${id}:html`, REPORT_TTL, html);

    let index = await redis.get('reports:index');
    index = Array.isArray(index) ? index : (typeof index === 'string' ? JSON.parse(index) : []);
    index.unshift(id);
    if (index.length > MAX_REPORTS) index = index.slice(0, MAX_REPORTS);
    await redis.set('reports:index', JSON.stringify(index));
  } else {
    memStore.reports.set(id, { entry, html });
    memStore.index.unshift(id);
    if (memStore.index.length > MAX_REPORTS) {
      const removed = memStore.index.pop();
      memStore.reports.delete(removed);
    }
  }

  return entry;
}

async function listReports() {
  const redis = await getRedis();
  if (redis) {
    let index = await redis.get('reports:index');
    index = Array.isArray(index) ? index : (typeof index === 'string' ? JSON.parse(index) : []);

    const entries = [];
    for (const id of index) {
      const raw = await redis.get(`report:${id}`);
      if (raw) {
        entries.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
      }
    }
    return entries;
  }

  return memStore.index
    .map(id => memStore.reports.get(id)?.entry)
    .filter(Boolean);
}

async function getReport(id) {
  const redis = await getRedis();
  if (redis) {
    const html = await redis.get(`report:${id}:html`);
    const meta = await redis.get(`report:${id}`);
    if (!html) return null;
    return {
      entry: typeof meta === 'string' ? JSON.parse(meta) : meta,
      html,
    };
  }

  return memStore.reports.get(id) || null;
}

async function deleteReport(id) {
  const redis = await getRedis();
  if (redis) {
    await redis.del(`report:${id}`);
    await redis.del(`report:${id}:html`);

    let index = await redis.get('reports:index');
    index = Array.isArray(index) ? index : (typeof index === 'string' ? JSON.parse(index) : []);
    index = index.filter(i => i !== id);
    await redis.set('reports:index', JSON.stringify(index));
  } else {
    memStore.reports.delete(id);
    memStore.index = memStore.index.filter(i => i !== id);
  }
}

module.exports = { saveReport, listReports, getReport, deleteReport, getStorageType };
