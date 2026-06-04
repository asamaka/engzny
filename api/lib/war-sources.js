/**
 * war-sources.js — shared data fetchers for the Iran-war TV products.
 *
 * Extracted from api/index.js so both the live endpoints and the scheduled
 * cinematic-intel builder (scripts/build-intel.js) reuse one implementation.
 *
 * Self-contained: owns its Redis + Anthropic clients (lazy), RSS parser,
 * Polymarket market fetch (broad list + spike detection), og:image/Wikipedia
 * image resolver, and Open-Meteo weather. No dependency on api/index.js.
 */
const RssParser = require('rss-parser');

// ---------------------------------------------------------------- clients
let _redis = null;
function getRedis() {
  if (_redis !== null) return _redis;
  const c = [
    { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN },
    { url: process.env.UPSTASH_REDIS_REST_KV_REST_API_URL, token: process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN },
    { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN },
    { url: process.env.KV_URL, token: process.env.KV_REST_API_TOKEN },
    { url: process.env.REDIS_REST_URL, token: process.env.REDIS_REST_TOKEN },
    { url: process.env.REDIS_URL, token: process.env.REDIS_TOKEN },
  ].find(x => x.url && x.token);
  if (!c) { _redis = false; return false; }
  try {
    const { Redis } = require('@upstash/redis');
    _redis = new Redis({ url: c.url, token: c.token });
  } catch { _redis = false; }
  return _redis;
}

let _anthropic = null;
function getAnthropic() {
  if (_anthropic !== null) return _anthropic;
  if (!process.env.ANTHROPIC_API_KEY) { _anthropic = false; return false; }
  try {
    const Anthropic = require('@anthropic-ai/sdk').default;
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });
  } catch { _anthropic = false; }
  return _anthropic;
}

// thin helper: one-shot text completion, returns the joined text or ''
async function anthropicText({ model, max_tokens, system, prompt }) {
  const a = getAnthropic();
  if (!a) return '';
  const req = { model, max_tokens, messages: [{ role: 'user', content: prompt }] };
  if (system) req.system = system;
  const r = await a.messages.create(req);
  return (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

const log = (...a) => console.log('[war-sources]', ...a);

// ---------------------------------------------------------------- RSS feeds
const WAR_FEEDS = [
  { id: 'bbc-mideast', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', category: 'western' },
  { id: 'cnn-mideast', name: 'CNN', url: 'http://rss.cnn.com/rss/edition_meast.rss', category: 'western' },
  { id: 'fox-world', name: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/world.xml', category: 'western' },
  { id: 'france24', name: 'France 24', url: 'https://www.france24.com/en/middle-east/rss', category: 'western' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/middleeast/rss', category: 'western' },
  { id: 'dw', name: 'DW News', url: 'https://rss.dw.com/xml/rss-en-all', category: 'western' },
  { id: 'google-iran', name: 'Google News', url: 'https://news.google.com/rss/search?q=iran+war+2026&hl=en-US&gl=US&ceid=US:en', category: 'western' },
  { id: 'aljazeera-me', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'arab' },
  { id: 'jpost', name: 'Jerusalem Post', url: 'https://www.jpost.com/rss/rssfeedsarabisraeliconflict.aspx', category: 'israeli' },
  { id: 'presstv', name: 'Press TV', url: 'https://www.presstv.ir/rss.xml', category: 'iranian' },
  { id: 'tehrantimes', name: 'Tehran Times', url: 'https://www.tehrantimes.com/rss', category: 'iranian' },
  { id: 'egypt-indep', name: 'Egypt Independent', url: 'https://www.egyptindependent.com/feed/', category: 'arab' },
];

const WAR_START_DATE = process.env.INTEL_WAR_START || '2026-03-01';
const HAIKU_MODEL = process.env.INTEL_HAIKU || 'claude-haiku-4-5-20251001';
const IRAN_FALLBACK = /iran|iranian|tehran|irgc|hormuz|isfahan|khamenei|hezbollah|lebanon|beirut|israel|nuclear|ceasefire/i;
const rssParser = new RssParser({ timeout: 7000, headers: { 'User-Agent': 'ThinxTV/1.0' } });

async function filterIranWarRelevant(items, type) {
  if (items.length === 0) return [];
  const a = getAnthropic();
  if (!a) return items.filter(i => IRAN_FALLBACK.test((i.title || '') + ' ' + (i.description || '')));
  try {
    const BATCH = 120, out = [];
    for (let off = 0; off < items.length; off += BATCH) {
      const chunk = items.slice(off, off + BATCH);
      const numbered = chunk.map((it, i) => `${i + 1}. ${it.title || ''}${it.description ? ' — ' + it.description.substring(0, 60) : ''}`).join('\n');
      const r = await a.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 600,
        temperature: 0,   // deterministic selection: same input -> same picks (stable run-to-run)
        messages: [{ role: 'user', content: 'Filter ' + type + ' for an IRAN WAR dashboard. Return ONLY the line numbers relevant to: the Iran war (Iran-Israel/US-Iran conflict), IRGC, Strait of Hormuz, Iranian nuclear program, strikes on/by Iran, Iran proxies (Hezbollah/Houthis), sanctions on Iran, Iran ceasefire talks, Iranian regime, or direct consequences (oil shock, regional fallout, diplomacy about Iran). Comma-separated numbers only. If none, return NONE.\n\n' + numbered }],
      });
      const text = (r.content[0].text || '').trim();
      if (text !== 'NONE') {
        const nums = text.match(/\d+/g) || [];
        for (const n of nums) { const idx = parseInt(n) - 1; if (idx >= 0 && idx < chunk.length) out.push(items[off + idx]); }
      }
    }
    return out;
  } catch (e) {
    log('haiku filter failed, regex fallback', e.message);
    return items.filter(i => IRAN_FALLBACK.test((i.title || '') + ' ' + (i.description || '')));
  }
}

async function fetchWarHeadlines() {
  const results = await Promise.allSettled(WAR_FEEDS.map(async (feed) => {
    try {
      const parsed = await rssParser.parseURL(feed.url);
      return (parsed.items || []).map(item => ({
        feedId: feed.id, source: feed.name, sourceCategory: feed.category,
        title: (item.title || '').trim(), link: item.link || '',
        description: (item.contentSnippet || item.content || '').substring(0, 200),
        publishedAt: item.isoDate || item.pubDate || null,
        imageUrl: item.enclosure?.url || null,
      }));
    } catch { return []; }
  }));

  const sourceStatus = {};
  WAR_FEEDS.forEach((feed, i) => {
    const r = results[i];
    sourceStatus[feed.id] = r.status === 'fulfilled' && r.value.length > 0 ? 'ok' : (r.status === 'rejected' ? 'error' : 'empty');
  });

  let items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []).filter(i => i.title);
  items = await filterIranWarRelevant(items, 'headlines');

  // dedupe (>60% word overlap)
  const seen = [], deduped = [];
  for (const item of items) {
    const norm = item.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const words = norm.split(/\s+/).filter(w => w.length > 3);
    if (!words.length) continue;
    let dupe = false;
    for (const prev of seen) {
      if (prev.norm === norm) { dupe = true; break; }
      const overlap = words.filter(w => prev.words.includes(w)).length;
      if (overlap / Math.max(words.length, prev.words.length) > 0.6) { dupe = true; break; }
    }
    if (dupe) continue;
    seen.push({ norm, words }); deduped.push(item);
  }

  const now = Date.now();
  deduped.forEach(i => { i._ts = i.publishedAt ? new Date(i.publishedAt).getTime() : (now - 3600000); });
  deduped.sort((a, b) => b._ts - a._ts);

  const buckets = { western: [], iranian: [], israeli: [], arab: [] };
  for (const i of deduped) { if (buckets[i.sourceCategory]) buckets[i.sourceCategory].push(i); }
  const reserved = [];
  for (const items of Object.values(buckets)) reserved.push(...items.slice(0, 5));
  const reservedIds = new Set(reserved.map(i => i.feedId + ':' + i.title));
  const remaining = deduped.filter(i => !reservedIds.has(i.feedId + ':' + i.title));
  const final = [...reserved, ...remaining].slice(0, 50);
  final.sort((a, b) => b._ts - a._ts);

  return {
    headlines: final.map((item, i) => ({
      id: `${item.feedId}-${i}`, source: item.source, sourceCategory: item.sourceCategory,
      title: item.title, link: item.link, description: item.description,
      publishedAt: item.publishedAt, imageUrl: item.imageUrl,
      ageMinutes: item._ts ? Math.round((now - item._ts) / 60000) : null,
    })),
    sourceStatus, fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- images
function isGoodImage(url) {
  if (!url) return false;
  if (url.includes('googleusercontent.com') && !url.includes('photo.jpg')) return false;
  if (url.includes('google.com/s2/favicons')) return false;
  if (url.length < 30) return false;
  return true;
}

async function extractOgImage(url) {
  if (!url || url.includes('news.google.com')) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ThinxTV/1.0)' } });
    clearTimeout(t);
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/<meta[^>]+property=["'](?:og:image|og:image:url|twitter:image)["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:image|twitter:image)["']/i);
    let img = m ? m[1] : null;
    if (img && img.startsWith('//')) img = 'https:' + img;
    return isGoodImage(img) ? img : null;
  } catch { return null; }
}

async function wikiImage(keyword) {
  if (!keyword) return null;
  try {
    const title = encodeURIComponent(keyword.trim().replace(/\s+/g, '_'));
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`, { headers: { 'User-Agent': 'ThinxTV/1.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.originalimage && j.originalimage.source) || (j.thumbnail && j.thumbnail.source) || null;
  } catch { return null; }
}

// ---- keyless web image search (illustrative photo for a segment) ----------
// When a segment has no usable og:image (common for wire/state-media stories), we
// resolve an illustrative photo from a free, keyless source using a short, concrete
// visual query (an LLM picks the query upstream). Wikimedia Commons first (real
// editorial/landmark photos, stable hotlinking), then Openverse (CC-licensed).
async function commonsPhoto(query, { minWidth = 600 } = {}) {
  if (!query) return null;
  try {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1000&format=json&origin=*`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': 'ThinxTV/1.0 (intel image)' } });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
    // Keep search order; prefer real photos (jpeg) of reasonable size, skip svg/diagrams/icons.
    const cand = pages
      .map(p => (p.imageinfo && p.imageinfo[0]) || null)
      .filter(Boolean)
      .filter(ii => /jpe?g/i.test(ii.mime || '') && (ii.thumbwidth || ii.width || 0) >= minWidth)
      .filter(ii => !LOGO_HINT.test(ii.thumburl || ii.url || ''))
      .map(ii => ii.thumburl || ii.url)[0];
    return cand || null;
  } catch { return null; }
}
async function openversePhoto(query) {
  if (!query) return null;
  try {
    const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=4&mature=false`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': 'ThinxTV/1.0 (intel image)' } });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const res = (j.results || []).find(x => x && (x.url || x.thumbnail));
    return res ? (res.url || res.thumbnail) : null;
  } catch { return null; }
}
/** Resolve an illustrative photo URL for a concrete visual query (keyless). */
async function searchPhoto(query) {
  if (!query) return null;
  return (await commonsPhoto(query)) || (await openversePhoto(query));
}

const IMG_KEYWORDS = ['Beaufort Castle', 'Strait of Hormuz', 'Beirut', 'Tehran', 'Lebanon', 'Iran', 'Israel', 'Bandar Abbas'];

/** Resolve a story image: og:image of candidate urls -> wikipedia entity -> null. */
async function resolveStoryImage(urls, headline) {
  const real = (urls || []).filter(Boolean);
  const settled = await Promise.allSettled(real.slice(0, 5).map(u => extractOgImage(u)));
  for (const s of settled) if (s.status === 'fulfilled' && s.value) return s.value;
  for (const kw of IMG_KEYWORDS) {
    if ((headline || '').toLowerCase().includes(kw.toLowerCase())) {
      const w = await wikiImage(kw);
      if (w) return w;
    }
  }
  return null;
}

// ---------------------------------------------------------------- markets + spikes
const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isMarketDateExpired(question, now) {
  const re = /(?:by|on|before)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:[,\s]+(\d{4}))?/gi;
  let m;
  while ((m = re.exec(question)) !== null) {
    const deadline = new Date(m[3] ? parseInt(m[3]) : now.getFullYear(), MONTHS[m[1].toLowerCase()], parseInt(m[2]), 23, 59, 59);
    if (deadline < now) return true;
  }
  return false;
}

/** Human-friendly "by date" for a market: prefer a date in the question, else endDate. */
function parseByDate(question, endDate) {
  const re = /(?:by|on|before)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:[,\s]+(\d{4}))?/i;
  const m = (question || '').match(re);
  if (m) {
    const yr = m[3] ? (', ' + m[3]) : '';
    return 'by ' + m[1].slice(0, 3) + ' ' + parseInt(m[2]) + yr;
  }
  if (endDate) {
    const d = new Date(endDate);
    if (!isNaN(d)) return 'by ' + MON_SHORT[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }
  return null;
}

const MARKET_KEYWORDS = ['iran', 'iranian', 'tehran', 'hormuz', 'irgc', 'khamenei', 'ceasefire', 'nuclear deal',
  'nuclear weapon', 'hezbollah', 'lebanon', 'beirut', 'israel', 'gaza', 'houthi', 'strait', 'oil price', 'crude',
  'middle east', 'netanyahu', 'trump iran', 'regime'];

/**
 * Broad Iran-related open markets from Polymarket Gamma, with settled filtering
 * and recent price-change (spike) detection. Returns { markets, fetchedAt }.
 */
async function fetchWarMarkets() {
  // PASS 1: scan events
  let allEvents = [];
  try {
    const offsets = [];
    for (let o = 0; o <= 3000; o += 100) offsets.push(o);
    for (let i = 0; i < offsets.length; i += 10) {
      const batch = offsets.slice(i, i + 10).map(offset =>
        fetch(`https://gamma-api.polymarket.com/events?limit=100&active=true&closed=false&offset=${offset}`)
          .then(r => r.ok ? r.json() : []).catch(() => []));
      const results = await Promise.all(batch);
      for (const events of results) for (const e of events) allEvents.push(e);
      if (results.some(r => r.length < 100)) break;
    }
  } catch (e) { log('gamma scan failed', e.message); }

  const seenSlugs = new Set();
  allEvents = allEvents.filter(e => { const k = e.slug || e.id; if (seenSlugs.has(k)) return false; seenSlugs.add(k); return true; });
  log(`scanned ${allEvents.length} events`);

  // PASS 2: Haiku relevance selection (fallback to broad keyword list)
  let selected = new Set();
  const a = getAnthropic();
  if (a && allEvents.length) {
    try {
      const titleList = allEvents.map((e, i) => `${i}. ${e.title || e.slug}`).join('\n');
      const r = await a.messages.create({
        model: HAIKU_MODEL, max_tokens: 3000, temperature: 0,   // deterministic market selection
        messages: [{ role: 'user', content: `Select prediction markets for a US-Iran war (2026) TV dashboard. Include ANYTHING tied to: Iran war/strikes/escalation/de-escalation, Iran ceasefire/peace talks, Iran nuclear program/deal, Iran regime/IRGC, Strait of Hormuz/Persian Gulf, US-Iran relations/sanctions, Israel-Iran, Hezbollah, Lebanon front, oil/energy IF tied to the Iran conflict. Exclude: Ukraine-Russia (unless Iran-linked), US domestic politics, crypto, sports, entertainment, non-Iran conflicts. Return ONLY a JSON array of index numbers. Events:\n${titleList}` }],
      });
      const m = (r.content[0].text || '').match(/\[[\d,\s]+\]/);
      if (m) for (const i of JSON.parse(m[0])) if (i >= 0 && i < allEvents.length) selected.add(allEvents[i].slug || allEvents[i].id);
      log(`haiku selected ${selected.size} events`);
    } catch (e) { log('haiku market select failed', e.message); }
  }
  if (selected.size === 0) {
    for (const e of allEvents) {
      const text = ((e.title || '') + ' ' + (e.slug || '')).toLowerCase();
      if (MARKET_KEYWORDS.some(k => text.includes(k))) selected.add(e.slug || e.id);
    }
    log(`keyword fallback selected ${selected.size} events`);
  }

  // PASS 3: extract open markets + price-change
  const now = new Date();
  let markets = [];
  for (const event of allEvents) {
    const key = event.slug || event.id;
    if (!selected.has(key)) continue;
    for (const m of (event.markets || [])) {
      if (m.closed) continue;
      const prices = m.outcomePrices ? (typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices) : [];
      const yes = parseFloat(prices[0]) || 0;
      if (yes <= 0.02 || yes >= 0.98) continue; // resolved-ish band (settled)
      const vol = parseFloat(m.volume || '0');
      if (vol < 20000) continue; // drop micro/spam
      const endDate = m.endDate || m.expirationDate || event.endDate || null;
      if (endDate && new Date(endDate) < now) continue;
      const question = m.question || event.title || '';
      if (isMarketDateExpired(question, now)) continue;
      const d1h = numOrNull(m.oneHourPriceChange);
      const d24h = numOrNull(m.oneDayPriceChange);
      const d1w = numOrNull(m.oneWeekPriceChange);
      let yesToken = null;
      try {
        const toks = m.clobTokenIds ? (typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds) : [];
        yesToken = Array.isArray(toks) ? (toks[0] || null) : null;
      } catch {}
      markets.push({
        id: m.id || m.conditionId || `poly-${markets.length}`,
        conditionId: m.conditionId || null,
        yesToken,                       // CLOB token id for the YES outcome -> real price history on demand
        question,
        probability: Math.round(yes * 1000) / 1000,
        volume: `$${(vol / 1e6).toFixed(1)}M`, volumeNum: vol / 1e6,
        delta1h: d1h, delta24h: d24h, delta1w: d1w,
        imageUrl: event.image || m.image || null,
        eventSlug: event.slug || null,
        endDate,
        byDate: parseByDate(question, endDate),
      });
    }
  }
  const seenIds = new Set();
  markets = markets.filter(m => { if (seenIds.has(m.id)) return false; seenIds.add(m.id); return true; });
  markets.sort((a, b) => (b.volumeNum || 0) - (a.volumeNum || 0));
  return { markets, fetchedAt: new Date().toISOString() };
}

function numOrNull(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

// ---------------------------------------------------------------- real price history
// We no longer track prices ourselves. For the FEW markets we actually display we
// pull authoritative history straight from the Polymarket CLOB on demand. This is
// stateless (no Redis series to manage) and scales because we only ever fetch
// history for the handful of markets that reach the screen.

/** Fetch real price history for a CLOB YES-token. Returns [{t,p}] (t=sec, p=0..1) or null. */
async function fetchMarketHistory(yesToken, { interval = '1w', fidelity = 60 } = {}) {
  if (!yesToken) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`https://clob.polymarket.com/prices-history?market=${yesToken}&interval=${interval}&fidelity=${fidelity}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json();
    const h = (j.history || []).filter(p => p && typeof p.p === 'number' && typeof p.t === 'number');
    return h.length ? h : null;
  } catch { return null; }
}

/** Downsample a probability series (0..1) into a 7-point sparkline (0..22, smaller=higher). */
function sparkFromHistory(pts) {
  const tail = pts.slice(-48);
  if (tail.length < 2) return [11, 11, 11, 11, 11, 11, 11];
  const lo = Math.min(...tail), hi = Math.max(...tail), range = (hi - lo) || 1;
  const n = 7, out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (tail.length - 1)) / (n - 1));
    out.push(Math.round(22 - ((tail[idx] - lo) / range) * 22));
  }
  return out;
}

/** Measured delta vs ~hoursAgo using real history. */
function measuredDelta(hist, hoursAgo) {
  if (!hist || !hist.length) return null;
  const last = hist[hist.length - 1];
  const target = last.t - hoursAgo * 3600;
  let ref = hist[0];
  for (const pt of hist) { if (pt.t <= target) ref = pt; else break; }
  return last.p - ref.p;
}

/**
 * Cheap, stateless candidate prefilter: top-N markets by any available Gamma
 * movement, with liquidity (volume) as the tiebreaker. We then pull REAL history
 * for just these candidates to measure the true move. Gamma's change fields are
 * spotty, so volume keeps the candidate net wide enough to not miss a real mover.
 */
function pickSpikeCandidates(markets, { max = 10 } = {}) {
  return markets
    .map(m => {
      const gMove = [m.delta24h, m.delta1h, (m.delta1w != null ? m.delta1w * 0.3 : 0)]
        .map(x => Math.abs(x || 0)).reduce((a, b) => Math.max(a, b), 0);
      return { m, score: gMove * 100 + Math.min(5, m.volumeNum || 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(x => x.m);
}

/**
 * Pull real CLOB history for the candidate markets, measure the true recent move,
 * and return the top `max` genuine movers (>= threshold) formatted for the bundle.
 * Falls back to Gamma deltas + a synthetic spark if a market has no history.
 */
async function enrichSpikesWithHistory(candidates, { threshold = 0.03, max = 4, interval = '1w', fidelity = 60 } = {}) {
  const enriched = await Promise.all(candidates.map(async (m) => {
    const hist = await fetchMarketHistory(m.yesToken, { interval, fidelity });
    let history = [], spark = null, d24 = null, d1 = null;
    if (hist && hist.length >= 3) {
      history = hist.map(p => Math.round(p.p * 1000) / 1000);
      spark = sparkFromHistory(hist.map(p => p.p));
      d24 = measuredDelta(hist, 24);
      d1 = measuredDelta(hist, 1);
    }
    const signed = d24 != null ? d24 : (m.delta24h != null ? m.delta24h : (m.delta1h || 0));
    const moveAbs = [d24, d1, m.delta24h, m.delta1h].map(x => Math.abs(x || 0)).reduce((a, b) => Math.max(a, b), 0);
    if (!spark) {
      const dir = signed >= 0 ? -1 : 1;
      spark = [11, 11, 11, 11, 11, 11].map((v, i) => Math.max(2, Math.min(20, v + dir * (i - 2) * 2)));
    }
    return { m, history, spark, signed, moveAbs };
  }));
  return enriched
    .filter(x => x.moveAbs >= threshold)
    .sort((a, b) => b.moveAbs - a.moveAbs)
    .slice(0, max)
    .map(({ m, history, spark, signed, moveAbs }) => {
      const pct = Math.round(m.probability * 100);
      const deltaPts = Math.round(signed * 100);
      const up = signed >= 0;
      return {
        id: m.id, conditionId: m.conditionId, question: m.question,
        yesToken: m.yesToken || null,   // lets us re-price this exact market later without a full markets fetch
        prob: pct + '%',
        probColor: pct <= 15 ? 'red' : (pct >= 60 ? 'green' : 'amber'),
        delta: (up ? '+' : '') + deltaPts + ' pts',
        deltaColor: up ? 'green' : 'red',
        meta: m.volume + ' vol',
        byDate: m.byDate || null,
        history,
        spike: true, moveAbs, spark,
        eventSlug: m.eventSlug, imageUrl: m.imageUrl,
      };
    });
}

// ---------------------------------------------------------------- YouTube videos (keyless RSS)
const WAR_YT_CHANNELS = {
  'UCknLrEdhRCp1aegoMqRhGGw': 'Reuters',
  'UC52X5wxOL_s5yw0dQk7NtgA': 'Al Jazeera English',
  'UCupvZG-5ko_eiXAupbDfxWw': 'CNN',
  'UCXIJgqnII2ZOINSValKDNAQ': 'BBC News',
  'UCaXkIU1QidjPwiAYu6GcHjg': 'TRT World',
  'UCNye-wNBqNL5ZzHSJj3l8Bg': 'France 24 English',
  'UC16niRr50-MSBwiO3YDb3RA': 'DW News',
  'UCeY0bbntWzzVIaj2z3QigXg': 'NBC News',
};

function ytId(item) {
  if (item.id && item.id.indexOf('yt:video:') === 0) return item.id.slice('yt:video:'.length);
  const m = (item.link || '').match(/[?&]v=([\w-]{6,})/);
  return m ? m[1] : null;
}

/** Recent Iran-relevant news videos from broadcaster YouTube channels (no API key). */
async function fetchWarVideos() {
  const cutoff = Date.now() - 96 * 3600000;
  const results = await Promise.allSettled(Object.entries(WAR_YT_CHANNELS).map(async ([cid, name]) => {
    try {
      const parsed = await rssParser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`);
      return (parsed.items || []).map(it => ({
        videoId: ytId(it), title: (it.title || '').trim(), channel: name,
        publishedAt: it.isoDate || it.pubDate || null,
        _ts: it.isoDate ? new Date(it.isoDate).getTime() : 0,
      })).filter(v => v.videoId && v._ts > cutoff);
    } catch { return []; }
  }));
  let vids = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  // dedupe by videoId
  const seen = new Set();
  vids = vids.filter(v => { if (seen.has(v.videoId)) return false; seen.add(v.videoId); return true; });
  // Iran relevance filter (reuses the headline filter; falls back to regex)
  const relevant = await filterIranWarRelevant(vids.map(v => ({ title: v.title, description: '' })), 'news videos');
  const keepTitles = new Set(relevant.map(r => r.title));
  vids = vids.filter(v => keepTitles.has(v.title));
  vids.sort((a, b) => b._ts - a._ts);
  return vids.slice(0, 30).map(v => ({
    videoId: v.videoId, title: v.title, channel: v.channel, publishedAt: v.publishedAt,
    thumbnailUrl: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
  }));
}

// ---------------------------------------------------------------- image candidate quality
const LOGO_HINT = /(logo|favicon|sprite|placeholder|default|icon|avatar|wikipedia\.org\/.*Flag_of|\/Flag_|flag-|-flag|share[-_]?default|_default_|og-default)/i;
const PHOTO_HOST = /(bbci\.co\.uk|guim\.co\.uk|media\.cnn|aljazeera|ytimg|reuters|france24|dw\.com|jpost|s\.yimg|hdnux|thgim|akamai|cloudfront|wp\.com|gettyimages|ahram)/i;

/** Heuristic: is this URL likely a real photo (not a flag/logo/placeholder)? */
function isLikelyPhoto(url) {
  if (!isGoodImage(url)) return false;
  if (LOGO_HINT.test(url)) return false;
  return true;
}

// ---------------------------------------------------------------- weather (Open-Meteo, keyless)
const WMO = {
  0: { icon: '\u2600\uFE0F', label: 'Clear' }, 1: { icon: '\uD83C\uDF24\uFE0F', label: 'Mostly clear' },
  2: { icon: '\u26C5', label: 'Partly cloudy' }, 3: { icon: '\u2601\uFE0F', label: 'Overcast' },
  45: { icon: '\uD83C\uDF2B\uFE0F', label: 'Fog' }, 48: { icon: '\uD83C\uDF2B\uFE0F', label: 'Fog' },
  51: { icon: '\uD83C\uDF26\uFE0F', label: 'Drizzle' }, 61: { icon: '\uD83C\uDF27\uFE0F', label: 'Rain' },
  63: { icon: '\uD83C\uDF27\uFE0F', label: 'Rain' }, 65: { icon: '\uD83C\uDF27\uFE0F', label: 'Heavy rain' },
  71: { icon: '\u2744\uFE0F', label: 'Snow' }, 80: { icon: '\uD83C\uDF26\uFE0F', label: 'Showers' },
  95: { icon: '\u26C8\uFE0F', label: 'Thunderstorm' }, 96: { icon: '\u26C8\uFE0F', label: 'Thunderstorm' },
};
async function fetchWeather(lat = 30.03, lon = 31.47) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
    const r = await fetch(url, { headers: { 'User-Agent': 'ThinxTV/1.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    const code = j.current?.weather_code;
    const w = WMO[code] || { icon: '\uD83C\uDF21\uFE0F', label: 'Weather' };
    return {
      tempC: Math.round(j.current?.temperature_2m ?? 0),
      code, icon: w.icon, label: w.label,
      updatedAt: new Date().toISOString(),
    };
  } catch { return null; }
}

module.exports = {
  getRedis, getAnthropic, anthropicText, log,
  WAR_FEEDS, WAR_START_DATE, IRAN_FALLBACK, rssParser,
  filterIranWarRelevant, fetchWarHeadlines,
  isGoodImage, isLikelyPhoto, extractOgImage, wikiImage, resolveStoryImage,
  commonsPhoto, openversePhoto, searchPhoto,
  isMarketDateExpired, parseByDate, fetchWarMarkets,
  fetchMarketHistory, sparkFromHistory, measuredDelta, pickSpikeCandidates, enrichSpikesWithHistory,
  fetchWarVideos, WAR_YT_CHANNELS, fetchWeather,
};
