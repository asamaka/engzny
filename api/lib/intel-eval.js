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

// Establish "reality at the timestamp" with a live web search: the real top
// developments + the market-relevant questions + a one-line situation. Returns a
// structured object or throws if the model/tool is unavailable.
async function fetchGroundTruth({ atISO, scope = NT.activeScope(), topK = 8, maxUses = 6, anthropic = W.getAnthropic() } = {}) {
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY not set (ground truth needs web search)');
  const brief = NT.scopeBrief(scope);
  const prompt =
    `You are a news desk fact-checker establishing GROUND TRUTH. It is ${atISO}. Use web search to determine ` +
    `the real situation RIGHT NOW for ${brief.label}: ${brief.description}\n\nFronts to cover: ${brief.fronts.join('; ')}.\n\n` +
    `Search broadly (each front), then return the ${topK} MOST IMPORTANT real developments as of this timestamp — ` +
    `the things a serious viewer must not miss. Do NOT include events you cannot find a real source for, and do NOT ` +
    `include developments that clearly post-date ${atISO}.\n\n` +
    `Return ONLY JSON (no prose, no fences):\n{\n` +
    `  "asOf": "${atISO}",\n` +
    `  "situation": "<2-3 sentence neutral summary of the real state of play>",\n` +
    `  "events": [ { "title": "<concrete headline of the real development>", "front": "<which front>", ` +
    `"importance": <1-5, 5=must-lead>, "firstReportedAt": "<approx ISO time it broke, best estimate>", ` +
    `"sources": ["<outlet>", ...] } ],\n` +
    `  "marketQuestions": [ "<prediction-market-style question that genuinely matters now>", ... ]\n}`;
  const resp = await anthropic.messages.create({
    model: GT_MODEL,
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
    messages: [{ role: 'user', content: prompt }],
  });
  const gt = extractJson(joinText(resp));
  gt.events = Array.isArray(gt.events) ? gt.events.slice(0, topK + 4) : [];
  gt.marketQuestions = Array.isArray(gt.marketQuestions) ? gt.marketQuestions.slice(0, 10) : [];
  gt._model = GT_MODEL;
  return gt;
}

// ----------------------------------------------------------------- LLM: reflection
// Opus judge: turn the snapshot + ground truth + computed metrics into a written
// reflection — what we missed and WHY, plus concrete, structured recommendations
// (source to add / knob to change / prompt to adjust) so the loop can close.
async function reflect({ bundle, groundTruth, metrics, anthropic = W.getAnthropic() } = {}) {
  if (!anthropic) return null;
  const stories = (bundle && bundle.stories || []).map((s, i) => `${i}. ${s.headline} [freshness: ${s.freshness && s.freshness.label} ${s.freshness && s.freshness.at}]`).join('\n');
  const missed = (metrics.coverage.missed || []).map(m => `- (${m.importance}/5) ${m.title}${m.fronts && m.fronts.length ? ` [${m.fronts.join(',')}]` : ''}`).join('\n') || '(none)';
  const prompt =
    `You are auditing a live news dashboard against reality. Be concrete and critical.\n\n` +
    `SITUATION (ground truth): ${groundTruth.situation || '(none)'}\n\n` +
    `WHAT THE DASHBOARD IS SHOWING (story headlines):\n${stories || '(none)'}\n\n` +
    `REAL DEVELOPMENTS WE MISSED (importance-weighted):\n${missed}\n\n` +
    `COMPUTED SCORES (0-100): composite ${metrics.composite}, coverage ${metrics.coverage.score}, ` +
    `freshness ${metrics.freshness.score} (median displayed age ${metrics.freshness.medianDisplayedAgeH}h, ` +
    `label honesty ${metrics.freshness.labelHonesty}), staleness ${metrics.staleness.score} ` +
    `(stale fraction ${metrics.staleness.staleFraction}), market alignment ${metrics.marketAlignment.score}.\n\n` +
    `Return ONLY JSON:\n{\n` +
    `  "grade": "A|B|C|D|F",\n` +
    `  "narrative": "<3-5 sentences: how well does the feed reflect reality right now, and the single biggest gap>",\n` +
    `  "recommendations": [ { "type": "source|knob|prompt|other", "target": "<file/env/source to change>", ` +
    `"detail": "<specific change>", "priority": "P0|P1|P2", "rationale": "<why, tied to a miss above>" } ]\n}`;
  try {
    const resp = await anthropic.messages.create({ model: JUDGE_MODEL, max_tokens: 1800, messages: [{ role: 'user', content: prompt }] });
    const out = extractJson(joinText(resp));
    out._model = JUDGE_MODEL;
    return out;
  } catch (e) {
    return { grade: null, narrative: 'reflection failed: ' + e.message, recommendations: [] };
  }
}

// ----------------------------------------------------------------- orchestration
// Full evaluation: ground truth (web search) -> deterministic metrics -> reflection.
// `bundle` is the snapshot to grade. Returns the structured report (not persisted).
async function scoreSnapshot({ bundle, now = Date.now(), scope = NT.activeScope(), reflectEnabled = true, gtOpts = {} } = {}) {
  if (!bundle || !Array.isArray(bundle.stories)) throw new Error('scoreSnapshot needs a bundle with stories[]');
  const atISO = new Date(now).toISOString();
  const groundTruth = await fetchGroundTruth({ atISO, scope, ...gtOpts });
  const metrics = computeMetrics(bundle, groundTruth, now);
  const reflection = reflectEnabled ? await reflect({ bundle, groundTruth, metrics }) : null;
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
    reflection,
    groundTruth,
    models: { groundTruth: GT_MODEL, judge: JUDGE_MODEL },
  };
}

// ----------------------------------------------------------------- persistence
async function loadBundle(redis = W.getRedis()) {
  if (redis) { try { const c = await redis.get('tv:war:intel:v1'); if (c) return typeof c === 'string' ? JSON.parse(c) : c; } catch {} }
  const file = path.join(__dirname, '..', '..', 'intel-bundle.json');
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return null;
}
// Compact history entry (the full report is large; the log keeps the trend line).
function summarize(report) {
  return {
    evaluatedAt: report.evaluatedAt,
    snapshotGeneratedAt: report.snapshotGeneratedAt,
    composite: report.scores.composite,
    scores: report.scores,
    grade: report.reflection && report.reflection.grade,
    missedCount: (report.coverage.missed || []).length,
    topMiss: (report.coverage.missed || [])[0] ? report.coverage.missed[0].title : null,
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
  fetchGroundTruth, reflect, scoreSnapshot,
  // persistence
  loadBundle, saveReport, loadLatest, loadHistory, summarize,
  EVAL_KEY, EVAL_LOG,
};
