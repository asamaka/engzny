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
const NT = require('../api/lib/news-topics');   // active scope → "relevant by nature" vocabulary

const SONNET = process.env.INTEL_SONNET || 'claude-sonnet-4-5-20250929';
const OPUS = process.env.INTEL_OPUS || 'claude-opus-4-6';
const HAIKU = process.env.INTEL_HAIKU || 'claude-haiku-4-5-20251001';
const NEWSROOM = process.env.INTEL_NEWSROOM || SONNET;                          // model for the full-text rewrite pass
const ARTICLE_CHARS = Number(process.env.INTEL_ARTICLE_CHARS || 3000);          // per-source body length fed to the rewrite
const WEBSEARCH_MAX = Number(process.env.INTEL_WEBSEARCH_MAX || 3);             // web_search uses per story (0 disables search)
const REDIS_KEY = 'tv:war:intel:v1';
const LAYOUT_PREFIX = 'tv:war:intel:layout:';
const SEG_KEY = 'tv:war:segments:v1';            // persistent segment memory (the "iceberg")
const SEG_FILE = process.env.INTEL_SEG_OUT || path.join(__dirname, '..', 'intel-segments.json');
const OUT_FILE = process.env.INTEL_OUT || path.join(__dirname, '..', 'intel-bundle.json');
const MODULE_LIBRARY = ['summary', 'marketImpact', 'videos', 'sources', 'timeline', 'keyQuote', 'statCallouts'];
const DORMANT_MS = Number(process.env.INTEL_DORMANT_MS || 3 * 3600 * 1000);   // off-screen this long => resurfacing
const DEAD_DAYS = Number(process.env.INTEL_SEG_DEAD_DAYS || 7);               // no update this long => archived
const REGISTRY_CAP = Number(process.env.INTEL_SEG_CAP || 80);                 // keep newest N segments
// "first reported" must reflect when the STORY broke, not a stale background
// article the editor happened to group in. A source dated more than this far
// before we first started tracking the segment is treated as a mis-grouped
// explainer/archive piece and is NOT allowed to back-date "first reported"
// (that's how a fresh Hebron story showed "3mo ago"). Generous enough to honor
// a story that genuinely broke a few days before we caught it.
const FIRST_REPORT_BACKDATE_MS = Number(process.env.INTEL_FIRST_REPORT_BACKDATE_DAYS || 3) * 86400000;

function log(...a) { console.error('[build-intel]', ...a); }

// Human-friendly relative age for prompts/logs ("3h ago", "2d ago").
function relAge(iso) {
  if (!iso) return 'unknown';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'unknown';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(0, m)}m ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

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

// Like callJson, but with Anthropic server-side web_search enabled so the model
// can corroborate claims live. web_search is a server tool — the API runs the
// searches and returns the finished answer in one call (no client tool loop).
async function callJsonWithSearch(model, maxTokens, prompt, maxUses = WEBSEARCH_MAX) {
  const a = W.getAnthropic();
  if (!a) throw new Error('ANTHROPIC_API_KEY not set');
  const params = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  if (maxUses > 0) params.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }];
  const r = await a.messages.create(params);
  const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const searches = (r.content || []).filter(b => b.type === 'server_tool_use').length;
  return { json: extractJson(text), usage: r.usage, searches };
}

// ---- Stage C — Newsroom rewrite: read the FULL articles + corroborate ------
// The triage stages (Sonnet/Opus) work from headline strings, which is enough to
// GROUP and SELECT stories but not enough to write an accurate headline/summary —
// that's how a single state-media headline gets laundered into neutral "fact".
// For each selected story we fetch its sources' full bodies and run one rewrite
// pass WITH live web search, under strict attribution rules. Falls back to the
// triage draft on any failure (missing key, blocked sources, etc.).
// web_search makes the model emit inline citation tags (<cite index="3-5">…</cite>)
// and bracketed footnote markers; those are display artifacts, not prose, and the
// TV/phone render these fields as escaped text — strip them to clean prose.
function stripCites(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/<\/?cite[^>]*>/gi, '')
    .replace(/\s*\[(?:\d+[-,\d\s]*)\]/g, '')   // [3-5], [1, 2]
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function newsroomRewrite(seg, sources, redis) {
  const withBodies = await Promise.all((sources || []).map(async s => ({
    ...s, body: await W.extractArticleText(s.link, { maxChars: ARTICLE_CHARS, redis }),
  })));
  const fetched = withBodies.filter(s => s.body).length;
  const blocks = withBodies.map((s, i) =>
    `[SOURCE ${i + 1}] ${s.outlet || '?'} (${s.category || 'n/a'} bloc)${s.publishedAt ? ', published ' + s.publishedAt : ''}\n`
    + `headline: ${s.title}\nurl: ${s.link}\n`
    + `full text: ${s.body || '(could not fetch — corroborate via web search)'}`
  ).join('\n\n');

  const prompt = `You are the senior newsroom editor for IRAN WATCH. Rewrite ONE story so its headline, brief, and summary are grounded in the FULL article text below and CORROBORATED with a live web search — not laundered from a single source's spin.

NOW: ${new Date().toISOString()}

CURRENT DRAFT (written from headline strings only — improve it):
headline: ${seg.headline}
brief: ${seg.brief || ''}

SOURCE ARTICLES (${fetched}/${withBodies.length} full bodies fetched):
${blocks}

RULES — attribution is the whole point:
1. Web-search the central facts (who said/did what, casualty figures, dates) against INDEPENDENT outlets before writing.
2. A fact confirmed by 2+ independent outlets (different blocs) may be stated plainly. A claim found in only ONE source — especially state media (Press TV, Tehran Times) or any single partisan outlet — MUST be attributed in the prose ("Press TV reports…", "the IDF says…", "according to Iranian state media…"). NEVER restate one partisan source's framing ("humiliated enemy", "decisive victory") as neutral fact.
3. If web search contradicts a source, prefer the corroborated version and flag the dispute. Do not fabricate; mark anything uncorroborated as unconfirmed.
4. Lead the headline with the genuinely NEWEST, most significant development. Do NOT dress up a routine or anniversary statement as breaking news.
5. Keep it tight and TV-ready. Ground everything in the bodies above + your web-search findings.
6. Output CLEAN PROSE only — do NOT put <cite> tags, citation markers, or bracketed footnotes ([1], [3-5]) inside any field; attribute in words instead ("Reuters reports…").
7. timeline: ONLY if this story is a real multi-step chronology AND you know the EXACT time of each step — stamp each point with a clock time ("Thu 14:00") or a specific date ("Jun 4"), each a distinct event. If you'd have to approximate ("Thu evening", "recently") or you don't have datable steps, return an empty array []. Do not pad a single event into fake steps. Not every story needs a timeline.

Return ONLY JSON (no prose, no fences):
{
  "headline": "<=64 chars, editorial, ends with a period, leads with the newest development",
  "brief": "<1-2 sentences, <=180 chars, attribution-aware>",
  "aiSummary": "<3-5 sentences from the full text + corroboration; single-source claims attributed>",
  "timeline": [ {"time":"<EXACT: a clock time 'Thu 14:00' or a specific date 'Jun 4'>","cap":"<<=40 chars, a distinct event>","now":<bool>} ],
  "corroboration": "high|mixed|single-source"
}`;

  try {
    const { json, usage, searches } = await callJsonWithSearch(NEWSROOM, 2000, prompt);
    log(`newsroom "${seg.id}": ${fetched}/${withBodies.length} bodies, ${searches} searches, corro=${json.corroboration || '?'} (tokens ${usage?.input_tokens}/${usage?.output_tokens})`);
    return json;
  } catch (e) {
    log(`newsroom "${seg.id}" failed (${e.message}) — keeping triage draft`);
    return null;
  }
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
async function decideEditorial(headlines, spikes, videos, proposals, existingDigest) {
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

EXISTING SEGMENTS (persistent memory — stories ALREADY tracked across previous runs; REUSE an id when a cluster continues one of these, even if the wording changed):
${existingDigest || '(none yet — this is a fresh start)'}

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
  "segments": [   // 5-7 DISTINCT stories to DISPLAY now, MOST IMPORTANT FIRST; YOU decide the final set + order
    {
      "id": "<REUSE an existing id if this continues a tracked story; otherwise a NEW short-stable-slug>",
      "isMajorUpdate": <true ONLY if there is a genuinely NEW development since this story was last covered; false if it is the same information reworded or merely re-sourced>,
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
- CONTINUITY OF IDENTITY, FRESHNESS OF HEADLINE: If a cluster is the SAME underlying story as one in EXISTING SEGMENTS, you MUST reuse that segment's id (do not invent a new slug for it). BUT the headline must always describe the LATEST development — when isMajorUpdate=true, REWRITE the headline + brief to lead with what is newest (never keep a stale headline frozen across days just because the id is reused). Create a NEW id ONLY for a genuinely new, distinct development not already tracked.
- isMajorUpdate=true when a real new development has occurred since this story was last covered (a new strike, a new casualty count, a new diplomatic move); false only when it is the same information merely re-sourced or reworded with nothing new.
- Do NOT manufacture breaking-ness: breakingIdx is for a genuinely fresh major item, not a reword. But DO keep the wall alive — a running story with a real new development today should lead with today's angle, not yesterday's headline.
- Choose the segment set, titles, ordering, and the TOP sources per story. Prefer stories with a real new development (isMajorUpdate=true) or strong fresh sourcing. RETIRE a story that has had no genuinely new development in over a day to make room for a fresher distinct one when slots are contested — do not let the same 7 headlines sit unchanged for days.
- videoIdxs: pick ONLY clips whose title COVERS this specific story (the same event/people/place) or directly supports its content — NOT clips that are merely about the same region or war (everything here is regionally relevant, so that bar is too low). [] if none truly cover it — never force an on-region-but-off-story clip (the builder also searches for matching clips, so [] is fine).
- homeMarketIds: decide which prediction markets earn a spot on the home rail (most relevant to the lead stories).
- breakingIdx: ONLY a headline younger than ~90 minutes describing a major new development; else null.
- timeline: include ONLY when the story is a genuine multi-step chronology AND you know WHEN each step happened. Give 3-5 points, each stamped with a CONCRETE time (a clock time like "Fri 22:00" or a specific date like "Jun 4"), each a DISTINCT event (never restate the headline as a step). If you'd have to write vague buckets ("Fri evening", "recently") or you don't have datable steps, return []. Most stories do NOT need a timeline. Last point now=true when ongoing.
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

// ---- video relevance: COVERS the story, not just "relevant by nature" -------
// Everything on this wall is regionally relevant, so plain keyword overlap (the
// old gate accepted ANY shared word >3 chars) attached generic Iran/Israel/war
// footage to unrelated segments — a Lebanon humanitarian clip landed on an Iran
// inflation story. The fix: a clip must share DISTINCTIVE tokens — ones that are
// NOT part of the scope's own "everything here is about this" vocabulary. The
// generic set is DERIVED from the active scope's core front + editorial fillers
// (no hard-coded keyword list), so front-specific subjects (iaea, hormuz, kuwait,
// hezbollah, aoun) still count as distinctive and identify a specific story.
const VIDEO_MIN_MATCH = Number(process.env.INTEL_VIDEO_MIN_MATCH || 2);
const GENERIC_VIDEO_TOKENS = (() => {
  const scope = NT.activeScope();
  const core = (scope.topics && scope.topics[0] && scope.topics[0].keywords) || []; // the umbrella actor (iran…)
  // Pervasive vocabulary that is "relevant by nature" on a conflict wall: the
  // other universal actors/regions, editorial fillers, attribution verbs, and the
  // generic war-action verbs that recur in nearly every headline. Sharing only
  // these does NOT mean a clip covers a SPECIFIC story.
  const universal =
    'israel israeli america american war conflict crisis region regional gulf mideast middle east '
    + 'news live breaking update latest report watch video shorts amid after over says said tell told '
    + 'warn claim vow urge accuse reject deny strike struck attack fire hit launch shell raid '
    + 'tension escalate';
  return new Set([...core.flatMap(k => k.split(/\s+/)), ...universal.split(/\s+/)].map(normToken));
})();
// Light normalization so lebanese~lebanon, iranian~iran, strikes~strike unify.
function normToken(w) {
  const NORM = { lebanese: 'lebanon', iranian: 'iran', irans: 'iran', israeli: 'israel', americans: 'america', american: 'america' };
  w = String(w || '').toLowerCase();
  if (NORM[w]) return NORM[w];
  return w.replace(/(ed|ing|s)$/, '');
}
function distinctiveTokens(text) {
  const out = new Set();
  for (const raw of String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)) {
    if (raw.length < 4) continue;
    const w = normToken(raw);
    if (!w || w.length < 3 || GENERIC_VIDEO_TOKENS.has(w)) continue;
    out.add(w);
  }
  return out;
}
// How strongly a clip's TITLE covers a segment's specific story (count of shared
// distinctive tokens). 0 = on-region-but-off-story (must not be forced on).
function videoCoversSegment(v, seg) {
  const segTok = distinctiveTokens((seg.headline || '') + ' ' + (seg.aiSummary || seg.brief || ''));
  let hits = 0;
  for (const w of distinctiveTokens(v.title)) if (segTok.has(w)) hits++;
  return hits;
}
function videoQueryFor(seg) {
  return String(seg.headline || '').replace(/[.;|].*$/, '').replace(/["']/g, '').trim().slice(0, 90);
}

// ---- timeline: only a genuine, EXACTLY-timestamped multi-step chronology -----
// Not every story is a sequence of events, and a timeline is meaningless without
// real times. We keep entries stamped with a CONCRETE time (a clock time, or a
// specific calendar date) and drop vague buckets ("Fri evening", "Sat AM",
// "recently"). If fewer than 2 concretely-timed historical steps survive, the
// story has no datable sequence and gets NO timeline (returns []).
const TL_MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const TL_DATE_RE = new RegExp(`(?:${TL_MONTHS})[a-z]*\\.?\\s*\\d{1,2}|\\d{1,2}\\s*(?:${TL_MONTHS})|\\d{4}-\\d{2}-\\d{2}`, 'i');
function isConcreteTime(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  if (/\d{1,2}:\d{2}/.test(s)) return true;   // a clock time, e.g. "Fri 22:00"
  return TL_DATE_RE.test(s);                   // a specific date, e.g. "Jun 4", "Jun 13 2025"
}
function sanitizeTimeline(tl) {
  if (!Array.isArray(tl)) return [];
  const cleaned = []; const seen = new Set();
  for (const e of tl) {
    if (!e || !e.cap) continue;
    const cap = String(e.cap).trim();
    const key = cap.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;   // drop a step that just restates an earlier one
    const now = e.now === true || /^\s*now\s*$/i.test(String(e.time || ''));
    if (!now && !isConcreteTime(e.time)) continue;   // drop vague/undated steps
    seen.add(key);
    cleaned.push({ time: now ? 'NOW' : String(e.time).trim(), cap, now });
  }
  if (cleaned.filter(e => !e.now).length < 2) return [];   // no real datable sequence
  return cleaned.slice(0, 5);
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
  // A very-fresh headline is treated as a genuine development even if it shares
  // tokens with a story we're already showing. This is the key freshness fix:
  // a NEW Lebanon strike ("Israel strikes Beirut again") overlaps heavily with
  // the running Lebanon segment, so the 75% token-dedup used to swallow it and
  // the feed sat still. Below the breaking window we bypass that dedup so the
  // development forces a rebuild (which lets the editor re-lead/re-title it).
  const BREAKING_MIN = Number(process.env.INTEL_BREAKING_MIN || 45);
  const reasons = [];
  // New headline: a fresh source we aren't already linking. We skip the
  // near-duplicate dedup for breaking-fresh items; for older items we still
  // require it not be a reword of something shown (so selection jitter
  // resurfacing an OLD item doesn't trigger a needless rebuild).
  const newH = headlines.filter(h => {
    if (h.link && S.links.has(h.link)) return false;
    const breaking = h.ageMinutes != null && h.ageMinutes <= BREAKING_MIN;
    if (!breaking && coveredBy(titleTokens(h.title), S.titles)) return false;
    const t = tsMs(h);
    return breaking || (S.newest && t > S.newest) || (h.ageMinutes != null && h.ageMinutes * 60000 <= FRESH_WINDOW);
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

// ---- persistent segment memory (the "iceberg" the cron reasons over) --------
// Each cron run reconciles the freshly-curated segments against a durable registry
// so we (a) never resurface the same story as a brand-new "first reported" item,
// (b) keep a true first-report time + running update history per segment, and
// (c) reuse a stable curated image instead of re-picking (and flip-flopping) it.
async function loadRegistry(redis) {
  if (redis) { try { const c = await redis.get(SEG_KEY); if (c) return typeof c === 'string' ? JSON.parse(c) : c; } catch {} }
  try { if (fs.existsSync(SEG_FILE)) return JSON.parse(fs.readFileSync(SEG_FILE, 'utf8')); } catch {}
  return { version: 1, segments: {} };
}
async function saveRegistry(redis, reg) {
  reg.updatedAt = new Date().toISOString();
  if (redis) { try { await redis.set(SEG_KEY, JSON.stringify(reg)); } catch (e) { log('registry redis write failed', e.message); } }
  try { fs.writeFileSync(SEG_FILE, JSON.stringify(reg, null, 2)); } catch {}
}
function segSourceMeta(sources) {
  const links = new Set(), outlets = new Set(), cats = new Set();
  let newest = 0, oldest = Infinity;
  for (const s of (sources || [])) {
    if (s.link) links.add(s.link);
    if (s.outlet) outlets.add(s.outlet);
    if (s.category) cats.add(s.category);
    const t = s.publishedAt ? Date.parse(s.publishedAt) : NaN;
    if (!isNaN(t)) { if (t > newest) newest = t; if (t < oldest) oldest = t; }
  }
  return {
    links: [...links], outlets: [...outlets], cats: [...cats],
    newestAt: newest ? new Date(newest).toISOString() : null,
    oldestAt: oldest !== Infinity ? new Date(oldest).toISOString() : null,
  };
}
// Reconcile one curated segment into the registry; returns the durable record.
function mergeSegment(reg, seg, sources, now) {
  const nowISO = new Date(now).toISOString();
  const sm = segSourceMeta(sources);
  const isMajor = !!seg.isMajorUpdate;
  let rec = reg.segments[seg.id];
  let resurfaced = false;
  if (!rec) {
    // Don't let a stale grouped-in article back-date "first reported" before we
    // ever started tracking this story (minus a small grace for a real recent break).
    const floor = now - FIRST_REPORT_BACKDATE_MS;
    const oldest = sm.oldestAt ? Date.parse(sm.oldestAt) : now;
    rec = {
      id: seg.id, createdAt: nowISO, firstReportedAt: nowISO,
      firstSeenSourceAt: new Date(Math.min(now, Math.max(floor, oldest))).toISOString(),
      updateCount: 0, sourceLinks: [], outlets: [], categories: [], shownCount: 0,
    };
    reg.segments[seg.id] = rec;
  } else {
    const lastShown = rec.lastShownAt ? Date.parse(rec.lastShownAt) : 0;
    resurfaced = isMajor && (!lastShown || (now - lastShown) > DORMANT_MS);
    // The earliest a source may push "first reported" is a grace window before we
    // first tracked the segment (createdAt). Heals records already poisoned by a
    // months-old article, and refuses new ones, while keeping the true earliest
    // time for legitimately long-running stories.
    const floor = (rec.createdAt ? Date.parse(rec.createdAt) : now) - FIRST_REPORT_BACKDATE_MS;
    const candidate = sm.oldestAt ? Math.max(floor, Date.parse(sm.oldestAt)) : null;
    const current = rec.firstSeenSourceAt ? Date.parse(rec.firstSeenSourceAt) : Infinity;
    const next = Math.max(floor, Math.min(current, candidate != null ? candidate : current));
    rec.firstSeenSourceAt = new Date(next).toISOString(); // true earliest, clamped to the floor
  }
  rec.sourceLinks = [...new Set([...(rec.sourceLinks || []), ...sm.links])];
  rec.outlets = [...new Set([...(rec.outlets || []), ...sm.outlets])];
  rec.categories = [...new Set([...(rec.categories || []), ...sm.cats])];
  const grew = sm.links.some(l => !(rec._lastLinks || []).includes(l)); // genuinely new sourcing this run
  rec._lastLinks = sm.links;
  rec.title = seg.headline; rec.brief = seg.brief; rec.aiSummary = seg.aiSummary || seg.brief;
  rec.timeline = Array.isArray(seg.timeline) ? seg.timeline : (rec.timeline || []);
  rec.marketIds = (seg.marketIds || []).map(String);
  rec.newestSourceAt = sm.newestAt || rec.newestSourceAt || nowISO;
  if (grew || isMajor) rec.latestUpdateAt = nowISO;
  if (isMajor) { rec.latestMajorUpdateAt = nowISO; rec.updateCount = (rec.updateCount || 0) + 1; }
  if (!rec.latestUpdateAt) rec.latestUpdateAt = nowISO;
  if (!rec.latestMajorUpdateAt) rec.latestMajorUpdateAt = rec.firstReportedAt;
  rec.sourceCount = rec.sourceLinks.length;
  rec.outletCount = rec.outlets.length;
  rec.coveragePct = Math.round((rec.categories.length / 4) * 100); // share of the 4 source blocs
  rec.resurfaced = resurfaced;
  return rec;
}
// Status transitions + size cap after a run.
function finalizeRegistry(reg, displayedIds, now) {
  const shown = new Set(displayedIds);
  const nowISO = new Date(now).toISOString();
  for (const rec of Object.values(reg.segments)) {
    if (shown.has(rec.id)) {
      rec.status = 'active'; rec.lastShownAt = nowISO; rec.shownCount = (rec.shownCount || 0) + 1;
    } else {
      const age = now - Date.parse(rec.latestUpdateAt || rec.firstReportedAt || nowISO);
      rec.status = age > DEAD_DAYS * 86400000 ? 'dead' : 'dormant';
      rec.resurfaced = false;
    }
  }
  const all = Object.values(reg.segments).sort((a, b) => Date.parse(b.latestUpdateAt || 0) - Date.parse(a.latestUpdateAt || 0));
  if (all.length > REGISTRY_CAP) for (const rec of all.slice(REGISTRY_CAP)) delete reg.segments[rec.id];
}
// Haiku: a short, concrete visual query for the keyless image search fallback.
async function imageQueryFor(seg) {
  try {
    const txt = await W.anthropicText({
      model: HAIKU, max_tokens: 24,
      prompt: `Give a 2-4 word concrete, photographable visual subject (a place, landmark, vehicle, building, or scene) that best illustrates this news story for a TV thumbnail. Output ONLY the search phrase. No quotes, no punctuation, no personal names.\nHeadline: ${seg.headline}\nSummary: ${seg.aiSummary || seg.brief || ''}`,
    });
    return (txt || '').trim().replace(/^["']|["']$/g, '').split('\n')[0].slice(0, 60) || null;
  } catch { return null; }
}
// Resolve the segment's curated image: stable reuse unless missing or a major update;
// prefer a real photo from the story's own sources, else a keyless web image search.
async function resolveSegmentImage(seg, rec, ogImg, isMajor) {
  if (rec.image && !isMajor) return rec.image;       // stable: don't flip-flop the photo every run
  if (ogImg) return ogImg;                           // freshest story-specific press photo
  const q = (rec.imageQuery && !isMajor) ? rec.imageQuery : await imageQueryFor(seg);
  rec.imageQuery = q;
  const found = await W.searchPhoto(q);
  return found || rec.image || null;
}

// ---- main -------------------------------------------------------------------
async function main() {
  const redis = W.getRedis();
  const NOW = Date.now();
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

  // Persistent segment memory: the editor reasons against everything we've tracked
  // so it continues existing stories (reusing their id) instead of resurfacing them
  // as brand-new "first reported" items.
  const registry = await loadRegistry(redis);
  const existingDigest = Object.values(registry.segments || {})
    .filter(s => s.status !== 'dead')
    .sort((a, b) => Date.parse(b.latestUpdateAt || 0) - Date.parse(a.latestUpdateAt || 0))
    .slice(0, 24)
    .map(s => `- id=${s.id} "${s.title}" (first reported ${relAge(s.firstSeenSourceAt)}, last update ${relAge(s.latestUpdateAt)}, ${s.sourceCount || 0} sources, ${s.status || 'active'})`)
    .join('\n');

  // Two-stage curation: Sonnet drafts proposals + context (cheap), Opus decides
  // ALL content (segments, titles, sources, videos, home markets, swaps) — now also
  // classifying each into an existing segment id or a brand-new one.
  const proposals = await proposeContext(headlines, spikes, videosAll);
  const curated = await decideEditorial(headlines, spikes, videosAll, proposals, existingDigest);
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

    // Newsroom rewrite: read the full source bodies + corroborate via web search,
    // then replace the headline-only triage draft (and store the richer text in the
    // registry below). Skipped with INTEL_NEWSROOM_OFF=1.
    if (process.env.INTEL_NEWSROOM_OFF !== '1' && sources.length) {
      const rw = await newsroomRewrite(seg, sources, redis);
      if (rw) {
        if (rw.headline) seg.headline = stripCites(String(rw.headline)).slice(0, 80);
        if (rw.brief) seg.brief = stripCites(rw.brief);
        if (rw.aiSummary) seg.aiSummary = stripCites(rw.aiSummary);
        if (Array.isArray(rw.timeline) && rw.timeline.length) {
          seg.timeline = rw.timeline.map(t => ({ ...t, cap: stripCites(t.cap) }));
        }
        if (rw.corroboration) seg.corroboration = rw.corroboration;
      }
    }

    // Timeline discipline: a timeline only survives if it is a genuine multi-step
    // chronology with CONCRETE timestamps — otherwise it is dropped here (so the
    // registry, layout, and drilldown all agree there is no timeline).
    seg.timeline = sanitizeTimeline(seg.timeline);

    // og candidate (Sonnet-picked photo, else first candidate) = freshest story-specific photo
    const cands = candsBySeg[si] || [];
    let ogImg = null;
    const pi = picked[si] != null ? picked[si] : picked[String(si)];
    if (pi != null && cands[pi]) ogImg = cands[pi].url;
    if (!ogImg && cands.length) ogImg = cands[0].url;

    // Reconcile this segment into persistent memory, then resolve a STABLE curated
    // image (reused run-to-run unless missing or a real new development).
    if (!seg.id) seg.id = (seg.headline || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || crypto.randomBytes(4).toString('hex');
    const rec = mergeSegment(registry, seg, sources, NOW);
    rec.image = await resolveSegmentImage(seg, rec, ogImg, !!seg.isMajorUpdate);
    rec.imageResolvedAt = new Date(NOW).toISOString();

    // videos: every segment should carry clips that COVER its specific story —
    // not clips that are merely about the same region/war. Widen the candidate
    // pool with a targeted keyless search for THIS headline, merge the editor's
    // picks + the broadcaster pool, then keep only clips that share enough
    // DISTINCTIVE tokens to actually cover the story (never forcing an off-story
    // clip). If nothing clears the bar, fall back to the on-topic SEARCH hits
    // (which are about this headline by construction) before giving up.
    const toCard = v => ({
      videoId: v.videoId, title: v.title, channel: v.channel,
      thumbnailUrl: v.thumbnailUrl || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      publishedAt: v.publishedAt || null,
    });
    const searched = process.env.INTEL_VIDEO_SEARCH_OFF === '1'
      ? [] : await W.searchVideos(videoQueryFor(seg), { max: 8 }).catch(() => []);
    const opusPicked = (seg.videoIdxs || []).map(i => videosAll[i]).filter(Boolean);
    const pool = []; const seenV = new Set();
    for (const v of [...opusPicked, ...searched, ...videosAll]) {
      if (!v || !v.videoId || seenV.has(v.videoId)) continue;
      seenV.add(v.videoId); pool.push(v);
    }
    const scored = pool.map(v => ({ v, s: videoCoversSegment(v, seg) }));
    let picks = scored.filter(x => x.s >= VIDEO_MIN_MATCH);
    // Safety net so a segment isn't left blank: search hits are on-topic by
    // construction (we searched THIS headline), so accept those sharing >=1
    // distinctive token. We still refuse a pool clip that covers nothing.
    if (!picks.length) picks = scored.filter(x => x.s >= 1 && x.v.searched);
    // Rank: strongest coverage first; at a tie prefer the VETTED broadcaster pool
    // clip over an arbitrary search-channel one, then the fresher clip.
    picks.sort((a, b) => b.s - a.s
      || (a.v.searched === b.v.searched ? 0 : a.v.searched ? 1 : -1)
      || (Date.parse(b.v.publishedAt || 0) - Date.parse(a.v.publishedAt || 0)));
    const vids = picks.slice(0, 6).map(x => toCard(x.v));

    const linkedSpikes = (seg.marketIds || []).map(id => spikeById[id]).filter(Boolean);
    const layout = await designLayout(seg, redis, { hasMarket: linkedSpikes.length > 0, hasVideos: vids.length > 0 });
    stories.push({
      id: seg.id,
      headline: seg.headline, brief: seg.brief,
      image: rec.image || null, hasMarket: linkedSpikes.length > 0,
      marketIds: (seg.marketIds || []).filter(id => spikeById[id]),
      // metadata contract — the persistent "iceberg" stats the API/TV can reason over
      meta: {
        firstReportedAt: rec.firstSeenSourceAt || rec.firstReportedAt,
        newestSourceAt: rec.newestSourceAt || null,   // newest underlying source (true freshness signal)
        latestUpdateAt: rec.latestUpdateAt,
        latestMajorUpdateAt: rec.latestMajorUpdateAt,
        updateCount: rec.updateCount || 0,
        sourceCount: rec.sourceCount || 0,
        outletCount: rec.outletCount || 0,
        coveragePct: rec.coveragePct || 0,
        resurfaced: !!rec.resurfaced,
        corroboration: seg.corroboration || null,   // high | mixed | single-source (newsroom web-search verdict)
        status: 'active',
      },
      // Honest freshness: a long-running story (Lebanon front, Hormuz) keeps the
      // SAME segment for days for continuity, but if its newest source is recent
      // it is NOT stale — show "updated <recent>" so a 4h-old development doesn't
      // read as "first reported 2 days ago". Only genuinely quiet stories show
      // their original first-reported time. firstReportedAt is always carried so
      // the client can still show "tracking since …".
      freshness: (() => {
        const newest = rec.newestSourceAt ? Date.parse(rec.newestSourceAt) : 0;
        const FRESH_LABEL_MS = Number(process.env.INTEL_FRESH_LABEL_MIN || 360) * 60000; // 6h
        const firstAt = rec.firstSeenSourceAt || rec.firstReportedAt;
        if (rec.resurfaced || (newest && (NOW - newest) <= FRESH_LABEL_MS)) {
          return { label: 'updated', at: rec.newestSourceAt || rec.latestMajorUpdateAt, firstReportedAt: firstAt };
        }
        return { label: 'first reported', at: firstAt, firstReportedAt: firstAt };
      })(),
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

  // Reconcile registry status against what actually reached the screen, then persist
  // the segment memory (the iceberg) so the next run continues these stories.
  finalizeRegistry(registry, stories.map(s => s.id), NOW);
  await saveRegistry(redis, registry);

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

if (require.main === module) {
  main().catch(e => { console.error('[build-intel] FATAL', e); process.exit(1); });
}

module.exports = { stripCites, sanitizeTimeline, isConcreteTime, videoCoversSegment, distinctiveTokens };
