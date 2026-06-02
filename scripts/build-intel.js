#!/usr/bin/env node
/**
 * build-intel.js — pre-builds the cinematic "Iran Watch" intel bundle.
 *
 * Pipeline (runs on a cron, no TV-triggered work):
 *   1. Fetch RSS headlines + broad Polymarket markets (with spike detection) + weather
 *   2. Sonnet: curate 5-8 news SEGMENTS, link spiking markets, flag fresh breaking
 *   3. Opus: design each NEW segment's drill-down LAYOUT spec (cached by content hash)
 *   4. Resolve a real image per segment + per source (og:image -> wikipedia)
 *   5. Assemble the bundle and store it in Redis (tv:war:intel:v1) + a local file
 *
 * The TV reads the finished bundle read-only via GET /api/tv/intel.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const W = require('../api/lib/war-sources');

const SONNET = process.env.INTEL_SONNET || 'claude-sonnet-4-5-20250929';
const OPUS = process.env.INTEL_OPUS || 'claude-opus-4-6';
const REDIS_KEY = 'tv:war:intel:v1';
const LAYOUT_PREFIX = 'tv:war:intel:layout:';
const OUT_FILE = process.env.INTEL_OUT || path.join(__dirname, '..', 'intel-bundle.json');
const MODULE_LIBRARY = ['summary', 'marketImpact', 'videos', 'sources', 'timeline', 'keyQuote', 'statCallouts'];

function log(...a) { console.error('[build-intel]', ...a); }

function extractJson(text) {
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s !== -1 && e !== -1) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

async function callJson(model, maxTokens, prompt) {
  const a = W.getAnthropic();
  if (!a) throw new Error('ANTHROPIC_API_KEY not set');
  const r = await a.messages.create({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
  const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  return { json: extractJson(text), usage: r.usage };
}

function dayCounter() {
  const start = new Date(W.WAR_START_DATE);
  return Math.floor((Date.now() - start.getTime()) / 86400000) + 1;
}

// ---- Sonnet: curate segments ------------------------------------------------
async function curateSegments(headlines, spikes, weather) {
  const hList = headlines.map((h, i) =>
    `${i}. [${h.source}/${h.sourceCategory}] ${h.title}${h.ageMinutes != null ? ` (${h.ageMinutes}m ago)` : ''}`
  ).join('\n');
  const mList = spikes.length
    ? spikes.map(s => `- id=${s.id} "${s.question}" now ${s.prob}, move ${s.delta}`).join('\n')
    : '(no markets are currently spiking)';

  const prompt = `You are the editor of a cinematic Samsung TV briefing called IRAN WATCH that blends live news with prediction-market spikes. Using ONLY the real data below, curate the briefing.

NOW: ${new Date().toISOString()}

HEADLINES (index. [source/category] title (age)):
${hList}

SPIKING PREDICTION MARKETS (already filtered to genuine recent movers):
${mList}

Return ONLY JSON (no prose, no fences):
{
  "status": { "label": "<UPPERCASE short status, <=28 chars>", "severity": "calm|warning|critical" },
  "breakingIdx": <the single headline index that is genuine BREAKING news right now, or null if nothing qualifies>,
  "segments": [   // 5-7 DISTINCT stories, MOST IMPORTANT FIRST, each a different event
    {
      "id": "<short-slug>",
      "headline": "<<=64 chars, editorial, ends with a period>",
      "brief": "<1-2 sentences, <=180 chars>",
      "sourceIdxs": [<1-4 headline indices this story draws from, most relevant first>],
      "marketIds": [<ids from the SPIKING markets above that relate to this story, or []>],
      "aiSummary": "<3-4 sentences, factual, ONLY from the referenced headlines>",
      "timeline": [ {"time":"<short label e.g. 'Sun 08:00' or 'NOW'>","cap":"<<=40 chars>","now":<bool>} ],
      "watch": {"source":"<outlet>","duration":"<m:ss>"} | null
    }
  ]
}

Rules:
- severity: critical if active strikes/invasion/blockade; warning if fragile/strained; calm if stable.
- breakingIdx: ONLY a headline younger than ~90 minutes describing a major new development; else null.
- timeline: include 3-5 points ONLY when the story has a genuine multi-step chronology; otherwise return [] (an empty timeline). Last point now=true when ongoing.
- marketIds: this is where market spikes and news converge - attach a spiking market only if it is truly about this story.
- Do not invent events. Distinct stories only.`;

  const { json, usage } = await callJson(SONNET, 6000, prompt);
  log(`sonnet: ${(json.segments || []).length} segments (tokens ${usage?.input_tokens}/${usage?.output_tokens})`);
  return json;
}

// ---- Opus: design one segment's drill-down layout (cached) ------------------
async function designLayout(segment, redis, opts) {
  opts = opts || {};
  const hasTimeline = Array.isArray(segment.timeline) && segment.timeline.length >= 3;
  const hasMarket = !!opts.hasMarket;
  const hasVideos = !!opts.hasVideos;
  const hash = crypto.createHash('sha1')
    .update((segment.headline || '') + '|' + (segment.sourceIdxs || []).join(',') + '|' + (segment.aiSummary || '') + '|v' + hasVideos + 'm' + hasMarket + 't' + hasTimeline)
    .digest('hex').slice(0, 16);
  if (redis) {
    try { const c = await redis.get(LAYOUT_PREFIX + hash); if (c) { return typeof c === 'string' ? JSON.parse(c) : c; } } catch {}
  }
  const prompt = `You are an expert TV layout designer. Design the DETAILS (drill-down) page for ONE news story on a cinematic 1920x1080 Samsung TV. The page MUST fit one screen (no scrolling). You choose which modules to show, their order, and a couple of content accents. A fixed renderer draws them.

STORY:
headline: ${segment.headline}
summary: ${segment.aiSummary}
multi-step timeline available: ${hasTimeline}
linked spiking market: ${hasMarket}
playable video clips available: ${hasVideos}

AVAILABLE MODULES (pick a subset, order matters): ${MODULE_LIBRARY.join(', ')}
- summary: the AI summary paragraph (almost always include first)
- marketImpact: the linked prediction-market move (include only if a market is linked)
- videos: a paginated grid of playable video clips (include if videos are available - this is the main watch experience)
- sources: a compact list of source headlines
- timeline: the chronological event rail (include ONLY if a meaningful multi-step timeline exists)
- keyQuote: one pulled quote
- statCallouts: 1-3 numeric callouts

Return ONLY JSON (no fences):
{
  "modules": ["summary", ...],            // ordered subset; 2-5 modules; MUST fit one screen
  "showTimeline": <bool>,
  "emphasis": "image" | "text",
  "keyQuote": {"text":"<<=120 chars>","attribution":"<who>"} | null,
  "statCallouts": [ {"value":"<short>","label":"<short>"} ] | null
}

Rules: do not include 'timeline' unless showTimeline is true. Do not include 'marketImpact' if no market is linked. Do not include 'videos' unless videos are available. Keep it focused so everything fits ONE 1080p screen. Only include keyQuote/statCallouts if they add real signal.`;

  let layout;
  try {
    const { json } = await callJson(OPUS, 1200, prompt);
    layout = json;
  } catch (e) {
    log('opus layout failed, using default', e.message);
    layout = { modules: ['summary', hasVideos ? 'videos' : 'sources'], showTimeline: false, emphasis: 'image', keyQuote: null, statCallouts: null };
  }
  layout.modules = (Array.isArray(layout.modules) ? layout.modules : ['summary', 'sources'])
    .filter(m => MODULE_LIBRARY.includes(m));
  if (!layout.modules.includes('summary')) layout.modules.unshift('summary');
  if (!hasTimeline) { layout.showTimeline = false; layout.modules = layout.modules.filter(m => m !== 'timeline'); }
  if (layout.showTimeline && !layout.modules.includes('timeline')) layout.modules.push('timeline');
  if (!hasMarket) layout.modules = layout.modules.filter(m => m !== 'marketImpact');
  if (!hasVideos) layout.modules = layout.modules.filter(m => m !== 'videos');
  if (hasVideos && layout.modules.indexOf('videos') < 0) layout.modules.push('videos');
  layout.modules = layout.modules.slice(0, 5);
  if (redis) { try { await redis.set(LAYOUT_PREFIX + hash, JSON.stringify(layout), { ex: 86400 }); } catch {} }
  return layout;
}

// ---- Sonnet: pick the single best PHOTO per segment from candidates ---------
async function pickImages(segments, candsBySeg) {
  // Build a compact prompt listing candidates per segment; ask for best index each.
  const lines = [];
  segments.forEach((seg, si) => {
    const cands = candsBySeg[si] || [];
    if (cands.length <= 1) return;
    lines.push(`STORY ${si}: ${seg.headline}`);
    cands.forEach((c, ci) => lines.push(`  ${ci}. [${c.source}] ${c.url}`));
  });
  if (!lines.length) return {}; // nothing to choose
  const prompt = `For each STORY, choose the ONE candidate image that is most likely a real editorial PHOTOGRAPH that fits a cinematic full-screen TV background and represents the story. AVOID national flags, logos, station bugs, graphics, maps, and generic placeholders. Prefer wide news photos from major outlets.

${lines.join('\n')}

Return ONLY JSON mapping story index to chosen candidate index, e.g. {"0":2,"1":0}. If a story has no good photo, omit it.`;
  try {
    const { json } = await callJson(SONNET, 800, prompt);
    return json || {};
  } catch (e) { log('image pick failed', e.message); return {}; }
}

function scoreVideoForSegment(v, seg) {
  const text = (seg.headline + ' ' + seg.aiSummary).toLowerCase();
  const words = new Set(text.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3));
  const vt = (v.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/);
  let hits = 0; for (const w of vt) if (words.has(w)) hits++;
  return hits;
}

// ---- main -------------------------------------------------------------------
async function main() {
  const redis = W.getRedis();
  log('redis', redis ? 'connected' : 'NOT configured (file-only output)');

  const [hRes, mRes, weather, videosAll] = await Promise.all([
    W.fetchWarHeadlines().catch(e => { log('headlines failed', e.message); return { headlines: [] }; }),
    W.fetchWarMarkets().catch(e => { log('markets failed', e.message); return { markets: [] }; }),
    W.fetchWeather().catch(() => null),
    W.fetchWarVideos().catch(e => { log('videos failed', e.message); return []; }),
  ]);
  const headlines = hRes.headlines || [];
  let markets = mRes.markets || [];
  markets = await W.withPriceHistory(markets);
  const spikes = W.pickSpikes(markets, { threshold: Number(process.env.INTEL_SPIKE_THRESHOLD || 0.03), max: 4 });
  log(`headlines=${headlines.length} markets=${markets.length} spikes=${spikes.length} videos=${videosAll.length} weather=${weather ? weather.tempC + 'C' : 'n/a'}`);

  if (!headlines.length) { log('no headlines; aborting (keeping previous bundle)'); process.exit(1); }

  // Sonnet curation
  const curated = await curateSegments(headlines, spikes, weather);
  const segments = (curated.segments || []).slice(0, 7);

  // Resolve og:image for every referenced source link (parallel)
  const linkOf = i => (headlines[i] && headlines[i].link) || null;
  const allLinks = [...new Set(segments.flatMap(s => (s.sourceIdxs || []).map(linkOf).filter(Boolean)))];
  const imgEntries = await Promise.all(allLinks.map(async u => [u, await W.extractOgImage(u)]));
  const imgMap = Object.fromEntries(imgEntries);

  // Build per-segment PHOTO candidates (og:image + RSS enclosure), filter flags/logos
  const candsBySeg = segments.map(seg => {
    const cands = [];
    for (const i of (seg.sourceIdxs || [])) {
      const h = headlines[i]; if (!h) continue;
      for (const u of [imgMap[h.link], h.imageUrl]) {
        if (u && W.isLikelyPhoto(u) && !cands.some(c => c.url === u)) cands.push({ url: u, source: h.source });
      }
    }
    return cands;
  });
  const picked = await pickImages(segments, candsBySeg); // {segIdx: candIdx} chosen by Sonnet (no flags)

  const spikeById = Object.fromEntries(spikes.map(s => [s.id, s]));

  // Build stories (Opus layout per segment)
  const stories = [];
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const idxs = (seg.sourceIdxs || []).filter(i => headlines[i]);
    const sources = idxs.slice(0, 4).map(i => {
      const h = headlines[i];
      return {
        idx: i, title: h.title, outlet: h.source,
        meta: h.ageMinutes != null ? `${h.ageMinutes}m ago` : (h.publishedAt || ''),
        publishedAt: h.publishedAt || null,  // absolute time so the TV shows a live, trustworthy age
        category: h.sourceCategory, link: h.link, image: (imgMap[h.link] && W.isLikelyPhoto(imgMap[h.link])) ? imgMap[h.link] : null,
      };
    });
    // hero image: Sonnet-picked photo, else first photo candidate, else null (gradient)
    const cands = candsBySeg[si] || [];
    let heroImg = null;
    const pi = picked[si] != null ? picked[si] : picked[String(si)];
    if (pi != null && cands[pi]) heroImg = cands[pi].url;
    if (!heroImg && cands.length) heroImg = cands[0].url;

    // videos: top relevant clips for this segment (playable via thinx yt proxy)
    const vids = videosAll
      .map(v => ({ v, s: scoreVideoForSegment(v, seg) }))
      .sort((a, b) => b.s - a.s)
      .filter((x, k) => x.s > 0 || k < 2)   // keep matches, else fall back to 2 freshest
      .slice(0, 6)
      .map(x => ({ videoId: x.v.videoId, title: x.v.title, channel: x.v.channel, thumbnailUrl: x.v.thumbnailUrl, publishedAt: x.v.publishedAt }));

    const linkedSpikes = (seg.marketIds || []).map(id => spikeById[id]).filter(Boolean);
    const layout = await designLayout(seg, redis, { hasMarket: linkedSpikes.length > 0, hasVideos: vids.length > 0 });
    stories.push({
      id: seg.id || crypto.randomBytes(4).toString('hex'),
      headline: seg.headline, brief: seg.brief,
      image: heroImg, hasMarket: linkedSpikes.length > 0,
      marketIds: (seg.marketIds || []).filter(id => spikeById[id]),
      drilldown: {
        layout,
        aiSummary: seg.aiSummary || seg.brief,
        sources, videos: vids,
        timeline: Array.isArray(seg.timeline) ? seg.timeline : [],
        marketImpact: linkedSpikes[0] ? {
          id: linkedSpikes[0].id, question: linkedSpikes[0].question, prob: linkedSpikes[0].prob,
          delta: linkedSpikes[0].delta, deltaColor: linkedSpikes[0].deltaColor, byDate: linkedSpikes[0].byDate,
        } : null,
      },
    });
  }

  // Freshness guard: drop stories whose newest source is older than HARD_STALE_DAYS
  // (e.g. a re-published 2024 helicopter-crash article). Prefer stories under
  // STALE_DAYS but keep at least MIN_STORIES (freshest first) so the wall is never empty.
  {
    const DAY = 86400000;
    const STALE_DAYS = Number(process.env.INTEL_STALE_DAYS || 14);
    const HARD_STALE_DAYS = Number(process.env.INTEL_HARD_STALE_DAYS || 120);
    const MIN_STORIES = Number(process.env.INTEL_MIN_STORIES || 3);
    const nowMs = Date.now();
    const ageDays = (st) => {
      let newest = null;
      for (const s of (st.drilldown?.sources || [])) {
        const t = s.publishedAt ? Date.parse(s.publishedAt) : NaN;
        if (!isNaN(t) && (newest === null || t > newest)) newest = t;
      }
      for (const v of (st.drilldown?.videos || [])) {
        const t = v.publishedAt ? Date.parse(v.publishedAt) : NaN;
        if (!isNaN(t) && (newest === null || t > newest)) newest = t;
      }
      return newest === null ? null : (nowMs - newest) / DAY;
    };
    const tagged = stories.map((st, i) => ({ st, i, ad: ageDays(st) }));
    let keep = tagged.filter(t => t.ad === null || t.ad <= HARD_STALE_DAYS);
    const fresh = keep.filter(t => t.ad === null || t.ad <= STALE_DAYS);
    let chosen;
    if (fresh.length >= MIN_STORIES) chosen = fresh;
    else if (keep.length >= MIN_STORIES) chosen = keep;
    else chosen = tagged.slice().sort((a, b) => (a.ad ?? 1e9) - (b.ad ?? 1e9)).slice(0, MIN_STORIES);
    const dropped = tagged.filter(t => !chosen.includes(t));
    if (dropped.length) {
      console.log('[intel] dropped stale stories:', dropped.map(t => `${t.st.id}(${t.ad == null ? '?' : t.ad.toFixed(0) + 'd'})`).join(', '));
    }
    chosen.sort((a, b) => a.i - b.i);
    stories.length = 0;
    stories.push(...chosen.map(t => t.st));
  }

  // Enrich each signal with market-drilldown data: related headlines + related markets + storyId
  spikes.forEach(s => {
    const sid = String(s.id);
    const story = stories.find(st => (st.marketIds || []).map(String).indexOf(sid) >= 0);
    s.storyId = story ? story.id : null;
    s.relatedHeadlines = story ? (story.drilldown.sources || []).map(src => ({ title: src.title, outlet: src.outlet, meta: src.meta })) : [];
    s.relatedMarketIds = spikes.filter(o => o.id !== s.id).map(o => o.id);
  });

  // Breaking pill: only when Sonnet flagged a genuinely fresh headline
  let breaking = null;
  const bi = curated.breakingIdx;
  if (bi != null && headlines[bi] && (headlines[bi].ageMinutes == null || headlines[bi].ageMinutes <= 90)) {
    breaking = { text: headlines[bi].title, source: headlines[bi].source, at: new Date().toISOString(), ttlMins: 90 };
  }

  const accentBySev = { critical: '#f0584e', warning: '#f4b03e', calm: '#4ade80' };
  const sev = ['calm', 'warning', 'critical'].includes(curated.status?.severity) ? curated.status.severity : 'warning';

  const bundle = {
    status: { dayLabel: 'DAY', dayCounter: dayCounter(), label: (curated.status?.label || 'IRAN WATCH').toUpperCase(), severity: sev },
    weather,
    breaking,
    signals: spikes.map(s => ({
      id: s.id, question: s.question, prob: s.prob, probColor: s.probColor,
      delta: s.delta, deltaColor: s.deltaColor, meta: s.meta, spike: true, spark: s.spark,
      byDate: s.byDate || null, history: s.history || [],
      storyId: s.storyId || null, relatedHeadlines: s.relatedHeadlines || [], relatedMarketIds: s.relatedMarketIds || [],
    })),
    stories,
    uiDecisions: { accent: accentBySev[sev] },
    generatedAt: new Date().toISOString(),
    model: { curator: SONNET, designer: OPUS },
    _meta: { headlines: headlines.length, markets: markets.length, spikes: spikes.length },
  };

  // Persist: Redis (cloud) + local file (fallback / inspection)
  if (redis) { try { await redis.set(REDIS_KEY, JSON.stringify(bundle)); log('wrote Redis', REDIS_KEY); } catch (e) { log('redis write failed', e.message); } }
  fs.writeFileSync(OUT_FILE, JSON.stringify(bundle, null, 2));
  log('wrote', OUT_FILE, '| stories:', stories.length, '| signals:', bundle.signals.length, '| breaking:', breaking ? 'yes' : 'no');

  // Push to cloud (so the TV pulls fresh data from thinx.fun without GitHub secrets)
  if (process.env.INTEL_PUSH_URL && process.env.INTEL_PUSH_TOKEN) {
    try {
      const r = await fetch(process.env.INTEL_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.INTEL_PUSH_TOKEN },
        body: JSON.stringify(bundle),
      });
      log('pushed to cloud:', r.status, (await r.text()).slice(0, 120));
    } catch (e) { log('cloud push failed', e.message); }
  }
}

main().catch(e => { console.error('[build-intel] FATAL', e); process.exit(1); });
