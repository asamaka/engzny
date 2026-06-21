// Strait of Hormuz AIS monitor.
//
// Data source: AISStream.io (free real-time AIS over WebSocket). There is no free
// historical endpoint, so we COLLECT the live stream ourselves into Redis and keep
// a rolling 48h window of per-vessel tracks. A small collector (POST /api/hormuz/
// collect, driven by an external every-~2-min cron) opens the socket for a short
// window, ingests every vessel in the Hormuz bounding box, and merges the points.
//
// Everything except `collectWindow` is pure and unit-tested: classification,
// direction, transit detection, pruning, and the open/closed verdict.

const W = require('./war-sources'); // reuse getRedis()

// ---------------------------------------------------------------- geography
// Strait of Hormuz + immediate approaches. Persian Gulf is to the WEST (lower
// longitude); the Gulf of Oman / open sea is to the EAST (higher longitude). So a
// vessel heading INTO the Gulf moves west (inbound); one leaving moves east.
// AISStream BoundingBoxes use [[lat,lon],[lat,lon]] (NW corner, SE corner).
const BBOX = [[27.2, 54.8], [25.2, 57.8]];
const NARROWS = { lat: 26.57, lon: 56.25 }; // narrowest point
const WINDOW_MS = 48 * 3600 * 1000;

// tunables (env-overridable)
const MOVING_SOG = Number(process.env.HORMUZ_MOVING_SOG || 3);      // knots = underway
const MIN_TRANSIT_NM = Number(process.env.HORMUZ_MIN_TRANSIT_NM || 6); // net displacement to count a transit
const MIN_DLON = Number(process.env.HORMUZ_MIN_DLON || 0.04);       // deg E/W to call a direction
const BASELINE_PER_DAY = Number(process.env.HORMUZ_BASELINE_PER_DAY || 100); // normal transits/day
const MIN_POINT_GAP_MS = Number(process.env.HORMUZ_POINT_GAP_MS || 45000);
const MAX_POINTS = Number(process.env.HORMUZ_MAX_POINTS || 300);
const MAX_VESSELS = Number(process.env.HORMUZ_MAX_VESSELS || 1500);
const WARMUP_H = Number(process.env.HORMUZ_WARMUP_H || 12);

const REDIS_KEY = 'tv:hormuz:v1';

// ---------------------------------------------------------------- helpers
function haversineNm(a, b) {
  if (!a || !b) return 0;
  const R = 3440.065; // nautical miles
  const toR = d => d * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// AIS ship-type code -> coarse class. Codes: 80-89 tanker, 70-79 cargo, 60-69
// passenger, 40-49 high-speed, 50-59 special/service, 30 fishing, 35 military,
// 36/37 sailing/pleasure. Naval often broadcasts 35 or nothing.
function shipClass(type) {
  const t = Number(type);
  if (!Number.isFinite(t) || t <= 0) return 'other';
  if (t >= 80 && t <= 89) return 'tanker';
  if (t >= 70 && t <= 79) return 'cargo';
  if (t >= 60 && t <= 69) return 'passenger';
  if (t >= 40 && t <= 49) return 'hsc';
  if (t === 30) return 'fishing';
  if (t === 35) return 'military';
  if (t === 36 || t === 37) return 'pleasure';
  if (t >= 50 && t <= 59) return 'service';
  return 'other';
}
const CLASS_LABELS = {
  tanker: 'Tankers', cargo: 'Cargo', passenger: 'Passenger', hsc: 'High-speed',
  fishing: 'Fishing', military: 'Military', pleasure: 'Pleasure', service: 'Service/Tug', other: 'Other/Unknown',
};

// Normalize one AISStream envelope into our flat shape, or null if irrelevant.
function normalizeAis(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const meta = raw.MetaData || raw.Metadata || {};
  const mmsi = meta.MMSI || meta.mmsi || (raw.Message && raw.Message.PositionReport && raw.Message.PositionReport.UserID)
    || (raw.Message && raw.Message.ShipStaticData && raw.Message.ShipStaticData.UserID);
  if (!mmsi) return null;
  const t = parseMetaTime(meta.time_utc) || now;
  if (raw.MessageType === 'PositionReport' && raw.Message && raw.Message.PositionReport) {
    const p = raw.Message.PositionReport;
    const lat = num(p.Latitude, meta.latitude), lon = num(p.Longitude, meta.longitude);
    if (lat == null || lon == null) return null;
    return { kind: 'pos', mmsi: String(mmsi), t, lat, lon, sog: num(p.Sog), cog: num(p.Cog), nav: num(p.NavigationalStatus) };
  }
  if (raw.MessageType === 'ShipStaticData' && raw.Message && raw.Message.ShipStaticData) {
    const s = raw.Message.ShipStaticData;
    return { kind: 'static', mmsi: String(mmsi), name: clean(s.Name || meta.ShipName), type: num(s.Type), dest: clean(s.Destination) };
  }
  return null;
}
function num(...vals) { for (const v of vals) { const n = Number(v); if (Number.isFinite(n)) return n; } return null; }
function clean(s) { return s ? String(s).replace(/@+/g, '').replace(/\s+/g, ' ').trim() : ''; }
function parseMetaTime(s) { if (!s) return null; const t = Date.parse(String(s).replace(' +0000 UTC', 'Z').replace(' UTC', 'Z').replace(' ', 'T')); return Number.isFinite(t) ? t : null; }

// ---------------------------------------------------------------- merge / prune
function emptyStore(now = Date.now()) { return { startedAt: now, updatedAt: now, vessels: {} }; }

// Merge normalized messages into the store (pure). Appends a track point only when
// it's meaningfully new (time gap or moved), updates static info, prunes to 48h.
function mergeMessages(store, msgs, now = Date.now()) {
  const s = store && store.vessels ? store : emptyStore(now);
  if (!s.startedAt) s.startedAt = now;
  for (const m of (msgs || [])) {
    if (!m || !m.mmsi) continue;
    const v = s.vessels[m.mmsi] || (s.vessels[m.mmsi] = { mmsi: m.mmsi, name: '', type: null, cls: 'other', dest: '', track: [] });
    if (m.kind === 'static') {
      if (m.name) v.name = m.name;
      if (m.type != null) { v.type = m.type; v.cls = shipClass(m.type); }
      if (m.dest) v.dest = m.dest;
      continue;
    }
    if (m.kind === 'pos') {
      const last = v.track[v.track.length - 1];
      const moved = last ? haversineNm(last, m) : Infinity;
      if (!last || (m.t - last.t) >= MIN_POINT_GAP_MS || moved >= 0.12) {
        v.track.push({ t: m.t, lat: m.lat, lon: m.lon, sog: m.sog == null ? null : Math.round(m.sog * 10) / 10, cog: m.cog == null ? null : Math.round(m.cog), nav: m.nav });
      } else if (m.sog != null) {
        last.sog = Math.round(m.sog * 10) / 10; last.cog = m.cog == null ? last.cog : Math.round(m.cog); last.t = m.t;
      }
    }
  }
  pruneStore(s, now);
  s.updatedAt = now;
  return s;
}

function pruneStore(s, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  for (const mmsi of Object.keys(s.vessels)) {
    const v = s.vessels[mmsi];
    v.track = (v.track || []).filter(p => p.t >= cutoff).sort((a, b) => a.t - b.t);
    if (v.track.length > MAX_POINTS) v.track = downsample(v.track, MAX_POINTS);
    if (!v.track.length) delete s.vessels[mmsi];
  }
  // cap total vessels: keep those most recently seen
  const ids = Object.keys(s.vessels);
  if (ids.length > MAX_VESSELS) {
    ids.map(id => [id, lastT(s.vessels[id])]).sort((a, b) => b[1] - a[1]).slice(MAX_VESSELS).forEach(([id]) => delete s.vessels[id]);
  }
  return s;
}
function downsample(track, max) {
  if (track.length <= max) return track;
  const out = [], step = (track.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(track[Math.round(i * step)]);
  out[out.length - 1] = track[track.length - 1];
  return out;
}
function lastT(v) { const p = v.track && v.track[v.track.length - 1]; return p ? p.t : 0; }

// ---------------------------------------------------------------- analysis
// Classify a vessel's 48h track: moving?, direction, distance, max speed.
function analyzeVessel(v) {
  const track = v.track || [];
  const first = track[0], last = track[track.length - 1];
  const maxSog = track.reduce((m, p) => Math.max(m, p.sog || 0), 0);
  const dist = first && last ? haversineNm(first, last) : 0;
  const dLon = first && last ? (last.lon - first.lon) : 0;
  let direction = 'stationary';
  const moving = maxSog >= MOVING_SOG;
  if (moving && dist >= 1) {
    if (dLon <= -MIN_DLON) direction = 'inbound';        // west -> into the Persian Gulf
    else if (dLon >= MIN_DLON) direction = 'outbound';   // east -> out to the Gulf of Oman
    else direction = 'crossing';                          // moving but no clear E/W net
  }
  const transit = moving && dist >= MIN_TRANSIT_NM && (direction === 'inbound' || direction === 'outbound');
  return { maxSog, dist, dLon, moving, direction, transit, first, last };
}

// Full page payload from the store (pure).
function summarize(store, now = Date.now()) {
  const s = store && store.vessels ? store : emptyStore(now);
  const startedAt = s.startedAt || now;
  const coverageH = Math.min(48, Math.max(0, (now - startedAt) / 3600000));

  const byClass = {}, byDirection = { inbound: 0, outbound: 0, crossing: 0, stationary: 0 };
  let moving = 0, total = 0;
  let transits24 = 0, transits48 = 0;
  const byClass24 = {};
  const movers = []; // vessels that moved, for the map + list

  for (const mmsi of Object.keys(s.vessels)) {
    const v = s.vessels[mmsi];
    if (!v.track || !v.track.length) continue;
    total++;
    const a = analyzeVessel(v);
    byClass[v.cls] = (byClass[v.cls] || 0) + 1;
    byDirection[a.direction] = (byDirection[a.direction] || 0) + 1;
    if (a.moving) moving++;
    const last = a.last, lastSeen = last.t;
    if (a.transit) {
      transits48++;
      if (now - lastSeen <= 24 * 3600000) { transits24++; byClass24[v.cls] = (byClass24[v.cls] || 0) + 1; }
    }
    if (a.moving) {
      movers.push({
        mmsi: v.mmsi, name: v.name || ('MMSI ' + v.mmsi), cls: v.cls, type: v.type, dest: v.dest,
        direction: a.direction, transit: a.transit, maxSog: Math.round(a.maxSog * 10) / 10,
        distNm: Math.round(a.dist * 10) / 10, firstSeen: a.first.t, lastSeen,
        lastPos: { lat: round5(last.lat), lon: round5(last.lon) },
        track: downsample(v.track, 40).map(p => [round5(p.lat), round5(p.lon)]),
      });
    }
  }
  movers.sort((x, y) => y.lastSeen - x.lastSeen);

  // normalize transits to a per-day rate over the observed window (cap at 2 days)
  const obsDays = Math.max(coverageH, 1) / 24;
  const perDay = obsDays > 0 ? transits48 / Math.min(obsDays, 2) : 0;
  const ratio = BASELINE_PER_DAY > 0 ? perDay / BASELINE_PER_DAY : 0;
  const verdict = computeVerdict(coverageH, perDay, ratio);

  return {
    updatedAt: now, startedAt, coverageHours: Math.round(coverageH * 10) / 10,
    bbox: BBOX, narrows: NARROWS, baselinePerDay: BASELINE_PER_DAY,
    counts: { total, moving, stationary: total - moving, byClass, byDirection },
    transits: { last24h: transits24, last48h: transits48, perDay: Math.round(perDay), byClass24h: byClass24 },
    verdict,
    classLabels: CLASS_LABELS,
    movers,
  };
}

function computeVerdict(coverageH, perDay, ratio) {
  if (coverageH < WARMUP_H) {
    return { state: 'WARMING_UP', label: 'Collecting baseline…', detail: `Need ~${WARMUP_H}h of data; have ${Math.round(coverageH)}h.`, ratio: 0 };
  }
  let state, label;
  if (ratio >= 0.6) { state = 'OPEN'; label = 'Open — traffic normal'; }
  else if (ratio >= 0.25) { state = 'REDUCED'; label = 'Reduced traffic'; }
  else if (ratio >= 0.05) { state = 'SEVERELY_REDUCED'; label = 'Severely reduced'; }
  else { state = 'CLOSED'; label = 'No transits detected'; }
  return { state, label, detail: `~${Math.round(perDay)} transits/day vs ~${BASELINE_PER_DAY} normal.`, ratio: Math.round(ratio * 100) / 100 };
}
function round5(n) { return Math.round(n * 1e5) / 1e5; }

// ---------------------------------------------------------------- persistence
async function loadStore(redis = W.getRedis(), now = Date.now()) {
  if (redis) {
    try { const c = await redis.get(REDIS_KEY); if (c) return typeof c === 'string' ? JSON.parse(c) : c; } catch {}
  }
  return emptyStore(now);
}
async function saveStore(store, redis = W.getRedis()) {
  if (!redis) return false;
  try { await redis.set(REDIS_KEY, JSON.stringify(store)); return true; } catch { return false; }
}

// ---------------------------------------------------------------- collector (impure)
// Open the AISStream socket for `ms`, ingest the Hormuz bbox, merge into the store.
function collectWindow({ apiKey, ms = 15000, redis = W.getRedis(), now = () => Date.now() } = {}) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error('AISSTREAM_API_KEY not set'));
    let WS; try { WS = require('ws'); } catch (e) { return reject(new Error('ws module not available')); }
    const batch = []; let received = 0, done = false;
    const ws = new WS('wss://stream.aisstream.io/v0/stream');
    const finish = async (err) => {
      if (done) return; done = true;
      clearTimeout(timer); try { ws.terminate(); } catch {}
      if (err) return reject(err);
      try {
        const store = await loadStore(redis, now());
        mergeMessages(store, batch, now());
        const saved = await saveStore(store, redis);
        resolve({ received, points: batch.length, vessels: Object.keys(store.vessels).length, saved, ms });
      } catch (e) { reject(e); }
    };
    const timer = setTimeout(() => finish(), ms);
    ws.on('open', () => {
      ws.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: [BBOX], FilterMessageTypes: ['PositionReport', 'ShipStaticData'] }));
    });
    ws.on('message', (data) => {
      received++;
      try { const m = normalizeAis(JSON.parse(data.toString()), now()); if (m) batch.push(m); } catch {}
    });
    ws.on('error', (e) => finish(e));
    ws.on('close', () => finish());
  });
}

module.exports = {
  BBOX, NARROWS, REDIS_KEY, CLASS_LABELS,
  haversineNm, shipClass, normalizeAis, emptyStore, mergeMessages, pruneStore,
  analyzeVessel, summarize, computeVerdict, loadStore, saveStore, collectWindow,
};
