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

async function callJson(model, maxTokens, prompt, opts = {}) {
  const a = W.getAnthropic();
  if (!a) throw new Error('ANTHROPIC_API_KEY not set');
  const params = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  // Prompt caching: mark a large STATIC system block as ephemeral so repeated
  // calls within a run (e.g. per-segment layouts) reuse it instead of re-billing it.
  if (opts.system) {
    params.system = [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }];
  }
  const r = await a.messages.create(params);
  const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  return { json: extractJson(text), usage: r.usage };
}

function dayCounter() {
  const start = new Date(W.WAR_START_DATE);
  return Math.floor((Date.now() - start.getTime()) / 86400000) + 1;
}

// ---- Stage A — Sonnet: cheap proposer + context summarizer ------------------
// Sonnet does the high-volume drafting: it compresses the situation into a short
// digest and proposes MANY candidate story clusters (groupings, candidate titles,
// candidate market/video links). It does NOT make final decisions — Opus does.
async function proposeContext(headlines, spikes, videos) {
  const hList = headlines.map((h, i) =>
    `${i}. [${h.source}/${h.sourceCategory}] ${h.title}${h.ageMinutes != null ? ` (${h.ageMinutes}m ago)` : ''}`
  ).join('\n');
  const mList = spikes.length
    ? spikes.map(s => `- id=${s.id} "${s.question}" now ${s.prob}, move ${s.delta}`).join('\n')
    : '(no markets are currently spiking)';
  const vList = videos.length
    ? videos.map((v, i) => `${i}. [${v.channel}] ${v.title}`).join('\n')
    : '(no videos)';

  const prompt = `You are a fast news desk assistant for a cinematic Samsung TV briefing called IRAN WATCH. Your job is to DRAFT raw material for the senior editor — not to make final calls. Summarize the situation and propose MANY candidate story clusters from the real data below.

NOW: ${new Date().toISOString()}

HEADLINES (index. [source/category] title (age)):
${hList}

SPIKING PREDICTION MARKETS:
${mList}

AVAILABLE VIDEOS (index. [channel] title):
${vList}

Return ONLY JSON (no prose, no fences):
{
  "contextDigest": "<<=150 words, neutral factual overview of the overall situation grounded ONLY in the headlines>",
  "clusters": [   // propose 8-14 candidate clusters; OVER-generate, the editor will prune
    {
      "theme": "<short theme>",
      "headlineIdxs": [<headline indices that belong together>],
      "candidateTitles": ["<option A <=64 chars>", "<option B>"],
      "candidateMarketIds": [<spiking market ids plausibly related, or []>],
      "candidateVideoIdxs": [<video indices plausibly related, or []>],
      "freshestAgeMin": <smallest ageMinutes among the cluster's headlines, or null>
    }
  ]
}

Rules: group by DISTINCT real events. Over-generate clusters (it is fine to propose overlapping or speculative ones). Do not invent events. Keep titles factual.`;

  const { json, usage } = await callJson(SONNET, 4000, prompt);
  log(`sonnet propose: ${(json.clusters || []).length} clusters (tokens ${usage?.input_tokens}/${usage?.output_tokens})`);
  return json;
}

// ---- Stage B — Opus: the senior editor (ALL content decisions) --------------
// Opus owns every editorial decision: which segments run, their titles, top
// sources, which videos appear, which prediction markets show on the home rail,
// ordering, what counts as breaking, and the overall status. Sonnet's digest +
// proposals are advisory raw material only.
async function decideEditorial(headlines, spikes, videos, proposals) {
  const hList = headlines.map((h, i) =>
    `${i}. [${h.source}/${h.sourceCategory}] ${h.title}${h.ageMinutes != null ? ` (${h.ageMinutes}m ago)` : ''}`
  ).join('\n');
  const mList = spikes.length
    ? spikes.map(s => `- id=${s.id} "${s.question}" now ${s.prob}, move ${s.delta}, ${s.meta}`).join('\n')
    : '(no markets are currently spiking)';
  const vList = videos.length
    ? videos.map((v, i) => `${i}. [${v.channel}] ${v.title}${v.publishedAt ? ` (${v.publishedAt})` : ''}`).join('\n')
    : '(no videos)';

  const prompt = `You are the SENIOR EDITOR of a cinematic Samsung TV briefing called IRAN WATCH that blends live news with prediction-market spikes. You make ALL the final editorial decisions. A junior desk (Sonnet) has drafted a context digest and candidate clusters as raw material — treat them as suggestions you may accept, merge, reorder, rename, or reject. Decide using ONLY the real data below.

NOW: ${new Date().toISOString()}

CONTEXT DIGEST (advisory, from the desk):
${proposals.contextDigest || '(none)'}

CANDIDATE CLUSTERS (advisory, from the desk):
${JSON.stringify(proposals.clusters || [], null, 0)}

FULL HEADLINE LIST (index. [source/category] title (age)) — the authoritative source set:
${hList}

SPIKING PREDICTION MARKETS:
${mList}

AVAILABLE VIDEOS (index. [channel] title (published)):
${vList}

Return ONLY JSON (no prose, no fences):
{
  "status": { "label": "<UPPERCASE short status, <=28 chars>", "severity": "calm|warning|critical" },
  "breakingIdx": <headline index of the single genuine BREAKING item right now, or null>,
  "homeMarketIds": [<ordered subset of the spiking market ids to DISPLAY on the home rail; pick the most decision-relevant, [] if none worth showing>],
  "segments": [   // 5-7 DISTINCT stories, MOST IMPORTANT FIRST; YOU decide the final set + order
    {
      "id": "<short-stable-slug>",
      "headline": "<<=64 chars, editorial, ends with a period>",
      "brief": "<1-2 sentences, <=180 chars>",
      "sourceIdxs": [<1-4 headline indices, most relevant FIRST — you choose the top sources>],
      "marketIds": [<spiking market ids truly about this story, or []>],
      "videoIdxs": [<video indices to show for this story (best first), or []>],
      "aiSummary": "<3-4 sentences, factual, ONLY from the referenced headlines>",
      "timeline": [ {"time":"<e.g. 'Sun 08:00' or 'NOW'>","cap":"<<=40 chars>","now":<bool>} ],
      "watch": {"source":"<outlet>","duration":"<m:ss>"} | null
    }
  ]
}

Rules (you have final say):
- Choose the segment set, titles, ordering, and the TOP sources per story. Prefer fresher, higher-signal headlines; swap in a newer development over an older one when they compete.
- videoIdxs: pick the clips that genuinely match the story (freshest, on-topic). [] if none fit — never force an unrelated clip.
- homeMarketIds: decide which prediction markets earn a spot on the home rail (most relevant to the lead stories).
- breakingIdx: ONLY a headline younger than ~90 minutes describing a major new development; else null.
- timeline: 3-5 points ONLY for a genuine multi-step chronology; else []. Last point now=true when ongoing.
- severity: critical if active strikes/invasion/blockade; warning if fragile/strained; calm if stable.
- Do not invent events. Distinct stories only. Ground every summary ONLY in the referenced headlines.`;

  const { json, usage } = await callJson(OPUS, 6000, prompt);
  log(`opus decide: ${(json.segments || []).length} segments, ${(json.homeMarketIds || []).length} home markets (tokens ${usage?.input_tokens}/${usage?.output_tokens})`);
  return json;
}

// ---- Sonnet: design one segment's drill-down layout (cached by stable id) ---
// Layout is mostly mechanical module selection, so we use the cheaper Sonnet here
// (content decisions are Opus's job upstream). Cache key is the STABLE segment id
// + capability flags, NOT the summary text, so the cache actually hits run-to-run
// even as wording drifts — Sonnet only fires for genuinely new/changed segments.
async function designLayout(segment, redis, opts) {
  opts = opts || {};
  const hasTimeline = Array.isArray(segment.timeline) && segment.timeline.length >= 3;
  const hasMarket = !!opts.hasMarket;
  const hasVideos = !!opts.hasVideos;
  const hash = crypto.createHash('sha1')
    .update((segment.id || segment.headline || '') + '|v' + hasVideos + 'm' + hasMarket + 't' + hasTimeline)
    .digest('hex').slice(0, 16);
  if (redis) {
    try { const c = await redis.get(LAYOUT_PREFIX + hash); if (c) { return typeof c === 'string' ? JSON.parse(c) : c; } } catch {}
  }
  // Static instruction block — identical across every per-segment call in a run,
  // so we send it as a cached system block (prompt caching) and bill it once.
  const system = `You are an expert TV layout designer. Design the DETAILS (drill-down) page for ONE news story on a cinematic 1920x1080 Samsung TV. The page MUST fit one screen (no scrolling). You choose which modules to show, their order, and a couple of content accents. A fixed renderer draws them.

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

  const prompt = `STORY:
headline: ${segment.headline}
summary: ${segment.aiSummary}
multi-step timeline available: ${hasTimeline}
linked spiking market: ${hasMarket}
playable video clips available: ${hasVideos}`;

  let layout;
  try {
    const { json } = await callJson(SONNET, 1200, prompt, { system });
    layout = json;
  } catch (e) {
    log('sonnet layout failed, using default', e.message);
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

// ---- persistence ------------------------------------------------------------
async function persist(bundle, redis) {
  if (redis) { try { await redis.set(REDIS_KEY, JSON.stringify(bundle)); log('wrote Redis', REDIS_KEY); } catch (e) { log('redis write failed', e.message); } }
  fs.writeFileSync(OUT_FILE, JSON.stringify(bundle, null, 2));
  log('wrote', OUT_FILE, '| stories:', (bundle.stories || []).length, '| signals:', (bundle.signals || []).length, '| breaking:', bundle.breaking ? 'yes' : 'no', bundle._meta?.reused ? '| REUSED (no LLM)' : '');
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

// ---- change-detection gate (state-aware novelty) ---------------------------
// We do NOT gate on a raw timestamp. We diff the freshly fetched feeds against
// what the app is ALREADY showing (the previous bundle) and only pay for a new
// curation when a genuinely NEW, Iran-relevant item would change something a
// viewer can see on some page:
//   - a new, fresh headline that isn't already a source/hero anywhere, or
//   - a change in which prediction markets are spiking, or a direction flip.
// Otherwise we reuse the last editorial and just re-price the displayed markets
// (the rail + market chart stay live). A hard MAX_REUSE_MS cap bounds staleness.
// This is purely structural — the gate itself costs no tokens.
const GATE_STOP = new Set(('the a an of to in on for and or with by from at is are be as was were has have had ' +
  'its their his her our your you we it that this these those over under into out up down ' +
  'new latest live breaking watch report reports says said after before amid iran irans iranian').split(/\s+/));
function titleTokens(t) {
  return new Set(String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !GATE_STOP.has(w)));
}
function coveredBy(tokens, shownList) {
  if (!tokens.size) return true; // nothing distinctive -> treat as already-covered
  for (const s of shownList) { let hit = 0; for (const w of tokens) if (s.has(w)) hit++; if (hit / tokens.size >= 0.75) return true; }
  return false;
}
function tsMs(o) {
  let t = o && o.publishedAt ? Date.parse(o.publishedAt) : NaN;
  if (isNaN(t) && o && o.ageMinutes != null) t = Date.now() - o.ageMinutes * 60000;
  return isNaN(t) ? 0 : t;
}
function extractShownState(prev) {
  const links = new Set(), titles = [], videoIds = new Set(), markets = new Map();
  let newest = 0;
  for (const st of (prev.stories || [])) {
    if (st.headline) titles.push(titleTokens(st.headline));
    const d = st.drilldown || {};
    for (const s of (d.sources || [])) {
      if (s.link) links.add(s.link);
      if (s.title) titles.push(titleTokens(s.title));
      const t = tsMs(s); if (t > newest) newest = t;
    }
    for (const v of (d.videos || [])) { if (v.videoId) videoIds.add(v.videoId); const t = tsMs(v); if (t > newest) newest = t; }
  }
  for (const s of (prev.signals || [])) markets.set(String(s.id), s.deltaColor || '');
  return { links, titles, videoIds, markets, newest };
}
// Decide whether anything genuinely new (and Iran-relevant) should change a page.
function detectNovelty(prev, headlines, spikes) {
  if (!prev || !(prev.stories || []).length) return { changed: true, reasons: ['no prior bundle'] };
  const S = extractShownState(prev);
  const FRESH_WINDOW = Number(process.env.INTEL_FRESH_WINDOW_MIN || 180) * 60000;
  const reasons = [];
  // New headline: not an existing source link, not a near-duplicate of a shown
  // title, AND genuinely recent (newer than anything shown, or within the fresh
  // window) so selection jitter resurfacing an OLD item doesn't trigger a rebuild.
  const newH = headlines.filter(h => {
    if (h.link && S.links.has(h.link)) return false;
    if (coveredBy(titleTokens(h.title), S.titles)) return false;
    const t = tsMs(h);
    return (S.newest && t > S.newest) || (h.ageMinutes != null && h.ageMinutes * 60000 <= FRESH_WINDOW);
  });
  if (newH.length) reasons.push(`${newH.length} new headline(s) e.g. "${(newH[0].title || '').slice(0, 64)}"`);
  // Spiking-market membership change or direction flip.
  for (const s of spikes) {
    const prevDir = S.markets.get(String(s.id));
    if (prevDir === undefined) { reasons.push(`new spiking market ${s.id}`); break; }
    if (prevDir && prevDir !== s.deltaColor) { reasons.push(`market ${s.id} flipped ${prevDir}->${s.deltaColor}`); break; }
  }
  return { changed: reasons.length > 0, reasons };
}

async function loadPrevBundle(redis) {
  if (redis) { try { const c = await redis.get(REDIS_KEY); if (c) return typeof c === 'string' ? JSON.parse(c) : c; } catch {} }
  try { if (fs.existsSync(OUT_FILE)) return JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); } catch {}
  return null;
}

// On a gated skip we keep last run's editorial decisions but re-price the displayed
// markets straight from their CLOB token history — no dependence on the volatile
// markets fetch, so every displayed market refreshes reliably.
async function refreshSignals(prevBundle) {
  const sigs = prevBundle.signals || [];
  return Promise.all(sigs.map(async (prev) => {
    if (!prev.yesToken) return prev;
    const hist = await W.fetchMarketHistory(prev.yesToken, { interval: '1w', fidelity: 60 });
    if (!hist || hist.length < 3) return prev;
    const lastP = hist[hist.length - 1].p;
    const d24 = W.measuredDelta(hist, 24) || 0;
    const pct = Math.round(lastP * 100);
    const up = d24 >= 0;
    return {
      ...prev,
      prob: pct + '%',
      probColor: pct <= 15 ? 'red' : (pct >= 60 ? 'green' : 'amber'),
      delta: (up ? '+' : '') + Math.round(d24 * 100) + ' pts',
      deltaColor: up ? 'green' : 'red',
      spark: W.sparkFromHistory(hist.map(p => p.p)),
      history: hist.map(p => Math.round(p.p * 1000) / 1000),
    };
  }));
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
  const markets = mRes.markets || [];
  // Stateless spikes: prefilter a few candidates, then pull REAL Polymarket history
  // for just those to measure the true move + build the chart (no self-tracking).
  const candidates = W.pickSpikeCandidates(markets, { max: Number(process.env.INTEL_SPIKE_CANDIDATES || 10) });
  const spikes = await W.enrichSpikesWithHistory(candidates, { threshold: Number(process.env.INTEL_SPIKE_THRESHOLD || 0.03), max: 4 });
  log(`headlines=${headlines.length} markets=${markets.length} candidates=${candidates.length} spikes=${spikes.length} videos=${videosAll.length} weather=${weather ? weather.tempC + 'C' : 'n/a'}`);

  if (!headlines.length) { log('no headlines; aborting (keeping previous bundle)'); process.exit(1); }

  // Change-detection gate: only pay for a new curation when a genuinely new,
  // Iran-relevant item would change something shown on a page. Otherwise reuse
  // the last editorial and just re-price the displayed markets.
  const MAX_REUSE_MS = Number(process.env.INTEL_MAX_REUSE_MS || 25 * 60 * 1000);
  const prev = await loadPrevBundle(redis);
  const novelty = detectNovelty(prev, headlines, spikes);
  const prevAge = prev?.generatedAt ? (Date.now() - Date.parse(prev.generatedAt)) : Infinity;
  if (process.env.INTEL_FORCE !== '1' && prev && !novelty.changed && prevAge < MAX_REUSE_MS) {
    log(`no new Iran info changes any page (last build ${Math.round(prevAge / 60000)}m ago) — reuse + re-price, NO LLM`);
    prev.signals = await refreshSignals(prev);
    prev.generatedAt = new Date().toISOString();
    prev._meta = { ...prev._meta, reused: true, reusedAt: prev.generatedAt };
    await persist(prev, redis);
    return;
  }
  log(novelty.changed ? `curating — ${novelty.reasons.join('; ')}` : `reuse cap reached (${Math.round(prevAge / 60000)}m) — refreshing editorial`);

  // Two-stage curation: Sonnet drafts proposals + context (cheap), Opus decides
  // ALL content (segments, titles, sources, videos, home markets, swaps).
  const proposals = await proposeContext(headlines, spikes, videosAll);
  const curated = await decideEditorial(headlines, spikes, videosAll, proposals);
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

    // videos: Opus-chosen clips (videoIdxs into videosAll). Fall back to keyword
    // matching only when Opus didn't choose — and never force an unrelated clip.
    const toCard = v => ({ videoId: v.videoId, title: v.title, channel: v.channel, thumbnailUrl: v.thumbnailUrl, publishedAt: v.publishedAt });
    const chosenVids = (seg.videoIdxs || []).map(i => videosAll[i]).filter(Boolean);
    const vids = chosenVids.length
      ? chosenVids.slice(0, 6).map(toCard)
      : videosAll
          .map(v => ({ v, s: scoreVideoForSegment(v, seg) }))
          .filter(x => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 6)
          .map(x => toCard(x.v));

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

  // Home rail: Opus decides which prediction markets (and order) appear. Fall back to all spikes.
  const homeIds = (curated.homeMarketIds || []).map(String);
  const displaySpikes = homeIds.length
    ? homeIds.map(id => spikes.find(s => String(s.id) === id)).filter(Boolean)
    : spikes;

  // Enrich each DISPLAYED signal with market-drilldown data: related headlines + related markets + storyId
  displaySpikes.forEach(s => {
    const sid = String(s.id);
    const story = stories.find(st => (st.marketIds || []).map(String).indexOf(sid) >= 0);
    s.storyId = story ? story.id : null;
    s.relatedHeadlines = story ? (story.drilldown.sources || []).map(src => ({ title: src.title, outlet: src.outlet, meta: src.meta })) : [];
    s.relatedMarketIds = displaySpikes.filter(o => o.id !== s.id).map(o => o.id);
  });

  // Breaking pill: only when Opus flagged a genuinely fresh headline
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
    signals: displaySpikes.map(s => ({
      id: s.id, yesToken: s.yesToken || null, question: s.question, prob: s.prob, probColor: s.probColor,
      delta: s.delta, deltaColor: s.deltaColor, meta: s.meta, spike: true, spark: s.spark,
      byDate: s.byDate || null, history: s.history || [],
      storyId: s.storyId || null, relatedHeadlines: s.relatedHeadlines || [], relatedMarketIds: s.relatedMarketIds || [],
    })),
    stories,
    uiDecisions: { accent: accentBySev[sev] },
    generatedAt: new Date().toISOString(),
    model: { proposer: SONNET, editor: OPUS, designer: SONNET },
    _meta: {
      headlines: headlines.length, markets: markets.length, spikes: spikes.length,
      homeMarkets: displaySpikes.length,
      curatedAt: new Date().toISOString(),
    },
  };

  await persist(bundle, redis);
}

main().catch(e => { console.error('[build-intel] FATAL', e); process.exit(1); });
