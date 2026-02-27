/**
 * Captures production screenshots for the test dataset.
 *
 * Stores a compressed thumbnail (for browsing) and the full base64 image
 * (for dataset export). Uses the same Redis/memory backend as report-store.
 *
 * Storage layout (Redis):
 *   capture:{id}        → JSON metadata
 *   capture:{id}:thumb  → base64 JPEG thumbnail (~30-80KB)
 *   capture:{id}:full   → original base64 image data
 *   captures:index      → JSON array of IDs (newest first)
 */

const crypto = require('crypto');

const CAPTURE_TTL = 30 * 24 * 3600; // 30 days
const MAX_CAPTURES = 200;
const THUMB_WIDTH = 360;
const THUMB_QUALITY = 70;

let _getRedis = null;
const mem = { captures: new Map(), index: [] };

function init(getRedisFunc) { _getRedis = getRedisFunc; }

async function redis() { return _getRedis ? await _getRedis() : null; }

function tryParse(str, fallback) { try { return JSON.parse(str); } catch { return fallback; } }

async function getStorageType() { return (await redis()) ? 'redis' : 'memory'; }

async function captureScreenshot({ base64Data, mediaType, requestId, pipelineResult }) {
  try {
    const sharp = require('sharp');
    const fullBuf = Buffer.from(base64Data, 'base64');

    const metadata = await sharp(fullBuf).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    // Skip tiny or broken images
    if (width < 100 || height < 100) return null;

    // Generate compressed JPEG thumbnail
    const thumbBuf = await sharp(fullBuf)
      .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();

    const id = crypto.randomBytes(6).toString('hex');
    const hash = crypto.createHash('sha256').update(fullBuf).digest('hex').slice(0, 16);

    const entry = {
      id,
      requestId: requestId || null,
      capturedAt: new Date().toISOString(),
      width,
      height,
      format: metadata.format,
      mediaType,
      originalSize: fullBuf.length,
      thumbSize: thumbBuf.length,
      hash,
      contentType: pipelineResult?.contentType || null,
      platform: pipelineResult?.platform || null,
      layoutType: pipelineResult?.layoutType || null,
      cardCount: pipelineResult?.cardCount || null,
    };

    const thumbBase64 = thumbBuf.toString('base64');

    const r = await redis();
    if (r) {
      await r.setex(`capture:${id}`, CAPTURE_TTL, JSON.stringify(entry));
      await r.setex(`capture:${id}:thumb`, CAPTURE_TTL, thumbBase64);
      await r.setex(`capture:${id}:full`, CAPTURE_TTL, base64Data);

      let idx = await r.get('captures:index');
      idx = Array.isArray(idx) ? idx : tryParse(idx, []);
      idx.unshift(id);
      if (idx.length > MAX_CAPTURES) {
        const removed = idx.splice(MAX_CAPTURES);
        for (const rid of removed) {
          await r.del(`capture:${rid}`);
          await r.del(`capture:${rid}:thumb`);
          await r.del(`capture:${rid}:full`);
        }
      }
      await r.set('captures:index', JSON.stringify(idx));
    } else {
      mem.captures.set(id, { entry, thumb: thumbBase64, full: base64Data });
      mem.index.unshift(id);
      if (mem.index.length > MAX_CAPTURES) {
        const removed = mem.index.splice(MAX_CAPTURES);
        for (const rid of removed) mem.captures.delete(rid);
      }
    }

    return entry;
  } catch {
    return null;
  }
}

async function updateCapturePipelineResult(id, pipelineResult) {
  const r = await redis();
  if (r) {
    const raw = await r.get(`capture:${id}`);
    if (!raw) return;
    const entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
    Object.assign(entry, {
      contentType: pipelineResult.contentType || entry.contentType,
      platform: pipelineResult.platform || entry.platform,
      layoutType: pipelineResult.layoutType || entry.layoutType,
      cardCount: pipelineResult.cardCount || entry.cardCount,
    });
    await r.setex(`capture:${id}`, CAPTURE_TTL, JSON.stringify(entry));
  } else {
    const item = mem.captures.get(id);
    if (item) Object.assign(item.entry, pipelineResult);
  }
}

async function listCaptures({ limit = 50, offset = 0 } = {}) {
  const r = await redis();
  if (r) {
    let idx = await r.get('captures:index');
    idx = Array.isArray(idx) ? idx : tryParse(idx, []);
    const slice = idx.slice(offset, offset + limit);
    const entries = [];
    for (const id of slice) {
      const raw = await r.get(`capture:${id}`);
      if (raw) entries.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
    }
    return { total: idx.length, captures: entries };
  }
  const slice = mem.index.slice(offset, offset + limit);
  return {
    total: mem.index.length,
    captures: slice.map(id => mem.captures.get(id)?.entry).filter(Boolean),
  };
}

async function getCaptureThumbnail(id) {
  const r = await redis();
  if (r) return await r.get(`capture:${id}:thumb`);
  return mem.captures.get(id)?.thumb || null;
}

async function getCaptureFullImage(id) {
  const r = await redis();
  if (r) {
    const entry = await r.get(`capture:${id}`);
    const full = await r.get(`capture:${id}:full`);
    if (!full) return null;
    return {
      entry: typeof entry === 'string' ? JSON.parse(entry) : entry,
      base64: full,
    };
  }
  const item = mem.captures.get(id);
  if (!item) return null;
  return { entry: item.entry, base64: item.full };
}

async function deleteCapture(id) {
  const r = await redis();
  if (r) {
    await r.del(`capture:${id}`);
    await r.del(`capture:${id}:thumb`);
    await r.del(`capture:${id}:full`);
    let idx = await r.get('captures:index');
    idx = Array.isArray(idx) ? idx : tryParse(idx, []);
    await r.set('captures:index', JSON.stringify(idx.filter(i => i !== id)));
  } else {
    mem.captures.delete(id);
    mem.index = mem.index.filter(i => i !== id);
  }
}

module.exports = {
  init,
  captureScreenshot,
  updateCapturePipelineResult,
  listCaptures,
  getCaptureThumbnail,
  getCaptureFullImage,
  deleteCapture,
  getStorageType,
};
