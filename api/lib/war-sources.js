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
const crypto = require('crypto');
const RssParser = require('rss-parser');
const NT = require('./news-topics');   // structured scope/relevance config (no hard-coded keyword strings)

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
// Source registry. `category` is the editorial bloc (drives the per-bloc reserve
// so no single side dominates); `tier` is speed/role: 1 = fast wire/aggregator
// (breaking, lowest latency), 2 = major outlet, 3 = regional/state media. The
// `fronts` hint is advisory metadata (which topics a source is strong on) used
// by the eval harness when it recommends where to add coverage.
//
// Google News *search* feeds are deliberately included as tier-1 wires: they are
// extremely reliable to fetch and surface breaking items (e.g. a fresh Lebanon
// strike) minutes faster than a publisher's section RSS, and the `when:Nd`
// window keeps them fresh. Dead/slow feeds never break a run (Promise.allSettled).
const WAR_FEEDS = [
  // --- tier 1: fast wires / targeted aggregators (lowest latency, per-front) ---
  { id: 'gnews-breaking', name: 'Google News', url: 'https://news.google.com/rss/search?q=(Iran+OR+Israel+OR+Hezbollah+OR+Lebanon)+strike+when:1d&hl=en-US&gl=US&ceid=US:en', category: 'wire', tier: 1, fronts: ['iran-core', 'levant', 'israel-gaza'] },
  { id: 'gnews-levant', name: 'Google News', url: 'https://news.google.com/rss/search?q=(Lebanon+OR+Hezbollah+OR+Beirut)+when:2d&hl=en-US&gl=US&ceid=US:en', category: 'wire', tier: 1, fronts: ['levant'] },
  { id: 'gnews-iran', name: 'Google News', url: 'https://news.google.com/rss/search?q=iran+war+2026&hl=en-US&gl=US&ceid=US:en', category: 'wire', tier: 1, fronts: ['iran-core', 'nuclear-diplomacy'] },
  { id: 'gnews-reuters', name: 'Reuters via GN', url: 'https://news.google.com/rss/search?q=site:reuters.com+(Iran+OR+Lebanon+OR+Israel)+when:2d&hl=en-US&gl=US&ceid=US:en', category: 'wire', tier: 1, fronts: ['iran-core', 'levant'] },
  // --- tier 2: major international outlets ---
  { id: 'bbc-mideast', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', category: 'western', tier: 2, fronts: ['iran-core', 'levant', 'israel-gaza'] },
  { id: 'cnn-mideast', name: 'CNN', url: 'http://rss.cnn.com/rss/edition_meast.rss', category: 'western', tier: 2, fronts: ['iran-core', 'israel-gaza'] },
  { id: 'fox-world', name: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/world.xml', category: 'western', tier: 2, fronts: ['iran-core'] },
  { id: 'france24', name: 'France 24', url: 'https://www.france24.com/en/middle-east/rss', category: 'western', tier: 2, fronts: ['levant', 'iran-core'] },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/middleeast/rss', category: 'western', tier: 2, fronts: ['iran-core', 'israel-gaza'] },
  { id: 'dw', name: 'DW News', url: 'https://rss.dw.com/xml/rss-en-all', category: 'western', tier: 2, fronts: ['iran-core'] },
  // --- regional / state media (each bloc, for the editorial reserve) ---
  { id: 'aljazeera-me', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'arab', tier: 2, fronts: ['levant', 'israel-gaza', 'iran-core'] },
  { id: 'alarabiya', name: 'Al Arabiya', url: 'https://news.google.com/rss/search?q=site:alarabiya.net+(Iran+OR+Gulf+OR+Lebanon+OR+Hormuz)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'arab', tier: 2, fronts: ['gulf-hormuz', 'levant'] },
  { id: 'naharnet', name: 'Naharnet', url: 'https://news.google.com/rss/search?q=site:naharnet.com+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'arab', tier: 3, fronts: ['levant'] },
  { id: 'egypt-indep', name: 'Egypt Independent', url: 'https://www.egyptindependent.com/feed/', category: 'arab', tier: 3, fronts: ['energy-fallout'] },
  { id: 'jpost', name: 'Jerusalem Post', url: 'https://www.jpost.com/rss/rssfeedsarabisraeliconflict.aspx', category: 'israeli', tier: 2, fronts: ['levant', 'israel-gaza'] },
  { id: 'toi', name: 'Times of Israel', url: 'https://www.timesofisrael.com/feed/', category: 'israeli', tier: 2, fronts: ['levant', 'israel-gaza', 'iran-core'] },
  { id: 'presstv', name: 'Press TV', url: 'https://www.presstv.ir/rss.xml', category: 'iranian', tier: 3, fronts: ['iran-core'] },
  { id: 'tehrantimes', name: 'Tehran Times', url: 'https://www.tehrantimes.com/rss', category: 'iranian', tier: 3, fronts: ['iran-core', 'nuclear-diplomacy'] },

  // --- diversity expansion: reliable Google-News site: feeds per outlet (GN is
  // the most reliable fetch path) so no single state outlet (Press TV) dominates,
  // plus a few week-window front queries that carry a full 7 days of context. ---
  // western / wires
  { id: 'gn-ap', name: 'AP', url: 'https://news.google.com/rss/search?q=site:apnews.com+(Iran+OR+Israel+OR+Lebanon+OR+Hezbollah)+when:3d&hl=en-US&gl=US&ceid=US:en', category: 'western', tier: 1, fronts: ['iran-core', 'levant', 'israel-gaza'] },
  { id: 'gn-npr', name: 'NPR', url: 'https://news.google.com/rss/search?q=site:npr.org+(Iran+OR+Israel+OR+Lebanon)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'western', tier: 2, fronts: ['iran-core', 'nuclear-diplomacy'] },
  { id: 'gn-sky', name: 'Sky News', url: 'https://news.google.com/rss/search?q=site:news.sky.com+(Iran+OR+Israel+OR+Lebanon)+when:3d&hl=en-US&gl=US&ceid=US:en', category: 'western', tier: 2, fronts: ['iran-core', 'levant'] },
  { id: 'gn-bloomberg', name: 'Bloomberg', url: 'https://news.google.com/rss/search?q=site:bloomberg.com+(Iran+OR+Hormuz+OR+oil)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'western', tier: 2, fronts: ['energy-fallout', 'gulf-hormuz'] },
  { id: 'gn-axios', name: 'Axios', url: 'https://news.google.com/rss/search?q=site:axios.com+(Iran+OR+Israel)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'western', tier: 2, fronts: ['nuclear-diplomacy', 'iran-core'] },
  { id: 'gn-politico', name: 'Politico', url: 'https://news.google.com/rss/search?q=site:politico.com+(Iran+OR+Israel+OR+ceasefire)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'western', tier: 2, fronts: ['nuclear-diplomacy'] },
  { id: 'gn-afp', name: 'AFP', url: 'https://news.google.com/rss/search?q=(site:barrons.com+OR+%22Agence+France-Presse%22)+Iran+when:3d&hl=en-US&gl=US&ceid=US:en', category: 'wire', tier: 1, fronts: ['iran-core', 'levant'] },
  // arab bloc
  { id: 'gn-almonitor', name: 'Al-Monitor', url: 'https://news.google.com/rss/search?q=site:al-monitor.com+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'arab', tier: 2, fronts: ['iran-core', 'levant', 'gulf-hormuz'] },
  { id: 'gn-mee', name: 'Middle East Eye', url: 'https://news.google.com/rss/search?q=site:middleeasteye.net+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'arab', tier: 3, fronts: ['levant', 'israel-gaza'] },
  { id: 'gn-thenational', name: 'The National', url: 'https://news.google.com/rss/search?q=site:thenationalnews.com+(Iran+OR+Gulf+OR+Lebanon)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'arab', tier: 2, fronts: ['gulf-hormuz', 'levant'] },
  { id: 'gn-arabnews', name: 'Arab News', url: 'https://news.google.com/rss/search?q=site:arabnews.com+(Iran+OR+Gulf+OR+Hormuz)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'arab', tier: 2, fronts: ['gulf-hormuz'] },
  { id: 'gn-lorient', name: "L'Orient Today", url: 'https://news.google.com/rss/search?q=site:lorientlejour.com+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'arab', tier: 3, fronts: ['levant'] },
  { id: 'gn-anadolu', name: 'Anadolu Agency', url: 'https://news.google.com/rss/search?q=site:aa.com.tr+(Iran+OR+Israel+OR+Lebanon)+when:3d&hl=en-US&gl=US&ceid=US:en', category: 'arab', tier: 3, fronts: ['levant', 'iran-core'] },
  // israeli bloc
  { id: 'gn-haaretz', name: 'Haaretz', url: 'https://news.google.com/rss/search?q=site:haaretz.com+(Iran+OR+Lebanon+OR+Hezbollah)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'israeli', tier: 2, fronts: ['iran-core', 'levant'] },
  { id: 'gn-i24', name: 'i24NEWS', url: 'https://news.google.com/rss/search?q=site:i24news.tv+when:3d&hl=en-US&gl=US&ceid=US:en', category: 'israeli', tier: 3, fronts: ['levant', 'israel-gaza'] },
  { id: 'gn-ynet', name: 'Ynetnews', url: 'https://news.google.com/rss/search?q=site:ynetnews.com+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'israeli', tier: 3, fronts: ['iran-core', 'israel-gaza'] },
  // iranian / axis bloc (diversify beyond Press TV)
  { id: 'gn-irna', name: 'IRNA', url: 'https://news.google.com/rss/search?q=site:en.irna.ir+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'iranian', tier: 3, fronts: ['iran-core', 'nuclear-diplomacy'] },
  { id: 'gn-mehr', name: 'Mehr News', url: 'https://news.google.com/rss/search?q=site:en.mehrnews.com+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'iranian', tier: 3, fronts: ['iran-core'] },
  { id: 'gn-almayadeen', name: 'Al Mayadeen', url: 'https://news.google.com/rss/search?q=site:english.almayadeen.net+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'iranian', tier: 3, fronts: ['levant', 'iran-core'] },
  // week-window front queries (full 7-day context, per front)
  { id: 'gn-nuclear-week', name: 'Google News', url: 'https://news.google.com/rss/search?q=(Iran+nuclear+OR+IAEA+OR+enrichment+OR+Fordow)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'wire', tier: 1, fronts: ['nuclear-diplomacy'] },
  { id: 'gn-hormuz-week', name: 'Google News', url: 'https://news.google.com/rss/search?q=(Strait+of+Hormuz+OR+Persian+Gulf+tanker+OR+Bandar+Abbas+OR+Kuwait+OR+Bahrain)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'wire', tier: 1, fronts: ['gulf-hormuz'] },
  { id: 'gn-energy-week', name: 'Google News', url: 'https://news.google.com/rss/search?q=(oil+price+Iran+OR+Brent+crude+Hormuz+OR+OPEC+Iran)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'wire', tier: 1, fronts: ['energy-fallout'] },
  { id: 'gn-gaza-week', name: 'Google News', url: 'https://news.google.com/rss/search?q=(Gaza+OR+West+Bank)+Israel+strike+when:3d&hl=en-US&gl=US&ceid=US:en', category: 'wire', tier: 1, fronts: ['israel-gaza'] },
  { id: 'gn-context-week', name: 'Google News', url: 'https://news.google.com/rss/search?q=(Iran+OR+Hezbollah+OR+Lebanon)+(war+OR+strike+OR+ceasefire)+when:7d&hl=en-US&gl=US&ceid=US:en', category: 'wire', tier: 1, fronts: ['iran-core', 'levant'] },
];

// Editorial blocs that earn a reserved slice of the headline set (so the wall is
// never one-sided). Wires are first so the freshest breaking items survive the cut.
const SOURCE_BLOCS = ['wire', 'western', 'israeli', 'arab', 'iranian'];

const WAR_START_DATE = process.env.INTEL_WAR_START || '2026-03-01';
const HAIKU_MODEL = process.env.INTEL_HAIKU || 'claude-haiku-4-5-20251001';
// Regex fallback when the relevance LLM is unavailable — generated from the
// active scope so it always matches the same fronts the prompt describes
// (exported name kept for backward-compat with existing callers/tests).
const IRAN_FALLBACK = NT.fallbackRegex();
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
        messages: [{ role: 'user', content: NT.relevancePrompt(type) + '\n\n' + numbered }],
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
  const FEED_TIMEOUT_MS = Number(process.env.INTEL_FEED_TIMEOUT_MS || 9000);
  const results = await Promise.allSettled(WAR_FEEDS.map(async (feed) => {
    try {
      // Hard timeout per feed so one slow/hanging host can never stall the run
      // (belt-and-suspenders over rss-parser's own timeout). Failures -> [] below.
      const parsed = await Promise.race([
        rssParser.parseURL(feed.url),
        new Promise((_, rej) => setTimeout(() => rej(new Error('feed timeout')), FEED_TIMEOUT_MS)),
      ]);
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

  // Selection with a PER-SOURCE CAP so no single prolific outlet (e.g. Press TV)
  // floods the set — diversity over volume. We (1) reserve a per-bloc slice for
  // balance, then (2) fill by recency, both honoring the per-source cap.
  const PER_SOURCE_CAP = Number(process.env.INTEL_PER_SOURCE_CAP || 4);
  const BLOC_RESERVE = Number(process.env.INTEL_BLOC_RESERVE || 6);
  const HEADLINE_CAP = Number(process.env.INTEL_HEADLINE_CAP || 60);
  const buckets = Object.fromEntries(SOURCE_BLOCS.map(b => [b, []]));
  for (const i of deduped) { if (buckets[i.sourceCategory]) buckets[i.sourceCategory].push(i); }
  const counts = {};                                   // per-source (outlet) tally
  const final = []; const chosen = new Set();
  const keyOf = i => (i.source || i.feedId || 'unknown');
  const tryAdd = (i) => {
    if (final.length >= HEADLINE_CAP) return false;
    const id = i.feedId + ':' + i.title;
    if (chosen.has(id)) return false;
    const k = keyOf(i);
    if ((counts[k] || 0) >= PER_SOURCE_CAP) return false;
    counts[k] = (counts[k] || 0) + 1; chosen.add(id); final.push(i); return true;
  };
  for (const bloc of SOURCE_BLOCS) {                    // 1) per-bloc reserve (balanced)
    let n = 0;
    for (const i of (buckets[bloc] || [])) { if (n >= BLOC_RESERVE) break; if (tryAdd(i)) n++; }
  }
  for (const i of deduped) { if (final.length >= HEADLINE_CAP) break; tryAdd(i); }  // 2) fill by recency
  final.sort((a, b) => b._ts - a._ts);

  // Diversity + polling-health signal so the pipeline (and /m/debug) can watch
  // source spread and flag feeds that returned nothing this run.
  const failing = Object.entries(sourceStatus).filter(([, s]) => s !== 'ok').map(([id]) => id);
  const sourceCounts = {};
  for (const i of final) sourceCounts[keyOf(i)] = (sourceCounts[keyOf(i)] || 0) + 1;

  return {
    headlines: final.map((item, i) => ({
      id: `${item.feedId}-${i}`, source: item.source, sourceCategory: item.sourceCategory,
      title: item.title, link: item.link, description: item.description,
      publishedAt: item.publishedAt, imageUrl: item.imageUrl,
      ageMinutes: item._ts ? Math.round((now - item._ts) / 60000) : null,
    })),
    sourceStatus, sourceCounts, failingSources: failing,
    diversity: { outlets: Object.keys(sourceCounts).length, feedsOk: WAR_FEEDS.length - failing.length, feedsTotal: WAR_FEEDS.length },
    fetchedAt: new Date().toISOString(),
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

// ---- full article-body extraction (so the curation LLM reads the STORY, not
// just a 200-char RSS snippet). Cached in Redis (articles are immutable), with a
// short timeout and a graceful null on any failure so a slow/blocked publisher
// (e.g. Press TV) never breaks a run — callers fall back to the RSS description.
function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&nbsp;/g, ' ').replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ' '; } });
}
function htmlToText(html) {
  const h = (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  // Article bodies almost always live in <p> blocks; collecting those drops nav,
  // captions, share widgets, and cookie banners without a DOM parser.
  const paras = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi; let m;
  while ((m = re.exec(h))) {
    const t = decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (t.length >= 40) paras.push(t);   // skip short nav/caption fragments
  }
  let text = paras.join('\n');
  if (text.length < 200) text = decodeEntities(h.replace(/<[^>]+>/g, ' '));  // fallback: strip all tags
  return text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}
async function extractArticleText(url, opts = {}) {
  const maxChars = Number(opts.maxChars || process.env.INTEL_ARTICLE_CHARS || 3000);
  if (!url || /news\.google\.com|google\.com\/rss/.test(url)) return null;  // redirect shells have no body
  const redis = opts.redis || getRedis();
  const key = 'tv:war:article:' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 24);
  if (redis) {
    try { const c = await redis.get(key); if (c) { const o = typeof c === 'string' ? JSON.parse(c) : c; if (o && o.text) return o.text.slice(0, maxChars); } } catch {}
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Number(process.env.INTEL_ARTICLE_TIMEOUT_MS || 8000));
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ThinxTV/1.0)' } });
    clearTimeout(t);
    if (!r.ok) return null;
    if (/news\.google\.com|consent\.google\.com/.test(r.url || '')) return null;  // landed on a consent/redirect shell
    const text = htmlToText(await r.text()).slice(0, maxChars);
    if (text.length < 200) return null;  // too thin to be a real body — let the caller fall back
    if (redis) { try { await redis.set(key, JSON.stringify({ text, at: Date.now() }), { ex: Number(process.env.INTEL_ARTICLE_TTL || 3 * 86400) }); } catch {} }
    return text;
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

// Keyword fallback for market selection — generated from the active scope's
// fronts (plus a couple of market-phrasing variants) so it tracks the same
// topics as the relevance prompt instead of drifting as a separate hand list.
const MARKET_KEYWORDS = [...new Set([...NT.allKeywords(), 'nuclear deal', 'nuclear weapon', 'regime', 'middle east'])];

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
        messages: [{ role: 'user', content: `${NT.marketSelectionPrompt()}\n\nEvents:\n${titleList}` }],
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
      // The headline price MUST come from the SAME CLOB series that powers the
      // chart (history), NOT the Gamma snapshot (m.probability). The two sources
      // drift apart — sometimes wildly (16% vs 50%) — which made a market card's
      // big number disagree with its own chart and with the detail view. Use the
      // last history point; fall back to the Gamma probability only when we have
      // no history at all. (refreshSignals already does this on the reuse path.)
      const lastP = (history && history.length) ? history[history.length - 1] : m.probability;
      const pct = Math.round(lastP * 100);
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
// Vetted broadcaster/wire channels. IMPORTANT: these ids were previously stale —
// several pointed at the WRONG channel (the "France 24" id was actually Al
// Jazeera, "DW News" was BBC) and two 404'd, so every clip's source LABEL was a
// lie. The ids below are verified against the live feed; more importantly the
// label is now taken from the feed's own title at fetch time (see fetchWarVideos),
// so a wrong id can never again mislabel a clip's source.
const WAR_YT_CHANNELS = {
  'UChqUTb7kYRX8-EiaN3XFrSQ': 'Reuters',
  'UC52X5wxOL_s5yw0dQk7NtgA': 'Associated Press',
  'UCupvZG-5ko_eiXAupbDfxWw': 'CNN',
  'UC16niRr50-MSBwiO3YDb3RA': 'BBC News',
  'UC7fWeaHhqgM4Ry-RMpM2YYw': 'TRT World',
  'UCQfwfsi5VrQ8yKZ-UWmAEFg': 'France 24 English',
  'UCNye-wNBqNL5ZzHSJj3l8Bg': 'Al Jazeera English',
  'UCeY0bbntWzzVIaj2z3QigXg': 'NBC News',
  'UCHpw8xwDNhU9gdohEcJu4aA': 'The Guardian',
  'UCaXkIU1QidjPwiAYu6GcHjg': 'MS NOW',
};

// Source-reputation tiers for ranking clips. The targeted search opens the pool
// to the whole web — alongside wires/broadcasters it returns a long tail of
// sensational aggregators ("Times Now", "WION", "CRUX", "Oneindia"), foreign-
// language desks, and individuals ("Srijan Kalam"). We don't hard-exclude them
// (they sometimes carry the only on-topic clip) — we DOWN-RANK them: a clip that
// covers the story equally well from Reuters beats one from a random uploader.
// tier 1 = global wires + flagship broadcasters; 2 = solid secondary outlets;
// 3 = everything else (unknown/aggregator/individual). Matched on channel name
// so it works for both the RSS pool and search results.
// CNN matches the network but NOT "CNN-News18" (India's sensational affiliate).
const CHANNEL_TIER1 = /\b(reuters|associated press|ap archive|\bap\b|afp|agence france|al jazeera|bbc|cnn\b(?!-?news18)|france ?24|dw news|deutsche welle|sky news|al arabiya|nbc news|cbs|abc news|pbs|bloomberg|cnbc|fox news|the guardian|guardian news|ms now|msnbc|npr|the economist|financial times|wall street journal|new york times|washington post|c-span)\b/i;
const CHANNEL_TIER2 = /\b(trt world|sbs|the hill|usa today|dd india|roya|i24|times of israel|jerusalem post|haaretz|euronews|politico|axios|channel 4|\bitv\b|cbc news|global news|south china morning post|scmp|middle east eye|al monitor|the national|nbc|cbs news|abc)\b/i;
function channelTier(name) {
  const s = String(name || '').toLowerCase();
  if (!s) return 3;
  if (CHANNEL_TIER1.test(s)) return 1;
  if (CHANNEL_TIER2.test(s)) return 2;
  return 3;
}
// Parse a YouTube "12:34" / "1:02:33" length into seconds (null if unknown).
function parseDurationText(t) {
  const m = String(t || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return (Number(m[1] || 0) * 3600) + (Number(m[2]) * 60) + Number(m[3]);
}
// Fitness of a clip's duration for a cinematic TV card (0 worst … 3 best). A
// sub-minute Short is a vertical teaser; a 30-min+ item is a full bulletin or a
// livestream replay — both play badly on the wall. null (broadcaster RSS, no
// duration) is treated as neutral-good since those are already vetted outlets.
function durationFit(sec) {
  if (sec == null) return 2;
  if (sec < 45) return 0;
  if (sec < 90) return 2;
  if (sec <= 1200) return 3;   // ~1.5–20 min sweet spot
  if (sec <= 1800) return 2;   // 20–30 min, acceptable
  return 1;                    // 30 min+ bulletin / livestream replay
}

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
      // Label from the feed's OWN title (the real channel name) — never the static
      // map — so the source tag always matches the actual publisher.
      const channel = (parsed.title || name || '').trim();
      return (parsed.items || []).map(it => ({
        videoId: ytId(it), title: (it.title || '').trim(), channel,
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
    tier: channelTier(v.channel), durationSec: null,
    thumbnailUrl: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
  }));
}

// ---------------------------------------------------------------- targeted video search (keyless)
// The broadcaster-channel pull above only surfaces whatever those 8 channels
// happened to upload recently, so a SPECIFIC story (the Aoun–Araghchi spat, the
// IAEA board session) rarely has a clip that actually covers it — only generic
// regional footage. To give every segment a clip that covers its EXACT story we
// search YouTube directly for the segment's headline (no API key: we read the
// public results page and parse its embedded ytInitialData JSON). Graceful: any
// failure (network, consent wall, markup change) returns [] and the caller falls
// back to the broadcaster pool.
function extractYtInitialData(html) {
  const i = html.indexOf('ytInitialData');
  if (i < 0) return null;
  const eq = html.indexOf('=', i);
  if (eq < 0) return null;
  let j = eq + 1;
  while (j < html.length && html[j] !== '{') j++;
  if (j >= html.length) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = j; k < html.length; k++) {
    const c = html[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(j, k + 1)); } catch { return null; }
    }
  }
  return null;
}
// Recursively collect every value stored under `key` anywhere in the tree.
function collectByKey(node, key, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const v of node) collectByKey(v, key, out); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (k === key) out.push(v);
    if (v && typeof v === 'object') collectByKey(v, key, out);
  }
  return out;
}
// "3 days ago" / "2 hours ago" / "Streamed 1 week ago" -> approximate epoch ms.
function parseRelativeAge(text) {
  const m = String(text || '').match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return null;
  const mult = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }[m[2].toLowerCase()];
  return mult ? Date.now() - Number(m[1]) * mult : null;
}
/** Keyless YouTube search for clips that cover a SPECIFIC story (a segment headline). */
async function searchVideos(query, opts = {}) {
  if (!query) return [];
  const max = Number(opts.max || 6);
  const maxAgeDays = Number(opts.maxAgeDays || process.env.INTEL_VIDEO_SEARCH_AGE_DAYS || 45);
  // Floor (epoch ms): drop any clip published BEFORE this. Used to require a clip be
  // fresher than the event it covers — a recurring event's earlier clips (even if only
  // days old) predate the new development's first-reported time and are the wrong clip.
  const notBefore = Number(opts.notBefore || 0);
  const minSec = Number(process.env.INTEL_VIDEO_MIN_SEC || 45);
  const maxSec = Number(process.env.INTEL_VIDEO_MAX_SEC || 1500);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Number(process.env.INTEL_VIDEO_SEARCH_TIMEOUT_MS || 8000));
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const data = extractYtInitialData(await r.text());
    if (!data) return [];
    const seen = new Set(); const out = [];
    for (const v of collectByKey(data, 'videoRenderer')) {
      const videoId = v && v.videoId;
      if (!videoId || seen.has(videoId)) continue;
      const title = (v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text)
        || (v.title && v.title.simpleText) || '';
      if (!title) continue;
      if ((title.match(/#/g) || []).length >= 3) continue;   // hashtag-spam shorts — never good TV clips
      // Reject what plays badly on a cinematic wall: live/upcoming streams and
      // Shorts (both lack a normal lengthText), plus clips outside the duration
      // window. A regular clip always carries "m:ss"; live/short/upcoming don't.
      const isLive = /\b(LIVE|UPCOMING)\b/.test(JSON.stringify(v.badges || v.thumbnailOverlays || ''));
      const isShort = !!(v.navigationEndpoint && JSON.stringify(v.navigationEndpoint).includes('/shorts/'));
      const durationSec = parseDurationText(v.lengthText && v.lengthText.simpleText);
      if (isLive || isShort || durationSec == null) continue;
      if (durationSec < minSec || durationSec > maxSec) continue;
      const channel = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].text)
        || (v.longBylineText && v.longBylineText.runs && v.longBylineText.runs[0] && v.longBylineText.runs[0].text) || '';
      const ts = parseRelativeAge(v.publishedTimeText && v.publishedTimeText.simpleText);
      // Drop clips we can't date (no timestamp to show + no way to verify freshness),
      // clips older than the hard age cap, and clips older than the event itself.
      if (ts == null) continue;
      if ((Date.now() - ts) / 86400000 > maxAgeDays) continue;
      if (notBefore && ts < notBefore) continue;
      seen.add(videoId);
      out.push({
        videoId, title: title.trim(), channel: channel.trim(),
        publishedAt: ts ? new Date(ts).toISOString() : null,
        durationSec, tier: channelTier(channel),
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        searched: true,
      });
      if (out.length >= max) break;
    }
    return out;
  } catch { return []; }
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
  isGoodImage, isLikelyPhoto, extractOgImage, extractArticleText, htmlToText, wikiImage, resolveStoryImage,
  commonsPhoto, openversePhoto, searchPhoto,
  isMarketDateExpired, parseByDate, fetchWarMarkets,
  fetchMarketHistory, sparkFromHistory, measuredDelta, pickSpikeCandidates, enrichSpikesWithHistory,
  fetchWarVideos, searchVideos, channelTier, durationFit, parseDurationText, WAR_YT_CHANNELS, fetchWeather,
};
