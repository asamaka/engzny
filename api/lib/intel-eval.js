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
// Which model(s) build the independent "reality" worldview: 'both' (Gemini +
// Opus, cross-checked), 'gemini' (Google-grounded only), or 'opus' (web search).
const GT_PROVIDER = process.env.INTEL_EVAL_GT_PROVIDER || 'both';

// Lazy Gemini adapter (Google Search grounding). Cheap/fast worldview source.
let _gemini = null;
function getGemini() {
  if (_gemini !== null) return _gemini;
  if (!process.env.GEMINI_API_KEY) { _gemini = false; return false; }
  try {
    const { GeminiAdapter } = require('../llm/gemini');
    _gemini = new GeminiAdapter({ model: process.env.INTEL_EVAL_GEMINI || 'gemini-2.5-flash' });
  } catch { _gemini = false; }
  return _gemini;
}
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
6b. NEWSROOM REWRITE (build-intel.newsroomRewrite): for each SELECTED story, the chosen sources' FULL article bodies are fetched (war-sources.extractArticleText, cached) and one rewrite pass WITH live web_search regenerates the headline/brief/summary/timeline under strict attribution rules (single-source/state-media claims must be attributed, never stated as neutral fact; lead with the newest development, don't dress up a routine/anniversary statement as breaking). Emits meta.corroboration (high|mixed|single-source). A summary that launders one partisan source's spin, mis-attributes a quote, or reads as breaking when it's routine → fix is this PROMPT or the body-fetch coverage (knobs: INTEL_ARTICLE_CHARS, INTEL_WEBSEARCH_MAX, INTEL_NEWSROOM model).
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

// Shared "build your independent top-N worldview" instruction. Used verbatim by
// every worldview provider (Gemini-grounded, Opus/Sonnet web search) so they are
// graded on the same task and their lists are directly reconcilable.
function realityPrompt(brief, atISO, topK) {
  return (
    `It is ${atISO}. Using web search, establish the REAL state of play for ${brief.label}: ${brief.description}\n` +
    `Search EACH front: ${brief.fronts.join('; ')}.\n\n` +
    `Return your independent TOP ${topK} headlines a serious viewer must not miss right now. Only include items you ` +
    `can source; exclude anything clearly post-dating ${atISO}. If a claim is single-sourced or uncertain (a death, a ` +
    `casualty count, a battlefield claim), say so in the summary rather than asserting it.\n\n` +
    `Return ONLY JSON (no prose, no fences): {"situation":"<2-3 sentences>","topHeadlines":[{"rank":1,"title":"...",` +
    `"summary":"<2-3 sentence content>","front":"...","importance":<1-5>,"firstReportedAt":"<approx ISO>",` +
    `"sources":["<outlet>"],"photoSuggestion":"<concrete photo subject>"}],"marketQuestions":["<question that matters now>"]}`
  );
}

// Worldview via Anthropic web search (Opus for the cross-check, Sonnet for the
// cheap path). Returns {provider, situation, topHeadlines, marketQuestions}.
async function fetchRealityWebSearch({ atISO, scope = NT.activeScope(), model = GT_MODEL, provider, topK = 10, maxUses = 6, anthropic = W.getAnthropic() } = {}) {
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY not set (web-search worldview)');
  const resp = await anthropic.messages.create({
    model, max_tokens: 5000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
    messages: [{ role: 'user', content: realityPrompt(NT.scopeBrief(scope), atISO, topK) }],
  });
  const r = extractJson(joinText(resp));
  return {
    provider: provider || (/opus/i.test(model) ? 'opus' : 'sonnet'),
    situation: r.situation || '',
    topHeadlines: Array.isArray(r.topHeadlines) ? r.topHeadlines.slice(0, topK + 4) : [],
    marketQuestions: Array.isArray(r.marketQuestions) ? r.marketQuestions.slice(0, 10) : [],
  };
}

// Worldview via Gemini Flash + Google Search grounding — the "standard search that
// surfaces major stories well". Cheap/fast; citations backfill any missing sources.
async function fetchRealityGemini({ atISO, scope = NT.activeScope(), topK = 10, maxTokens = 8192, gemini = getGemini() } = {}) {
  if (!gemini) throw new Error('GEMINI_API_KEY not set (gemini worldview)');
  const prompt = realityPrompt(NT.scopeBrief(scope), atISO, topK) + '\n\nOutput ONLY the minified JSON object — no markdown, no commentary, no trailing notes.';
  // thinkingBudget:0 stops 2.5-Flash from spending the output budget on "thinking"
  // (which was returning empty/truncated text); the larger budget fits 10 items.
  const out = await gemini.generateTextWithGrounding({ prompt, maxTokens, thinkingBudget: 0 });
  let r;
  try { r = extractJson(out.text || ''); }
  catch (e) { throw new Error(`gemini worldview unparseable (textLen=${(out.text || '').length}, finish=${out.stopReason}): ${e.message}`); }
  const cites = out.citations || [];
  const topHeadlines = (Array.isArray(r.topHeadlines) ? r.topHeadlines.slice(0, topK + 4) : []).map(h => ({
    ...h, sources: (Array.isArray(h.sources) && h.sources.length) ? h.sources : cites.slice(0, 3),
  }));
  return {
    provider: 'gemini',
    situation: r.situation || '',
    topHeadlines,
    marketQuestions: Array.isArray(r.marketQuestions) ? r.marketQuestions.slice(0, 10) : [],
  };
}

// Reconcile N independent worldviews into one top-list. A headline surfaced by
// MORE than one provider is high-confidence (two independent searches agree); one
// surfaced by a single provider when others were available is low-confidence (a
// possible miss OR a possible single-source rumor — the judge is told to treat it
// cautiously). This operationalizes "don't jump to conclusions".
function reconcileWorldviews(lists, topK = 10) {
  const merged = [];
  for (const lst of lists) {
    for (const h of (lst.topHeadlines || [])) {
      if (!h || !h.title) continue;
      const ht = tokens(h.title);
      let hit = null;
      for (const m of merged) { if (overlap(ht, tokens(m.title)) >= 0.4) { hit = m; break; } }
      if (hit) {
        if (!hit.providers.includes(lst.provider)) hit.providers.push(lst.provider);
        hit.importance = Math.max(hit.importance, importanceOf(h));
        if ((h.summary || '').length > (hit.summary || '').length) { hit.summary = h.summary; if (h.title) hit.title = h.title; }
        if (!hit.photoSuggestion && h.photoSuggestion) hit.photoSuggestion = h.photoSuggestion;
        hit.sources = [...new Set([...(hit.sources || []), ...(h.sources || [])])].slice(0, 6);
      } else {
        merged.push({
          title: h.title, summary: h.summary || '', front: h.front || '', importance: importanceOf(h),
          firstReportedAt: h.firstReportedAt || null, sources: (h.sources || []).slice(0, 6),
          photoSuggestion: h.photoSuggestion || null, providers: [lst.provider],
        });
      }
    }
  }
  const multiProvider = lists.length > 1;
  for (const m of merged) {
    m.confidence = m.providers.length >= 2 ? 'high' : (multiProvider ? 'low' : 'medium');
  }
  // High-confidence (cross-confirmed) first, then importance.
  merged.sort((a, b) => (b.providers.length - a.providers.length) || (b.importance - a.importance));
  merged.forEach((m, i) => { m.rank = i + 1; });
  return {
    situation: lists.map(l => l.situation).filter(Boolean).join(' | '),
    topHeadlines: merged.slice(0, topK + 4),
    marketQuestions: [...new Set(lists.flatMap(l => l.marketQuestions || []))].slice(0, 12),
    providersUsed: lists.map(l => l.provider),
  };
}

// Opus judge — NO web search (the worldview is supplied, so Opus reasons over the
// reconciled reality + the live feed + the architecture instead of grading its own
// search). Produces the gap analysis + structural recommendations.
async function judge({ bundle, reality, atISO, scope = NT.activeScope(), anthropic = W.getAnthropic() } = {}) {
  if (!anthropic) return null;
  const brief = NT.scopeBrief(scope);
  const feed = feedDigest(bundle);
  const realLines = (reality.topHeadlines || []).map(h =>
    `${h.rank}. (${h.importance}/5, confidence:${h.confidence}, via:${(h.providers || []).join('+')}) [${h.front}] ${h.title}\n   ${h.summary || ''}${h.photoSuggestion ? `\n   photo: ${h.photoSuggestion}` : ''}`
  ).join('\n');
  const prompt =
`You are the senior editor-auditor of a cinematic news dashboard ("${brief.label}"). Work carefully; do not jump to conclusions.

NOW: ${atISO}

GROUND TRUTH — the real top stories, built independently by web search(es) and reconciled across providers. "confidence:high" = multiple independent searches agreed (trust it); "confidence:low" = only one provider surfaced it (it may be a genuine miss OR a single-source rumor — weigh a feed omission of a low-confidence item gently, and do NOT assert shaky claims as fact):
${realLines}

THE PIPELINE'S FEED — what the dashboard actually shows on the phone (/m), produced via RSS ingestion → relevance filter → dedup → novelty gate → persistent memory → Sonnet/Opus curation → images/markets:
STORIES:
${feed.stories}
MARKET RAIL:
${feed.sigs}

TASK 1 — GAP ANALYSIS. For EACH ground-truth headline, classify how the feed represents it across the full spectrum: "missing" (absent), "covered_reword" (present but the title should change to better encapsulate it — give the suggested title; or the inverse: a feed title too broad/narrow that should split/merge), "covered_shallow" (present but thin summary/sources/photo or wrong emphasis), "over_broad"/"merged" (feed lumps distinct stories), "covered_well". Then flag feed stories that map to NO ground-truth item (stale / over-covered / off-scope / wrong wording / factually shaky). Prioritize high-confidence misses.

TASK 2 — ROOT CAUSE + STRUCTURAL FIXES. Attribute each gap to the LIKELY pipeline STAGE using this architecture:
${ARCHITECTURE_BRIEF}
Recommend fixes that improve the STRUCTURE so the pipeline generalizes — a code change, a gate knob, a new/widened front in news-topics.js, a source/tier, or a PROMPT GENERALIZATION that removes a restriction — NOT a one-off keyword/special-case. Name the stage/file each targets and how it generalizes.

Return ONLY JSON (no prose, no fences):
{
  "gapAnalysis": [ {"realityRank":N,"title":"...","status":"missing|covered_reword|covered_shallow|over_broad|merged|covered_well","feedStoryId":"<id or null>","discrepancy":"<what's off>","suggestedTitle":"<better title or null>","likelyStage":"ingestion|relevance_filter|dedup|novelty_gate|memory|editor_selection|editor_wording|images|market_selection|freshness_label|unknown","confidence":"high|medium|low"} ],
  "feedOnlyStories": [ {"feedStoryId":"<id>","headline":"...","issue":"stale|over_covered|off_scope|wording|factual","note":"..."} ],
  "narrative": "<4-6 sentences: how close is the pipeline's worldview to a standard web search's, where it diverges, and whether the divergence is ingestion, filtering, gating, memory, or curation — measured, no overclaiming>",
  "grade": "A|B|C|D|F",
  "recommendations": [ {"priority":"P0|P1|P2","type":"code|prompt|knob|source|architecture","target":"<file/env/source>","detail":"<the change>","generalizes":"<how it widens/structures rather than special-cases>","rationale":"<tied to a specific gap + stage>"} ]
}`;
  const resp = await anthropic.messages.create({ model: JUDGE_MODEL, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] });
  const out = extractJson(joinText(resp));
  return {
    gapAnalysis: Array.isArray(out.gapAnalysis) ? out.gapAnalysis : [],
    feedOnlyStories: Array.isArray(out.feedOnlyStories) ? out.feedOnlyStories : [],
    narrative: out.narrative || '',
    grade: out.grade || null,
    recommendations: Array.isArray(out.recommendations) ? out.recommendations : [],
    _model: JUDGE_MODEL,
  };
}

// ----------------------------------------------------------------- orchestration
// Build the reconciled reality worldview from the configured provider(s). 'both'
// runs Gemini (Google grounding) + Opus (web search) in parallel and cross-checks
// them; either alone is also supported. Degrades gracefully if one provider fails.
async function buildReality({ atISO, scope, provider = GT_PROVIDER, gtOpts = {} }) {
  const wantGemini = (provider === 'both' || provider === 'gemini') && !!getGemini();
  const wantOpus = provider === 'both' || provider === 'opus' || !wantGemini; // ensure at least one source
  // The second worldview is an INDEPENDENT web search for cross-checking, not a
  // judgment — so it uses the faster GT_MODEL (Sonnet) by default, which keeps the
  // parallel `both` pass inside Vercel's 120s budget and reserves Opus for judging.
  const searchModel = process.env.INTEL_EVAL_GT_MODEL || GT_MODEL;
  const searchLabel = /opus/i.test(searchModel) ? 'opus' : 'sonnet';
  const tasks = [];
  if (wantGemini) tasks.push(fetchRealityGemini({ atISO, scope, ...gtOpts }).then(r => ({ ok: true, r })).catch(e => ({ ok: false, provider: 'gemini', e })));
  if (wantOpus) tasks.push(fetchRealityWebSearch({ atISO, scope, model: searchModel, provider: searchLabel, ...gtOpts }).then(r => ({ ok: true, r })).catch(e => ({ ok: false, provider: searchLabel, e })));
  const settled = await Promise.all(tasks);
  const lists = settled.filter(s => s.ok).map(s => s.r);
  if (!lists.length) throw new Error('all worldview providers failed: ' + settled.map(s => `${s.provider}:${s.e && s.e.message}`).join('; '));
  return reconcileWorldviews(lists);
}

// Full evaluation: reconciled worldview (Gemini + Opus, cross-checked) → Opus judge
// (gap analysis + structural recs) → deterministic metrics scored against the
// reconciled top-list. `bundle` is the snapshot to grade (what /m shows).
async function scoreSnapshot({ bundle, now = Date.now(), scope = NT.activeScope(), reflectEnabled = true, provider = GT_PROVIDER, gtOpts = {} } = {}) {
  if (!bundle || !Array.isArray(bundle.stories)) throw new Error('scoreSnapshot needs a bundle with stories[]');
  const atISO = new Date(now).toISOString();

  // Cheap path (reflection skipped): a single Gemini-grounded worldview is enough
  // to compute the deterministic metrics.
  const reality = reflectEnabled
    ? await buildReality({ atISO, scope, provider, gtOpts })
    : await buildReality({ atISO, scope, provider: getGemini() ? 'gemini' : 'opus', gtOpts });
  const analysis = reflectEnabled ? await judge({ bundle, reality, atISO, scope }) : null;

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
    models: { worldview: reality.providersUsed, judge: JUDGE_MODEL },
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
    // Full reflection (grade + narrative + recommendations) so /m/eval can show
    // every run's reasoning historically, not just the latest. Null when the
    // reflection pass was skipped (--no-reflect).
    reflection: report.reflection || null,
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
  feedDigest, realityPrompt, fetchRealityWebSearch, fetchRealityGemini, getGemini,
  reconcileWorldviews, judge, buildReality, scoreSnapshot, ARCHITECTURE_BRIEF, GT_PROVIDER,
  // persistence
  loadBundle, saveReport, loadLatest, loadHistory, summarize,
  EVAL_KEY, EVAL_LOG,
};
