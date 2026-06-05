/**
 * intel-eval.js — snapshot-vs-reality accuracy harness for the cinematic intel feed.
 *
 * The feed can drift: a story freezes, a front goes uncovered (e.g. a fresh
 * Lebanon strike), a stale headline lingers — and nothing notices until a human
 * does. This module measures that. Given a feed snapshot (the bundle the TV is
 * showing) and an independently-established picture of REALITY at that timestamp
 * (the real top developments + the market truth, from a live web search), it
 * scores how well the snapshot reflects reality and reflects on what was missed.
 *
 * Design:
 *   - The SCORING is deterministic + pure (coverage/recall, freshness, staleness,
 *     market alignment) so it is unit-testable and stable run-to-run.
 *   - The GROUND TRUTH and the written REFLECTION use Claude (web_search for
 *     reality, Opus as judge for the miss-list + recommendations). Both are
 *     guarded so the pure path works without network/keys.
 *
 * Output is a structured report stored with history (tv:war:eval:*), so accuracy
 * can be charted over time as the curation/sourcing is tuned. Run on demand
 * (POST /api/tv/intel/eval) or on a schedule (scripts/eval-intel.js cron).
 */
const path = require('path');
const fs = require('fs');
const W = require('./war-sources');     // reuse the lazy Anthropic + Redis clients
const NT = require('./news-topics');

const GT_MODEL = process.env.INTEL_EVAL_GT_MODEL || process.env.INTEL_SONNET || 'claude-sonnet-4-5-20250929';
const JUDGE_MODEL = process.env.INTEL_EVAL_JUDGE_MODEL || process.env.INTEL_OPUS || 'claude-opus-4-6';
const EVAL_KEY = 'tv:war:eval:v1';
const EVAL_LOG = 'tv:war:eval:log';
const EVAL_LOG_CAP = Number(process.env.INTEL_EVAL_LOG_CAP || 60);
const EVAL_FILE = process.env.INTEL_EVAL_OUT || path.join(__dirname, '..', '..', 'intel-eval.json');

// Composite weights (must sum to 1). Coverage (did we have the real top news?)
// dominates; freshness + staleness capture "looks static"; markets are a slice.
const WEIGHTS = { coverage: 0.40, freshness: 0.25, staleness: 0.15, marketAlignment: 0.20 };
const MATCH_THRESHOLD = Number(process.env.INTEL_EVAL_MATCH || 0.34);  // token overlap to call an event "covered"

// A concise, accurate model of the generation pipeline, handed to the judge so it
// can localize WHERE a gap originates (which stage failed) and recommend a
// STRUCTURAL fix — a code change, a knob, or a prompt GENERALIZATION — instead of
// a special-case keyword band-aid. Keep this in sync with build-intel.js /
// war-sources.js / news-topics.js when the architecture changes.
const ARCHITECTURE_BRIEF = `The feed is produced hourly by scripts/build-intel.js through these stages — a gap can originate in ANY of them, so attribute it precisely:
1. INGESTION (api/lib/war-sources.js, WAR_FEEDS): ~18 RSS / Google-News-query sources, tiered (tier1 = fast wire/aggregator queries, tier2 = major outlets, tier3 = regional/state) and tagged with the fronts they cover. Best-effort; a dead feed is skipped. A real story absent here was never ingested → fix is a SOURCE (add/retune a feed) or a Google-News query.
2. RELEVANCE FILTER (war-sources.filterIranWarRelevant): Haiku marks each headline in-scope or not, using a prompt + regex GENERATED from api/lib/news-topics.js fronts (no hard-coded keywords). A real story dropped here → the scope/front config or the filter prompt is too narrow → fix is a PROMPT GENERALIZATION or a new/widened front in news-topics.js.
3. DEDUP: headlines with >60% word overlap collapse to one. Over-aggressive dedup can merge distinct events.
4. NOVELTY GATE (build-intel.detectNovelty): structural, no LLM. A rebuild happens only if a genuinely-new in-scope headline appears (not already shown, not a 75% token-duplicate of a shown title UNLESS it is breaking-fresh <= INTEL_BREAKING_MIN) OR a market spikes/flips; otherwise the previous editorial is REUSED and only markets re-price. If the wall is stale-but-fresh-news-exists, suspect this gate (knobs: INTEL_BREAKING_MIN, INTEL_FRESH_WINDOW_MIN, INTEL_MAX_REUSE_MS).
5. MEMORY / "iceberg" (tv:war:segments:v1): persistent segments keep a stable id across runs for continuity; status active/dormant/dead. Continuity can freeze a headline if the editor doesn't re-title.
6. CURATION: Sonnet proposes 8-14 candidate clusters → Opus editor picks the final 5-7 segments, their id (reuse vs new), HEADLINE wording, top sources, linked markets/videos, summary, and ordering (build-intel.decideEditorial prompt). Title-wording and "which 7 made the wall" gaps live here → fix is the editor PROMPT.
7. IMAGES: og:image per source → Sonnet picks the best real photo (avoids flags/logos) → keyless Wikimedia/Openverse fallback. Stable reuse unless a major update.
8. STALENESS DROP + FRESHNESS LABEL: stories whose newest source is too old are dropped; the displayed label is "updated <recent>" when a source is recent, else "first reported".
9. MARKETS (war-sources.fetchWarMarkets): Polymarket scanned → Haiku selects in-scope (prompt from news-topics) → real CLOB history measures spikes → Opus picks the home rail.
Prefer fixes that improve the STRUCTURE (a front in news-topics, a source tier, a gate knob, a prompt generalization that removes a restriction) over one-off special-casing.`;

// ----------------------------------------------------------------- pure text utils
const STOP = new Set(('the a an of to in on for and or with by from at is are be as was were has have had its their ' +
  'his her our your you we it that this these those over under into out up down new latest live breaking watch report ' +
  'says said after before amid will would could more most than then over about against' ).split(/\s+/));
function tokens(s) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)));
}
// Overlap of two token sets as |A∩B| / |smaller| — robust to length differences
// (a short ground-truth title vs a longer story headline+brief).
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0; for (const w of a) if (b.has(w)) hit++;
  return hit / Math.min(a.size, b.size);
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function median(xs) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function importanceOf(ev) { return clamp(Number(ev && ev.importance) || 3, 1, 5); }

// ----------------------------------------------------------------- snapshot reads
// Newest underlying source time for a story (its true freshness), in ms or null.
function storyNewestMs(story) {
  const cands = [story.meta && story.meta.newestSourceAt];
  for (const s of (story.drilldown && story.drilldown.sources) || []) cands.push(s.publishedAt);
  for (const v of (story.drilldown && story.drilldown.videos) || []) cands.push(v.publishedAt);
  let newest = null;
  for (const c of cands) { const t = c ? Date.parse(c) : NaN; if (!isNaN(t) && (newest === null || t > newest)) newest = t; }
  if (newest === null && story.meta && story.meta.firstReportedAt) { const t = Date.parse(story.meta.firstReportedAt); if (!isNaN(t)) newest = t; }
  return newest;
}
function storyText(story) { return (story.headline || '') + ' ' + (story.brief || '') + ' ' + ((story.drilldown && story.drilldown.aiSummary) || ''); }

// ----------------------------------------------------------------- metrics (pure)
// COVERAGE / RECALL: of the real top events, how many did the feed surface?
// Importance-weighted, with a concrete miss-list (the gap = what we missed).
function scoreCoverage(stories, events) {
  const storyTok = stories.map(s => ({ s, t: tokens(storyText(s)) }));
  const covered = [], missed = [];
  let gotW = 0, totW = 0;
  for (const ev of events || []) {
    const w = importanceOf(ev); totW += w;
    const et = tokens(ev.title);
    let best = { score: 0, story: null };
    for (const st of storyTok) { const o = overlap(et, st.t); if (o > best.score) best = { score: o, story: st.s }; }
    if (best.score >= MATCH_THRESHOLD) { gotW += w; covered.push({ title: ev.title, importance: w, matchedStoryId: best.story.id, matchScore: Math.round(best.score * 100) / 100 }); }
    else missed.push({ title: ev.title, importance: w, firstReportedAt: ev.firstReportedAt || null, fronts: ev.fronts || [], sources: ev.sources || [], bestMatch: Math.round(best.score * 100) / 100 });
  }
  missed.sort((a, b) => b.importance - a.importance);
  const recall = totW ? gotW / totW : 1;
  const countRecall = (events && events.length) ? covered.length / events.length : 1;
  return { score: Math.round(recall * 100), recall: Math.round(recall * 100) / 100, countRecall: Math.round(countRecall * 100) / 100, covered, missed };
}

// FRESHNESS: are displayed stories actually recent, and is the displayed
// freshness LABEL honest (does it reflect the newest source, not a 2-day-old
// first-report time)? `now` in ms.
function scoreFreshness(stories, now) {
  const ages = [], mislabeled = [];
  for (const st of stories || []) {
    const newest = storyNewestMs(st);
    if (newest != null) ages.push((now - newest) / 3600000);
    const f = st.freshness || {};
    const labelAt = f.at ? Date.parse(f.at) : NaN;
    // Mislabeled = story has a recent source but is stamped with a much older time.
    if (newest != null && !isNaN(labelAt) && (now - newest) <= 6 * 3600000 && (now - labelAt) > 18 * 3600000) {
      mislabeled.push({ id: st.id, displayedAt: f.at, newestSourceAt: new Date(newest).toISOString() });
    }
  }
  const medianAgeH = median(ages);
  const labelHonesty = stories && stories.length ? (stories.length - mislabeled.length) / stories.length : 1;
  // Score: full marks when median displayed story is < 6h old, decaying to ~0 by 48h,
  // then discounted by label honesty (a story shown as 2-days-old reads as stale).
  const freshComponent = medianAgeH == null ? 60 : clamp(100 - (medianAgeH - 6) * (100 / 42), 0, 100);
  const score = Math.round(freshComponent * (0.5 + 0.5 * labelHonesty));
  return { score, medianDisplayedAgeH: medianAgeH == null ? null : Math.round(medianAgeH * 10) / 10, labelHonesty: Math.round(labelHonesty * 100) / 100, mislabeled };
}

// STALENESS: what fraction of the wall is genuinely old (newest source beyond
// the threshold)? A high fraction is the "list sat unchanged for days" symptom.
function scoreStaleness(stories, now, thresholdH = Number(process.env.INTEL_EVAL_STALE_H || 24)) {
  if (!stories || !stories.length) return { score: 100, staleFraction: 0, stale: [] };
  const stale = [];
  for (const st of stories) {
    const newest = storyNewestMs(st);
    const ageH = newest == null ? null : (now - newest) / 3600000;
    if (ageH == null || ageH > thresholdH) stale.push({ id: st.id, headline: st.headline, ageHours: ageH == null ? null : Math.round(ageH * 10) / 10 });
  }
  const frac = stale.length / stories.length;
  return { score: Math.round((1 - frac) * 100), staleFraction: Math.round(frac * 100) / 100, stale };
}

// MARKET ALIGNMENT: of the prediction-market questions reality says matter now,
// how many are on our home rail — and are the ones we show actually relevant?
function scoreMarketAlignment(signals, realMarkets) {
  const shown = (signals || []).map(s => tokens(s.question));
  const real = realMarkets || [];
  if (!real.length) return { score: shown.length ? 70 : 50, realCovered: [], realMissed: [], note: 'no market truth provided' };
  const realCovered = [], realMissed = [];
  for (const q of real) {
    const qt = tokens(typeof q === 'string' ? q : q.question || q.title || '');
    const hit = shown.some(s => overlap(qt, s) >= 0.34);
    (hit ? realCovered : realMissed).push(typeof q === 'string' ? q : (q.question || q.title));
  }
  const recall = real.length ? realCovered.length / real.length : 1;
  return { score: Math.round(recall * 100), recall: Math.round(recall * 100) / 100, realCovered, realMissed };
}

function compositeScore(parts) {
  let s = 0;
  for (const k of Object.keys(WEIGHTS)) s += (parts[k] && typeof parts[k].score === 'number' ? parts[k].score : 0) * WEIGHTS[k];
  return Math.round(s);
}

// Roll the pure metrics into a metrics block. `now` defaults to evaluation time.
function computeMetrics(bundle, groundTruth, now = Date.now()) {
  const stories = (bundle && bundle.stories) || [];
  const coverage = scoreCoverage(stories, (groundTruth && groundTruth.events) || []);
  const freshness = scoreFreshness(stories, now);
  const staleness = scoreStaleness(stories, now);
  const marketAlignment = scoreMarketAlignment((bundle && bundle.signals) || [], (groundTruth && groundTruth.marketQuestions) || []);
  const composite = compositeScore({ coverage, freshness, staleness, marketAlignment });
  return { composite, coverage, freshness, staleness, marketAlignment };
}

// ----------------------------------------------------------------- LLM: ground truth
function extractJson(text) {
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s !== -1 && e !== -1) t = t.slice(s, e + 1);
  return JSON.parse(t);
}
function joinText(resp) { return ((resp && resp.content) || []).filter(b => b.type === 'text').map(b => b.text).join('\n'); }

// Render the live feed (the same bundle /m shows) as text the judge can read:
// each story's headline + brief + summary + freshness + sources + image/market
// presence, plus the market rail. This is the pipeline's attempt at a worldview.
function feedDigest(bundle) {
  const stories = ((bundle && bundle.stories) || []).map((s, i) => {
    const f = s.freshness || {};
    const srcs = ((s.drilldown && s.drilldown.sources) || []).map(x => x.outlet).filter(Boolean).slice(0, 4).join(', ');
    return `#${i} id=${s.id} | "${s.headline}"\n   brief: ${s.brief || ''}\n   summary: ${(s.drilldown && s.drilldown.aiSummary) || ''}\n   freshness: ${f.label || '?'} ${f.at || ''} | sources: ${srcs || 'none'} | image: ${s.image ? 'yes' : 'NONE'} | linkedMarkets: ${(s.marketIds || []).length}`;
  }).join('\n');
  const sigs = ((bundle && bundle.signals) || []).map(s => `- "${s.question}" ${s.prob} (${s.delta})`).join('\n') || '(none)';
  return { stories: stories || '(none)', sigs };
}

// Reality-only web search (used when the heavy reflection is skipped) — still
// needed so the deterministic metrics have a top-list to score against.
async function fetchReality({ atISO, scope = NT.activeScope(), topK = 10, maxUses = 6, anthropic = W.getAnthropic() } = {}) {
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY not set (reality needs web search)');
  const brief = NT.scopeBrief(scope);
  const prompt =
    `It is ${atISO}. Using web search, establish the REAL state of play for ${brief.label}: ${brief.description}\n` +
    `Search EACH front: ${brief.fronts.join('; ')}.\n\n` +
    `Return your independent TOP ${topK} headlines a serious viewer must not miss as of now. Only include items you ` +
    `can source; do not include developments that clearly post-date ${atISO}.\n\n` +
    `Return ONLY JSON: {"situation":"<2-3 sentences>","topHeadlines":[{"rank":1,"title":"...","summary":"<2-3 sentence content>",` +
    `"front":"...","importance":<1-5>,"firstReportedAt":"<approx ISO>","sources":["<outlet>"],"photoSuggestion":"<concrete photo subject>"}],` +
    `"marketQuestions":["<question that genuinely matters now>"]}`;
  const resp = await anthropic.messages.create({
    model: GT_MODEL, max_tokens: 5000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
    messages: [{ role: 'user', content: prompt }],
  });
  const r = extractJson(joinText(resp));
  r.topHeadlines = Array.isArray(r.topHeadlines) ? r.topHeadlines.slice(0, topK + 4) : [];
  r.marketQuestions = Array.isArray(r.marketQuestions) ? r.marketQuestions.slice(0, 10) : [];
  r._model = GT_MODEL;
  return r;
}

// The full evaluation: a SINGLE architecture-aware Opus pass with web search.
// Opus (1) builds its OWN top-10 worldview from a standard web search — the view
// that "usually surfaces major stories well" — including content + a photo idea
// per headline; (2) reads the live feed (what /m shows), the pipeline's attempt
// at the same worldview via RSS + memory + filters + Haiku→Opus layers; (3) does
// a careful gap analysis across the FULL spectrum (story missing entirely → title
// wording should change to encapsulate/narrow → shallow content/photo gap →
// over-broad/merged) WITHOUT jumping to conclusions; and (4) attributes each gap
// to a pipeline STAGE and recommends STRUCTURAL fixes (code / knob / prompt
// generalization that removes a restriction) over special-casing.
async function evaluateFull({ bundle, atISO, scope = NT.activeScope(), maxUses = 6, anthropic = W.getAnthropic() } = {}) {
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY not set (evaluation needs web search)');
  const brief = NT.scopeBrief(scope);
  const feed = feedDigest(bundle);
  const prompt =
`You are the senior editor-auditor of a cinematic news dashboard ("${brief.label}"). Work in PHASES and do not jump to conclusions.

NOW: ${atISO}
SCOPE: ${brief.description}
FRONTS: ${brief.fronts.join('; ')}

PHASE 1 — YOUR INDEPENDENT WORLDVIEW. Use web search across EVERY front to build the TOP 10 headlines a serious viewer must not miss right now. For each: the real title, 2-3 sentences of actual content, the front, importance 1-5, an approximate first-report time, the outlets carrying it, and a concrete PHOTO suggestion (a photographable subject that would illustrate it). Only include items you can source; exclude anything clearly post-dating NOW. Be rigorous: if a claim is uncertain or single-sourced (e.g. someone's death, a casualty count), mark it uncertain rather than asserting it.

PHASE 2 — READ THE PIPELINE'S FEED. This is what the dashboard is actually showing on the phone (/m), produced through RSS ingestion → relevance filter → dedup → novelty gate → persistent memory → Sonnet/Opus curation → images/markets. Study it:
STORIES:
${feed.stories}
MARKET RAIL:
${feed.sigs}

PHASE 3 — GAP ANALYSIS. The goal is for the pipeline's worldview to match a standard web search's worldview, reached through a DIFFERENT path. Compare your Phase-1 list to the feed and, for EACH of your top-10, classify the discrepancy across the full spectrum:
- "missing": the real story is absent from the feed entirely.
- "covered_reword": present but the TITLE should change to better encapsulate it (give the suggested title) — or the inverse, a feed title is too broad/narrow and should be split/merged.
- "covered_shallow": present but the summary/sources/photo are thin or the wrong emphasis.
- "over_broad" / "merged": the feed lumps distinct real stories together (or vice-versa).
- "covered_well": faithfully represented.
Also flag feed stories that DON'T map to any real top-10 (stale, over-covered, off-scope, wrong wording, or factually shaky).

PHASE 4 — ROOT CAUSE + STRUCTURAL FIXES. For each gap, attribute the LIKELY pipeline STAGE using this architecture:
${ARCHITECTURE_BRIEF}
Then recommend fixes that improve the STRUCTURE/architecture so the pipeline generalizes — a code change, a gate knob, a new/widened front in news-topics.js, a source/tier, or a PROMPT GENERALIZATION that removes a restriction — NOT a one-off keyword/special-case. Each recommendation must name the stage/file it targets and how it generalizes rather than patches.

Return ONLY JSON (no prose, no fences):
{
  "reality": { "situation": "<2-3 sentences>", "topHeadlines": [ {"rank":1,"title":"...","summary":"...","front":"...","importance":1-5,"firstReportedAt":"<approx ISO>","sources":["..."],"photoSuggestion":"..."} ], "marketQuestions": ["..."] },
  "gapAnalysis": [ {"realityRank":N,"title":"...","status":"missing|covered_reword|covered_shallow|over_broad|merged|covered_well","feedStoryId":"<id or null>","discrepancy":"<what's off, concretely>","suggestedTitle":"<better title or null>","likelyStage":"ingestion|relevance_filter|dedup|novelty_gate|memory|editor_selection|editor_wording|images|market_selection|freshness_label|unknown","confidence":"high|medium|low"} ],
  "feedOnlyStories": [ {"feedStoryId":"<id>","headline":"...","issue":"stale|over_covered|off_scope|wording|factual","note":"..."} ],
  "narrative": "<4-6 sentences: how close is the pipeline's worldview to a standard web search's, where does it diverge, and is the divergence ingestion, filtering, gating, memory, or curation — measured, no overclaiming>",
  "grade": "A|B|C|D|F",
  "recommendations": [ {"priority":"P0|P1|P2","type":"code|prompt|knob|source|architecture","target":"<file/env/source>","detail":"<the change>","generalizes":"<how it widens/structures rather than special-cases>","rationale":"<tied to a specific gap + stage>"} ]
}`;
  const resp = await anthropic.messages.create({
    model: JUDGE_MODEL, max_tokens: 8000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
    messages: [{ role: 'user', content: prompt }],
  });
  const out = extractJson(joinText(resp));
  const reality = out.reality || {};
  reality.topHeadlines = Array.isArray(reality.topHeadlines) ? reality.topHeadlines : [];
  reality.marketQuestions = Array.isArray(reality.marketQuestions) ? reality.marketQuestions : [];
  return {
    reality,
    gapAnalysis: Array.isArray(out.gapAnalysis) ? out.gapAnalysis : [],
    feedOnlyStories: Array.isArray(out.feedOnlyStories) ? out.feedOnlyStories : [],
    narrative: out.narrative || '',
    grade: out.grade || null,
    recommendations: Array.isArray(out.recommendations) ? out.recommendations : [],
    _model: JUDGE_MODEL,
  };
}

// ----------------------------------------------------------------- orchestration
// Full evaluation: Opus web-search worldview + feed read + gap analysis, then the
// deterministic metrics (scored against Opus's top-10). `bundle` is the snapshot
// to grade (what /m shows). Returns the structured report (not persisted).
async function scoreSnapshot({ bundle, now = Date.now(), scope = NT.activeScope(), reflectEnabled = true, gtOpts = {} } = {}) {
  if (!bundle || !Array.isArray(bundle.stories)) throw new Error('scoreSnapshot needs a bundle with stories[]');
  const atISO = new Date(now).toISOString();

  let reality, analysis;
  if (reflectEnabled) {
    const full = await evaluateFull({ bundle, atISO, scope, ...gtOpts });
    reality = full.reality;
    analysis = { gapAnalysis: full.gapAnalysis, feedOnlyStories: full.feedOnlyStories, narrative: full.narrative, grade: full.grade, recommendations: full.recommendations };
  } else {
    reality = await fetchReality({ atISO, scope, ...gtOpts });
    analysis = null;
  }

  // Deterministic backbone scored against Opus's independent top-10.
  const gtForMetrics = { events: reality.topHeadlines || [], marketQuestions: reality.marketQuestions || [] };
  const metrics = computeMetrics(bundle, gtForMetrics, now);

  return {
    evaluatedAt: atISO,
    snapshotGeneratedAt: bundle.generatedAt || null,
    snapshotReused: !!(bundle._meta && bundle._meta.reused),
    scope: { id: scope.id, label: scope.label },
    scores: {
      composite: metrics.composite,
      coverage: metrics.coverage.score,
      freshness: metrics.freshness.score,
      staleness: metrics.staleness.score,
      marketAlignment: metrics.marketAlignment.score,
    },
    coverage: metrics.coverage,
    freshness: metrics.freshness,
    staleness: metrics.staleness,
    marketAlignment: metrics.marketAlignment,
    reality,
    gapAnalysis: analysis ? analysis.gapAnalysis : [],
    feedOnlyStories: analysis ? analysis.feedOnlyStories : [],
    // `reflection` kept as the narrative/grade/recommendations envelope (stable shape for consumers).
    reflection: analysis ? { grade: analysis.grade, narrative: analysis.narrative, recommendations: analysis.recommendations } : null,
    models: { worldview: reflectEnabled ? JUDGE_MODEL : GT_MODEL, judge: JUDGE_MODEL },
  };
}

// ----------------------------------------------------------------- persistence
// Load the snapshot to grade. Prefers the live feed exactly as /m serves it when
// INTEL_EVAL_FEED_URL is set (e.g. https://www.thinx.fun/api/tv/intel/public),
// so the eval reads what the user actually sees; falls back to Redis then file.
async function loadBundle(redis = W.getRedis()) {
  const url = process.env.INTEL_EVAL_FEED_URL;
  if (url) {
    try { const r = await fetch(url); if (r.ok) { const b = await r.json(); if (b && Array.isArray(b.stories)) return b; } } catch {}
  }
  if (redis) { try { const c = await redis.get('tv:war:intel:v1'); if (c) return typeof c === 'string' ? JSON.parse(c) : c; } catch {} }
  const file = path.join(__dirname, '..', '..', 'intel-bundle.json');
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return null;
}
// Compact history entry (the full report is large; the log keeps the trend line).
function summarize(report) {
  const gaps = (report.gapAnalysis || []).filter(g => g.status && g.status !== 'covered_well');
  const missing = gaps.filter(g => g.status === 'missing');
  const topGap = missing[0] || gaps[0] || (report.coverage.missed || [])[0] || null;
  return {
    evaluatedAt: report.evaluatedAt,
    snapshotGeneratedAt: report.snapshotGeneratedAt,
    composite: report.scores.composite,
    scores: report.scores,
    grade: report.reflection && report.reflection.grade,
    gapCount: gaps.length,
    missingCount: missing.length,
    missedCount: (report.coverage.missed || []).length,
    topMiss: topGap ? topGap.title : null,
    recCount: (report.reflection && report.reflection.recommendations || []).length,
  };
}
async function saveReport(report, redis = W.getRedis()) {
  const summary = summarize(report);
  if (redis) {
    try {
      await redis.set(EVAL_KEY, JSON.stringify(report));
      await redis.lpush(EVAL_LOG, JSON.stringify(summary));
      await redis.ltrim(EVAL_LOG, 0, EVAL_LOG_CAP - 1);
    } catch (e) { /* file fallback below */ }
  }
  try { fs.writeFileSync(EVAL_FILE, JSON.stringify(report, null, 2)); } catch {}
  return summary;
}
async function loadLatest(redis = W.getRedis()) {
  if (redis) { try { const c = await redis.get(EVAL_KEY); if (c) return typeof c === 'string' ? JSON.parse(c) : c; } catch {} }
  try { if (fs.existsSync(EVAL_FILE)) return JSON.parse(fs.readFileSync(EVAL_FILE, 'utf8')); } catch {}
  return null;
}
async function loadHistory(n = 30, redis = W.getRedis()) {
  if (redis) {
    try {
      const raw = await redis.lrange(EVAL_LOG, 0, n - 1);
      return (raw || []).map(x => (typeof x === 'string' ? JSON.parse(x) : x));
    } catch {}
  }
  return [];
}

module.exports = {
  // pure scoring (unit-tested)
  tokens, overlap, storyNewestMs, importanceOf,
  scoreCoverage, scoreFreshness, scoreStaleness, scoreMarketAlignment, compositeScore, computeMetrics,
  WEIGHTS, MATCH_THRESHOLD,
  // llm + orchestration
  feedDigest, fetchReality, evaluateFull, scoreSnapshot, ARCHITECTURE_BRIEF,
  // persistence
  loadBundle, saveReport, loadLatest, loadHistory, summarize,
  EVAL_KEY, EVAL_LOG,
};
