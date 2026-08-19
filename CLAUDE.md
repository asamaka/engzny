# thinx.fun - Agent System

## Project Overview

thinx.fun is a mobile-first screenshot intelligence app powered by Claude AI. Users paste screenshots and get structured, card-based analysis with dynamic layouts chosen by the LLM.

**Stack:** Node.js + Express + Vercel + Claude API
**Production:** https://www.thinx.fun/ (canonical, `thinx.fun` redirects here)
**Repo:** https://github.com/asamaka/engzny

## Agent Roles

This project uses specialized agents with clear responsibilities. Each agent has a single concern and should not step outside its scope.

### 1. Deployment Agent (REQUIRED for any production changes)

**Spec:** `.claude/agents/deployment.md`
**Scope:** The SOLE agent authorized to push to production. No other agent should push, merge to main, or trigger deployments.

**Responsibilities:**
- Run tests before any push (`npm test` must pass)
- Merge to `main` and push (triggers Vercel Git integration deploy)
- Alternatively push to `claude/*` branches (triggers auto-deploy via GitHub Actions)
- Monitor deployment status after push (check GitHub Actions)
- **Verify production works end-to-end** (not just health check — check runtime logs)
- Roll back if deployment verification fails

**When to use:** Any time changes need to go live.

### 2. Feature Development Agent

**Spec:** `.claude/agents/feature-development.md`
**Scope:** Implements new features, bug fixes, and refactoring. Does NOT deploy.

**Responsibilities:**
- Understand the codebase architecture before making changes
- Write clean, minimal code (no over-engineering)
- Ensure new code integrates with existing patterns
- Run tests locally to verify nothing breaks
- Hand off to Deployment Agent for production push

**When to use:** Building features, fixing bugs, refactoring code.

### 3. Research Agent

**Spec:** `.claude/agents/research.md`
**Scope:** Investigates issues, explores the codebase, analyzes logs, debugs failures.

**Responsibilities:**
- Read and understand code without modifying it
- Analyze GitHub Actions logs for deployment failures
- **Check runtime logs** via the debug dashboard (not just deployment CI)
- Debug runtime errors from Vercel logs
- Research external APIs and documentation
- Provide recommendations to other agents

**When to use:** Debugging failures, understanding existing behavior, investigating issues.

### 4. Continuous Improvement Agent (auto-spawned)

**Spec:** `.claude/agents/continuous-improvement.md`
**Scope:** Autonomous agent spawned by the Cursor Cloud Agent API when pipeline reports meet trigger criteria. **Must always ship code — analysis without implementation is a failure.**

**Responsibilities:**
- Quickly assess the trigger (error, slow pipeline, periodic review)
- Prioritize by customer value (P0 broken > P1 degraded > P2 polish > P3 resilience)
- **Implement the highest-ROI fix** — not just analyze it
- Run tests and push to `cursor/improvement-*` branches (auto-deploys)
- Spend at most 20% of time reading, 80% implementing

**When to use:** Spawned automatically — not manually invoked. Can also be triggered manually via `POST /api/debug/improvement/trigger`.

## Architecture

```
api/
  index.js                    # Express server, all API routes
  agents/
    orchestrator-v2.js        # Pipeline coordinator (screenshot -> layout -> parallel research)
    layout-designer.js        # Vision LLM: analyzes screenshot, designs card layout
    card-researcher.js        # Research LLM: populates individual cards in parallel
  contracts/
    card-types.js             # Card type schemas + layout type definitions
  generators/
    vision-analyzer.js        # Screenshot hotspot detection (GIUE canvas)
    html-generator.js         # HTML generation (GIUE canvas)
    canvas-generator.js       # Direct LLM-to-HTML generation (GIUE canvas)
    keypoint-extractor.js     # Structured keypoint extraction
    style-manager.js          # Theme/color extraction
  llm/
    adapter.js                # Base LLM interface
    claude.js                 # Claude adapter (default: claude-opus-4-6, supports web_search tool)
    gemini.js                 # Gemini adapter (fallback)
    perplexity.js             # Perplexity Sonar adapter (web-grounded research, optional)
    index.js                  # Provider factory
  lib/
    logger.js                 # Production logger (in-memory + Redis persistence)
    live-reports.js           # Auto-generated pipeline reports (1hr TTL, PIN-protected)
    report-store.js           # Test report storage (Redis + memory fallback)
    screenshot-capture.js     # Screenshot capture & thumbnail generation
    vercel-logs.js            # Vercel runtime logs API client
    improvement-trigger.js    # Continuous improvement agent trigger (Cursor API)
    war-sources.js            # Intel feed data fetchers (RSS, Polymarket, videos, images)
    news-topics.js            # Structured scope/fronts → relevance prompts + regex (no hard-coded keywords)
    intel-eval.js             # Snapshot-vs-reality accuracy harness (coverage/freshness/staleness/markets)

public/
  hub-v2.html                 # Main page (served at /)
  skytower/index.html         # Sky Tower defense game (isolated mini-app, served at /skytower)
  keypoints.html              # Keypoint card navigation view
  canvas.html                 # GIUE canvas view
  styles/
    input.css                 # Tailwind CSS source (imports tailwindcss + daisyui)
    output.css                # Pre-built CSS (committed, rebuild with `npm run build:css`)

tests/
  unit/                       # Unit tests (mocked)
  integration/                # Health checks (real API)
```

## Key Endpoints

### User-Facing
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Main page - dynamic layout hub |
| `/api/hub/v2/start` | POST | Upload image, get requestId (step 1 of pipeline) |
| `/api/hub/v2/stream/:requestId` | GET | SSE stream for card population (step 2 of pipeline) |
| `/api/hub/v2/analyze` | POST | Legacy single-request SSE (kept for backward compat) |
| `/api/health` | GET | Health check |
| `/r` | GET | Live reports index (4-digit PIN gate) |
| `/r/:requestId` | GET | Individual pipeline report (4-digit PIN gate) |

### Live Reports API (4-digit PIN via cookie)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/r/auth` | POST | Verify PIN `{"pin":"0427"}`, sets cookie |
| `/api/r/list` | GET | List live reports (1hr TTL, summary only) |
| `/api/r/search` | GET | Search archived reports (30-day TTL). Params: `q`, `contentType`, `layoutType`, `outcome`, `cardType`, `from`, `to`, `limit`, `offset` |
| `/api/r/:requestId/data` | GET | Full report data (live + archive fallback) |
| `/api/r/:requestId/thumb` | GET | Screenshot thumbnail JPEG (live + archive fallback) |

### TV Briefing API
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tv/briefing` | GET | Read current briefing (public, CORS enabled). Records "last viewed" timestamp for merge tracking. |
| `/api/tv/briefing` | POST | Write new briefing (auth: `Bearer <TV_BRIEFING_TOKEN>`). Archives the previous briefing to history before replacing. |
| `/api/tv/briefing/trigger` | POST | Force-trigger the briefing agent (require `?token=` auth). Body: `{"source":"manual","force":true}` |
| `/api/tv/briefing/cron` | POST | Staleness-aware trigger — only dispatches if briefing is >70 min old (require `?token=` auth). Called by GitHub Actions every 15 min. |
| `/api/tv/briefing/context` | GET | Briefing merge context for the agent — unseen stories, view history, story tracker (require `?token=` auth) |
| `/api/tv/briefing/status` | GET | Trigger status, history, and last viewed timestamp (require `?token=` auth) |
| `/api/tv/health` | GET | Read TV app health entries from Redis |
| `/api/tv/health` | POST | Receive TV diagnostics from the Samsung app |

### Debug & Monitoring (require `?token=` auth)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/debug/dashboard` | GET | **At-a-glance production status** — use this first (reads from Redis when available) |
| `/api/debug/logs` | GET | Raw structured logs (filterable by level, category) |
| `/api/debug/logs?summary=true` | GET | Full summary with pipeline stats (persistent) |
| `/api/debug/pipelines` | GET | Pipeline traces with phase timing (persistent) |
| `/api/debug/activity` | GET | Usage activity log — page views, uploads, pipeline events (persistent) |
| `/api/debug/sessions` | GET | Client session reports (persistent) |
| `/api/debug/env` | GET | Diagnostic: which integrations are configured |
| `/api/debug/client-error` | POST | Client error reports (open, no auth) |
| `/api/debug/client-report` | POST | Client session telemetry (open, no auth) |
| `/api/debug/improvement` | GET | Continuous improvement trigger status, history & skipped report count |
| `/api/debug/improvement/trigger` | POST | Manually trigger an improvement agent. Body: `{"focus":"area to improve","force":true}` |
| `/api/debug/improvement/healthcheck` | POST | Pick up rate-limited reports and dispatch improvement agent if any are queued |

## Pipeline Flow

The analysis pipeline uses a two-step architecture for mobile compatibility:

```
User pastes screenshot
    |
    v
[POST /api/hub/v2/start] — Upload image, get requestId (fast JSON response)
    |
    v
[GET /api/hub/v2/stream/:requestId] — EventSource SSE stream
    |
    v
[Skeleton Blueprint] — Instant placeholder cards (<1ms, no LLM)
    |
    v
[Layout Designer LLM] — Claude Sonnet vision (15-20s)
    |                     - Content type, intent, top questions
    |                     - Card layout selection
    |                     - Progress heartbeat every 3s
    v
[SSE: layout_update] — Client replaces skeleton with real cards
    |
    v
[Card Researcher LLMs] — Run in PARALLEL (one per card, 3-7s each)
    |   |   |   |
    v   v   v   v
[SSE: card events] — Each card animates in as it completes
    |
    v
[SSE: complete] — All cards populated
```

### Card Types
hero_summary, key_metric, info_list, fact_check, person_card, product_card, timeline_card, quote_card, comparison_card, warning_card, action_card, text_extract, location_card

### Layout Types
editorial, dashboard, product_showcase, social_feed, investigation, simple

## Testing

```bash
npm test              # All tests (must pass before deploy)
npm run test:unit     # Unit tests only (fast, mocked)
npm run test:health   # Integration health checks (real API)
npm run build:css     # Rebuild Tailwind CSS (after changing HTML classes)
```

Tests MUST pass before any deployment. Run `npx jest --forceExit` if tests hang.

The `frontend-performance.test.js` suite enforces performance budgets (no browser JIT, CSS size limits, no render-blocking scripts). If you add new Tailwind classes, run `npm run build:css` to regenerate `public/styles/output.css`.

## Deployment

### How to deploy

```bash
# 1. Run tests
npm test

# 2. Merge to main and push (triggers Vercel Git integration)
git checkout main
git pull origin main
git merge <your-branch>
git push origin main

# 3. Verify (wait ~60s for Vercel)
curl https://www.thinx.fun/api/health
```

Alternatively, push to a `claude/*` branch to trigger the auto-deploy GitHub Action (merges to main automatically).

### Required secrets
- **GitHub:** VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, CLAUDE_API_KEY
- **Vercel env vars:** ANTHROPIC_API_KEY, DEBUG_TOKEN (optional, defaults to `thinx-debug-2026`), REPORT_PIN (optional, defaults to `0427`)
- **Vercel env vars (optional, for web research):** PERPLEXITY_API_KEY (enables Sonar web-grounded research on fact_check, timeline, person, product, comparison, location cards)
- **Vercel env vars (for persistent logs):** UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
- **Vercel env vars (for continuous improvement):** GITHUB_DISPATCH_TOKEN (fine-grained PAT), IMPROVEMENT_ENABLED (`true` to enable)
- **GitHub Secrets (for continuous improvement):** FIX_IT (Cursor API key — never stored in Vercel)
- **Cursor Cloud Agent secret:** VERCEL_TOKEN (for agents to query Vercel API directly — never store in Vercel env vars)

## TV Briefing Agent (Hourly)

An hourly Cursor Cloud Agent that generates fresh news briefings for a Samsung TV app. The agent researches news, finds YouTube videos, and pushes a complete briefing JSON to the thinx.fun API.

### How it works

```
[Two cron sources + manual — any one is enough]

1. improvement-healthcheck.yml (every 15 min) → POST /api/tv/briefing/cron
2. tv-briefing-cron.yml (every hour, backup) → POST /api/tv/briefing/cron
3. Manual POST /api/tv/briefing/trigger
    │
    ├─ Staleness check (briefing agentRunAt > 70 min old)
    ├─ Rate limit check (30 min between triggers)
    ├─ Build briefing context (unseen stories, view history)
    │
    v
GitHub workflow_dispatch → tv-briefing-agent.yml
    │
    v
Cursor Cloud Agent (reads SKILL.md, researches news, builds JSON)
    │
    v
POST /api/tv/briefing → Redis (tv:briefing)
    │
    v
Samsung TV app polls GET /api/tv/briefing (every 5 min)
```

The `/cron` endpoint checks staleness before dispatching — it's safe to call frequently. The 15-min healthcheck provides the primary trigger; the hourly cron is a backup.

### Merge logic — never lose unseen stories

The system tracks when the user last viewed the briefing. Each time the agent runs:
1. Fetches `/api/tv/briefing/context` which includes `unseenStories` (from briefings generated after the user last viewed)
2. Carries forward unseen newsworthy stories into the new briefing
3. New stories get top positions, carried-forward stories fill the middle
4. Stories in `watchLog` (already watched) are demoted or dropped

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TV_BRIEFING_ENABLED` | `true` (when GITHUB_DISPATCH_TOKEN exists) | Set to `false` to disable |
| `TV_BRIEFING_MIN_INTERVAL` | `1800` (30 min) | Minimum seconds between triggers |
| `TV_BRIEFING_STALE_THRESHOLD` | `4200000` (70 min, in ms) | Briefing age before cron triggers a refresh |
| `TV_BRIEFING_TOKEN` | (required) | Bearer token for writing briefings |

### Manual trigger

```bash
curl -X POST 'https://www.thinx.fun/api/tv/briefing/trigger?token=thinx-debug-2026' \
  -H 'Content-Type: application/json' \
  -d '{"source":"manual","focus":"fresh evening briefing"}'
```

### View status

```bash
curl 'https://www.thinx.fun/api/tv/briefing/status?token=thinx-debug-2026'
```

### View merge context (what the agent sees)

```bash
curl 'https://www.thinx.fun/api/tv/briefing/context?token=thinx-debug-2026'
```

## Cinematic Intel Feed ("Iran Watch") + Accuracy Eval

A scheduled GitHub Action (`intel-cron.yml`, hourly) runs `scripts/build-intel.js`, which fetches RSS headlines + Polymarket spikes + videos, curates them (Sonnet proposer → Opus editor), and writes a finished bundle to Redis (`tv:war:intel:v1`). The TV reads it read-only via `GET /api/tv/intel`; the phone mirror is `/m` (`GET /api/tv/intel/public`, no token). A persistent "iceberg" of tracked stories lives in `tv:war:segments:v1` (`GET /api/tv/segments`).

The phone keeps an **open market detail live independent of the cron** via `GET /api/tv/intel/market/:id/live` (no token, CORS-open, 120s per-market Redis cache): it re-fetches that one market's price + 7-day history straight from Polymarket and returns `{prob, probColor, delta, deltaColor, history, spark}`. `/m` polls it on open and every ~10 min while a market detail is open (only the open market, not the whole rail, to keep Polymarket load minimal). The mini rail trend line and the detail chart both derive from `history` (same orientation), so they always agree with the real trend.

### Pipeline run viewer (`/m/debug`)
Every `build-intel` run records a structured, human-readable **trace** of the whole flow and persists it to Redis (`tv:war:intel:run:<id>` full trace, `tv:war:intel:runs` newest-first summary list, 7-day TTL, capped at `INTEL_TRACE_KEEP`=50). The page at **`/m/debug`** lists each cron run (latest first) and drills into the sequence step by step — inputs (RSS / Polymarket spikes / videos), the novelty gate, and every model call's **prompt IN + parsed response OUT** (Sonnet propose → Opus decide → per-segment newsroom rewrite, layout, Haiku image query), plus the per-segment timeline gate and video-selection candidates. Compact summaries expand on click. Data API: `GET /api/tv/intel/runs` and `GET /api/tv/intel/runs/:id` (auth: war token **or** debug token `thinx-debug-2026`; the page accepts `?token=` and remembers it). Tracing is best-effort and never breaks a build.

### Triggering the intel builder manually (for agents)
The builder normally runs on its hourly schedule. To force a run now — **the order an agent should try paths, with what works:**

1. **Direct dispatch with a PAT (the reliable path).** `api.github.com` is reachable from the agent sandbox, so a fine-grained PAT (repo `asamaka/engzny`, **Actions: Read and write**) can dispatch it:
   ```bash
   GH_DISPATCH_PAT=github_pat_xxx ./scripts/trigger-intel-build.sh force   # 'force' bypasses the reuse gate
   ```
   The token comes from `GH_DISPATCH_PAT` (or `GITHUB_TOKEN`) in the env — never commit it. Create one at github.com/settings/tokens?type=beta.
2. **GitHub UI:** Actions → "Cinematic Intel Builder" → Run workflow (optionally set `force=true`).
3. ❌ **The GitHub MCP integration cannot do this** — it lacks `actions: write` and returns `403 "Resource not accessible by integration"`. Don't burn time retrying it.
4. ⚠️ **Vercel endpoint** `POST /api/tv/intel/build/trigger?token=<debug|war>` body `{"force":true}` works *only if* `GITHUB_DISPATCH_TOKEN` (Vercel env, shared with the eval/improvement path) is valid — it has been seen expired (`401 Bad credentials`).

Verify a run landed by polling `GET /api/tv/intel/public` for a newer `generatedAt`; new-pipeline builds carry `meta.corroboration` on each story.

### Scope is data, not code
`api/lib/news-topics.js` defines the active **scope** (default `mideast-conflict`) as a set of **fronts** (Iran core, Lebanon/Hezbollah, Israel/Gaza, Gulf/Hormuz, nuclear/diplomacy, energy). The relevance filter prompt, the regex fallback, and the market-selection prompt are all **generated** from this config — there is no hard-coded "IRAN WAR" keyword list anymore. Override the active scope with `INTEL_SCOPE` (no code change). Sources in `api/lib/war-sources.js` are tiered (tier 1 = fast wires/Google-News queries, tier 2 = major outlets, tier 3 = regional/state) and tagged with the fronts they cover.

### Freshness fixes (why the wall no longer "freezes")
- A **breaking-fresh** headline (`INTEL_BREAKING_MIN`, default 45 min) bypasses the novelty gate's 75% token-dedup, so a new strike on a running story forces a rebuild instead of being swallowed as a near-duplicate.
- The editor **re-titles** a reused segment to lead with the newest development (continuity of *id*, freshness of *headline*).
- The displayed **freshness label is honest**: a long-running story with a recent source shows "updated <recent>" (`INTEL_FRESH_LABEL_MIN`, default 360 min) instead of "first reported 2 days ago".
- **Event age vs source age — the displayed age is the latest REAL development, not the newest article.** The newsroom rewrite (which reads full bodies + web search) outputs `latestDevelopmentHoursAgo` — how long ago the most recent *actual* development happened, NOT when an article was published. So a Friday strike that's only being recapped today reads as the ~3-day-old story it is (badge shows the event age, with a secondary "· updated 35m ago" note), and the **home/detail order leads with the freshest real development** (content-dated `meta.latestDevelopmentAt`, coarse tiers <12h/<36h/<3d/older, Opus's importance as the in-tier tiebreak) — so a days-old strike drops below something that genuinely broke in the last hours, while a story with a new strike today stays up.
- **First-reported can't be back-dated by a stale grouped-in article.** `firstSeenSourceAt` is clamped to a grace window before the segment was first tracked (`INTEL_FIRST_REPORT_BACKDATE_DAYS`, default 3); this both heals records already poisoned by a months-old explainer and refuses new ones (the bug where a fresh Hebron story read "first reported 3mo ago").

### Full-text grounding + corroboration (don't launder a single source's spin)
The triage stages (Sonnet propose → Opus decide) work from **headline strings**, which is enough to GROUP and SELECT stories but *not* to write an accurate headline/summary — feeding the LLM only a 200-char RSS snippet is how a single state-media headline ("'humiliated' enemy…") got laundered into neutral "fact". So for each **selected** story, `build-intel.newsroomRewrite`:
1. Fetches the chosen sources' **full article bodies** (`war-sources.extractArticleText`: regex `<p>`-extraction, Redis-cached, graceful null on a blocked/slow publisher → falls back to the RSS snippet).
2. Runs **one rewrite pass with live `web_search`** that regenerates the headline / brief / `aiSummary` / timeline under strict **attribution rules**: a fact confirmed by 2+ independent blocs may be stated plainly; a claim in only one source (esp. state media) **must be attributed in the prose**, never asserted as neutral fact; lead with the newest development; don't dress up a routine/anniversary statement as breaking.
3. Emits `meta.corroboration` (`high | mixed | single-source`).

Fetches/searches scale with **what's actually shown** (the rewrite runs only on the curation path — the reuse gate skips it entirely), not the whole headline pool. Tune with `INTEL_ARTICLE_CHARS`, `INTEL_WEBSEARCH_MAX` (0 = bodies-only), `INTEL_NEWSROOM` (model); disable with `INTEL_NEWSROOM_OFF=1`.

### Videos must COVER the story, not just be "relevant by nature"
Everything on this wall is regionally relevant, so a plain keyword-overlap match (the old gate accepted any shared word) attached generic Iran/Israel/war footage to unrelated segments (a Lebanon humanitarian clip landed on the Iran-inflation story; the IAEA-blackout story carried only drone/radar clips). Two structural changes (`scripts/build-intel.js`, `war-sources.searchVideos`):
1. **Targeted sourcing.** Beyond the 8 vetted broadcaster YouTube channels (`fetchWarVideos`), the builder runs a **keyless YouTube search for each segment's own headline** (`searchVideos` parses the results page's `ytInitialData`, drops hashtag-spam shorts, graceful `[]` on any failure). That's how a segment gets a clip that covers its *exact* story (Reuters "Iran fired seven ballistic missiles toward Kuwait, Bahrain"; CNN "Lebanon president's message to Iran") instead of generic regional footage.
2. **A "covers-the-story" gate (deterministic, unit-tested).** A clip must share enough **distinctive** tokens with the segment — tokens that are NOT part of the scope's own "everything here is about this" vocabulary (the umbrella actor + universal actors/regions + editorial/attribution/war-action verbs, all **derived from `news-topics.js`**, so front-specific subjects like *iaea, hormuz, hezbollah, aoun* still identify a specific story). Bar is `INTEL_VIDEO_MIN_MATCH` (default 2). If nothing clears it, the on-topic **search hits** (about this headline by construction) fill in at ≥1 distinctive token; a pool clip covering *nothing* is never forced on.
3. **Quality finetuning once coverage is met.** Opening the pool to web search also lets in a long tail of sensational aggregators ("Times Now", "WION", "CRUX/CNN-News18"), foreign-language desks, and individuals, in lengths from vertical Shorts to multi-hour livestream replays. So the search **drops** live/upcoming streams, Shorts, and clips outside a duration window (`INTEL_VIDEO_MIN_SEC`–`INTEL_VIDEO_MAX_SEC`, default 45s–25min), and selection ranks by **source reputation tier** (`channelTier`: 1 = wires/flagship broadcasters, 2 = solid secondary, 3 = aggregator/unknown) → coverage strength → duration fit → freshness. A clip that covers the story from Reuters beats an equal one from a random uploader.

**Source label must match the publisher.** The broadcaster pool (`fetchWarVideos`) previously tagged every clip from a stale `channel_id → name` map whose ids were largely WRONG (the "France 24" id was actually Al Jazeera; "DW News" was BBC; two 404'd), so the displayed source was a lie. The label is now taken from the **feed's own title** at fetch time (and from the result's `ownerText` for search clips), so the tag always matches the real channel; the ids were also corrected/verified.

### Videos must be FRESHER than the event + reviewed by the LLM (the recurring-event fix)
A title match alone is not enough: events recur (Iran has struck the same airport more than once over a year), so a 2-day-old clip of an *earlier* strike will keyword-match a *new* strike and look recent. Three structural layers now prevent this (`scripts/build-intel.js`, `war-sources.searchVideos`, all pure pieces unit-tested):
1. **Freshness floor (deterministic, HARD rule).** Every candidate clip must (a) carry a **known publish date** — so the TV can always render a timestamp on the thumbnail — and (b) be published **at/after the segment's first-reported time** minus a small grace window (`INTEL_VIDEO_EVENT_GRACE_H`, default 4h; keep it small). A clip that predates the event cannot be about it. **Better empty than irrelevant:** the floor and the covers bar are never relaxed to fill slots — a segment with no fresh, on-event clip shows **no video at all** rather than a loosely-related or older one. There is no weak-bar fallback. `searchVideos` now **drops undated clips** (previously an unparseable relative-age slipped a stale clip through with `publishedAt:null`) and accepts a `notBefore` floor; the floor is applied to the broadcaster pool too.
2. **More specific search query.** `videoQueryFor` now searches the **full headline + the story's distinctive subject tokens** (from the brief/summary), not a 2-3 word phrase that returns the popular/older clip for a recurring event.
3. **Tighter "covers" gate.** The scope-generic vocabulary now also excludes the **pervasive political/diplomatic words** on this wall (trump, netanyahu, deal, talks, ceasefire, pause, truce, sign…) — so a generic "Trump says Iran deal could be signed" clip no longer "covers" an Apache-crash or oil-price segment. Front-specific subjects (hormuz, hezbollah, iaea, kuwait, apache) stay distinctive.
4. **Batched Opus curation pass (`curateVideosTimelines`).** After every segment has gathered its fresh candidate pool, **one Opus call reviews all segments at once** and makes the final call: keep only clips that cover THIS exact development (rejecting earlier-instance clips by age + specificity), **never spray one generic clip across segments** (hard cap: a clip may appear on at most 2 segments), **request up to 2 more searches per thin segment** (run once, re-picked), and **rewrite or drop each timeline** (re-run through `sanitizeTimeline` so the exact-time guarantee holds). It can override everything; the deterministic pick is the fallback if the call fails. Disable with `INTEL_VIDEO_CURATE_OFF=1`; skip the second search round with `INTEL_VIDEO_CURATE_ROUNDS=0`. Layout modules are reconciled afterward (`reconcileLayoutModules`) so a segment that lost all videos/timeline doesn't render an empty module.

### Timelines: only a genuine, EXACTLY-timestamped sequence
Not every story is a sequence of events, and a timeline is meaningless without real times — yet the newsroom rewrite used to fabricate one for every story with vague buckets ("Fri evening", "Sat AM"). `sanitizeTimeline` (deterministic, unit-tested) now runs on the final `seg.timeline`: it keeps only entries stamped with a **concrete** time (a clock time `Fri 22:00`, or a specific date `Jun 4` / `Jun 13 2025`), drops vague/undatable buckets and restated steps, and if fewer than **2 concretely-timed historical points** survive it drops the timeline entirely (`[]`). The newsroom + editor prompts are aligned to this rule (exact times or `[]`; "most stories do NOT need a timeline"). On a real snapshot this kept the clock-stamped strike chronology and the dated IAEA chronology while dropping four vague ones.

### Accuracy harness — snapshot vs. reality (cross-checked, architecture-aware)
`api/lib/intel-eval.js`:
1. **Builds a reconciled worldview** — independent **top-10 headlines** from two providers in parallel (`INTEL_EVAL_GT_PROVIDER`, default `both`): **Gemini Flash + Google Search grounding** (the "standard search that surfaces major stories well", cheap/fast) and **Opus + web search**. They're reconciled: a story surfaced by **both** is `confidence:high`; by only one is `confidence:low` (a possible miss OR a single-source rumor — the judge weighs it gently and never asserts shaky claims). Each headline carries content summary + importance + first-report + sources + a photo suggestion.
2. **Reads the live feed** exactly as `/m` shows it (set `INTEL_EVAL_FEED_URL` to read the public endpoint; else Redis/file).
3. **Gap analysis across the full spectrum** — for each real story: `missing` → `covered_reword` (title should change to encapsulate/split, with a suggested title) → `covered_shallow` (thin content/photo) → `over_broad`/`merged` → `covered_well`; plus reverse "feed-only" stories (stale/over-covered/off-scope). It is told **not to jump to conclusions** (single-sourced claims like a death are marked uncertain).
4. **Root-cause + structural fixes** — each gap is attributed to a **pipeline stage** (ingestion → relevance filter → dedup → novelty gate → memory → curation → images/markets) via an `ARCHITECTURE_BRIEF` handed to the judge, and recommendations must be **structural** (a front in `news-topics.js`, a source/tier, a gate knob, a code change, or a **prompt generalization that removes a restriction**) rather than special-case keywords.

3. **Gap analysis** — Opus judges (no web search; it reasons over the reconciled reality + feed) classifying each story `missing` → `covered_reword` → `covered_shallow` → `over_broad`/`merged` → `covered_well`, plus reverse feed-only issues, each attributed to a **pipeline stage** via the `ARCHITECTURE_BRIEF`, with **structural** recommendations (front in `news-topics.js`, source/tier, gate knob, code change, or a prompt generalization) over special-casing.

A deterministic backbone (pure, unit-tested) scores **coverage/recall** (importance-weighted, vs the reconciled top-10), **freshness** (median displayed age + label honesty), **staleness** (`INTEL_EVAL_STALE_H`, default 24h), and **market alignment**, rolled into a **composite 0–100**.

Reports persist to `tv:war:eval:v1` (latest) + `tv:war:eval:log` (history trend line); each CI run also uploads the full report as the `intel-eval-report` artifact (`intel-eval.json`). The eval endpoints accept the **war token OR the debug token** (`thinx-debug-2026`) so the loop is self-serve. Run it:

```bash
# Dispatch the full CI eval (no serverless timeout; persists + uploads artifact):
curl -X POST 'https://www.thinx.fun/api/tv/intel/eval/trigger?token=thinx-debug-2026' -H 'Content-Type: application/json' -d '{}'

# OR run inline against the live bundle now (costs tokens + ~30-60s):
curl -X POST 'https://www.thinx.fun/api/tv/intel/eval?token=thinx-debug-2026' -H 'Content-Type: application/json' -d '{}'

# Read the latest report + score history:
curl 'https://www.thinx.fun/api/tv/intel/eval?token=thinx-debug-2026&history=30'

# Locally / in CI (writes intel-eval.json + Redis):
node scripts/eval-intel.js            # add --no-reflect to skip the Opus pass
```

Scheduled via `.github/workflows/intel-eval-cron.yml` (every 3h, offset from the build), `workflow_dispatch`, and the `/eval/trigger` endpoint above (dispatches that workflow via `GITHUB_DISPATCH_TOKEN`).

### Intel config knobs

| Variable | Default | Description |
|----------|---------|-------------|
| `INTEL_SCOPE` | `mideast-conflict` | Active scope id in `news-topics.js` |
| `INTEL_BREAKING_MIN` | `45` | Headline age (min) that bypasses dedup and forces a rebuild |
| `INTEL_FRESH_LABEL_MIN` | `360` | Newest-source age (min) under which a story shows "updated" not "first reported" |
| `INTEL_MAX_REUSE_MS` | `1500000` | Hard cap (25 min) before the editorial is refreshed regardless |
| `INTEL_NEWSROOM` | (Sonnet) | Model for the full-text + web-search rewrite pass |
| `INTEL_NEWSROOM_OFF` | (unset) | Set to `1` to skip the newsroom rewrite (triage drafts only — no body fetch / web search) |
| `INTEL_ARTICLE_CHARS` | `3000` | Per-source article-body length fed to the rewrite |
| `INTEL_ARTICLE_TTL` | `259200` | Seconds to cache a fetched article body in Redis (3 days) |
| `INTEL_ARTICLE_TIMEOUT_MS` | `8000` | Per-article fetch timeout |
| `INTEL_WEBSEARCH_MAX` | `3` | `web_search` uses per story in the rewrite (`0` disables search, bodies-only) |
| `INTEL_VIDEO_MIN_MATCH` | `2` | Min distinctive (non-scope-generic) tokens a clip must share to "cover" a segment |
| `INTEL_VIDEO_SEARCH_OFF` | (unset) | Set to `1` to skip the per-segment targeted YouTube search (broadcaster pool only) |
| `INTEL_VIDEO_SEARCH_AGE_DAYS` | `45` | Drop targeted-search clips older than this |
| `INTEL_VIDEO_EVENT_GRACE_H` | `4` | Grace (hours) before a segment's first-reported time; clips published earlier than `firstReported − grace` are dropped (recurring-event fix) |
| `INTEL_VIDEO_CURATE_OFF` | (unset) | Set to `1` to skip the batched Opus video+timeline curation pass (use deterministic picks only) |
| `INTEL_VIDEO_CURATE_ROUNDS` | (unset) | Set to `0` to skip the second curation round (no LLM-requested follow-up searches) |
| `INTEL_VIDEO_SEARCH_TIMEOUT_MS` | `8000` | Per-segment video-search fetch timeout |
| `INTEL_VIDEO_MIN_SEC` / `INTEL_VIDEO_MAX_SEC` | `45` / `1500` | Duration window for search clips (drops Shorts/teasers and 25min+ bulletins/replays) |
| `INTEL_EVAL_STALE_H` | `24` | Hours after which a story counts as stale in the eval |
| `INTEL_EVAL_FEED_URL` | (unset) | If set, the eval reads the feed from this URL (e.g. the `/m` public endpoint) instead of Redis/file |
| `INTEL_EVAL_MATCH` | `0.34` | Token-overlap threshold to call a real event "covered" |
| `INTEL_EVAL_GT_PROVIDER` | `both` | Worldview source: `both` (Gemini + Opus, cross-checked), `gemini`, or `opus` |
| `INTEL_EVAL_GEMINI` | `gemini-2.5-flash` | Gemini model for the grounded worldview (needs `GEMINI_API_KEY`) |
| `INTEL_EVAL_GT_MODEL` / `INTEL_EVAL_JUDGE_MODEL` | Sonnet / Opus | Cheap-path worldview model / the gap-analysis judge model |

## Continuous Improvement

The system can automatically spawn Cursor Cloud Agents to review pipeline reports and push code improvements. When enabled, every pipeline completion is evaluated against trigger criteria.

### Security model

The Cursor API key (which can push code to the repo) **never touches the Vercel runtime**. Instead:

```
Vercel runtime (processes untrusted user uploads)
  │
  │  Only has: GITHUB_DISPATCH_TOKEN (fine-grained PAT, actions:write scope)
  │  This token can ONLY trigger workflows — it cannot push code or read secrets.
  │
  ▼
GitHub Actions (trusted CI environment, triggered via workflow_dispatch)
  │
  │  Has: FIX_IT (Cursor API key, from GitHub Secrets, only exposed during workflow runs)
  │
  ▼
Cursor Cloud Agent API → spawns agent → agent pushes to cursor/* → auto-deploy
```

If the Vercel runtime is compromised, the attacker gets a GitHub PAT that can trigger workflows — but cannot directly push code or access the Cursor API key.

### How it works

```
Pipeline completes → saveLiveReport() → evaluateReport()
    │
    ├─ ALL mode: every report triggers (default)
    │   ├─ Error → reason: pipeline_error
    │   ├─ Slow (>25s) → reason: slow_pipeline
    │   ├─ Every Nth → reason: periodic_review
    │   └─ Normal → reason: report_review
    │
    ├─ Rate limit check (15 min between dispatches)
    │   ├─ Allowed → Dispatch to GitHub Actions
    │   └─ Rate limited → Queue in Redis (skipped_reports)
    │
    v
GitHub workflow_dispatch → continuous-improvement.yml workflow
    │
    v
Reads CURSOR_API_KEY from GitHub Secrets → POST api.cursor.com/v0/agents
    │
    v
Agent reads .cursor/improvement-backlog.md → Reviews recent changes →
Investigates code → Makes fix → Updates backlog → Pushes to cursor/*
    │
    v
auto-deploy-production.yml → Tests → Merge to main → Vercel deploy

--- Healthcheck (scheduled, picks up rate-limited reports) ---

improvement-healthcheck.yml (cron: every 15 min)
    │
    v
POST /api/debug/improvement/healthcheck
    │
    ├─ Skipped reports in Redis? → Dispatch improvement workflow (batch)
    └─ No skipped reports? → Exit (no cost)
```

### Persistent backlog

The file `.cursor/improvement-backlog.md` provides continuity between agent runs. Each agent:
1. Reads the backlog at the start of every run
2. Continues incomplete work from previous agents (highest priority)
3. Updates the backlog with completed items and new discoveries
4. Includes the backlog update in its commit

### Configuration

**Vercel env vars** (safe — no code-pushing credentials):

| Variable | Default | Description |
|----------|---------|-------------|
| `IMPROVEMENT_ENABLED` | `false` | Set to `true` to enable auto-triggering |
| `GITHUB_DISPATCH_TOKEN` | (required) | GitHub fine-grained PAT with `contents:write` scope |
| `IMPROVEMENT_MIN_INTERVAL` | `900` | Minimum seconds between triggers (15 min) |
| `IMPROVEMENT_TRIGGER_ON` | `all` | Comma-separated: `error`, `slow`, `periodic`, `all` |
| `IMPROVEMENT_SLOW_THRESHOLD` | `25000` | Pipeline duration (ms) to be considered "slow" |
| `IMPROVEMENT_PERIODIC_EVERY` | `20` | Trigger every Nth successful report |

**GitHub Secrets** (sensitive — only exposed during CI):

| Secret | Description |
|--------|-------------|
| `FIX_IT` | Cursor API key from cursor.com/dashboard → Integrations |

### Setup

1. **Create a GitHub fine-grained PAT** at [github.com/settings/tokens](https://github.com/settings/tokens?type=beta):
   - Repository access: Only `asamaka/engzny`
   - Permissions: Actions → Read and Write (needed for `workflow_dispatch`)
   - This token can only trigger workflows — it cannot push code, read secrets, or modify the repo

2. **Add the PAT to Vercel** as `GITHUB_DISPATCH_TOKEN`

3. **Add Cursor API key to GitHub** as a repository secret named `FIX_IT`:
   - Get it from [cursor.com/dashboard](https://cursor.com/dashboard) → Integrations
   - This key stays in GitHub — the Vercel runtime never sees it

4. **Enable** by setting `IMPROVEMENT_ENABLED=true` in Vercel env vars

### Manual trigger

```bash
# Trigger with a focus area
curl -X POST 'https://www.thinx.fun/api/debug/improvement/trigger?token=thinx-debug-2026' \
  -H 'Content-Type: application/json' \
  -d '{"focus":"optimize card researcher prompts for faster responses"}'

# Force trigger (bypass rate limit)
curl -X POST 'https://www.thinx.fun/api/debug/improvement/trigger?token=thinx-debug-2026' \
  -H 'Content-Type: application/json' \
  -d '{"focus":"review recent errors","force":true}'
```

### View trigger history

```bash
curl 'https://www.thinx.fun/api/debug/improvement?token=thinx-debug-2026'
```

### Manually run healthcheck (pick up rate-limited reports)

```bash
curl -X POST 'https://www.thinx.fun/api/debug/improvement/healthcheck?token=thinx-debug-2026'
```

## Runtime Monitoring & Logs

**This is about RUNTIME behavior (what users experience), not deployment CI.**

### Two-tier logging architecture

1. **In-memory ring buffer** — fast, local to each serverless instance, resets on cold start
2. **Redis persistence** (Upstash) — survives cold starts, shared across all instances

When Redis is configured, the dashboard and all debug endpoints automatically read from the persistent store. Without Redis, everything falls back to in-memory.

### Quick check: Dashboard

```bash
curl 'https://www.thinx.fun/api/debug/dashboard?token=thinx-debug-2026'
```

Shows at a glance:
- **Server health:** HEALTHY / DEGRADED / WARNINGS
- **Counters:** total requests, pipelines, errors, SSE disconnects (persisted across cold starts)
- **Recent pipelines:** each with status, duration, design time, card count, errors
- **Client sessions:** what users actually saw — upload time, first event delay, events received, retries, outcome (success/error), device type
- **Recent HTTP requests:** method, path, status code, duration
- **Client errors:** exact error messages users saw
- **`persistence` field:** shows `redis` (persistent) or `memory-only` (ephemeral)

### Detailed queries

```bash
# All recent errors (persisted)
curl 'https://www.thinx.fun/api/debug/logs?level=error&limit=20&token=thinx-debug-2026'

# Pipeline traces with full phase timing (persisted)
curl 'https://www.thinx.fun/api/debug/pipelines?token=thinx-debug-2026'

# Full log summary (persistent — includes Redis data)
curl 'https://www.thinx.fun/api/debug/logs?summary=true&token=thinx-debug-2026'

# Usage activity log — page views, uploads, pipeline events (persisted)
curl 'https://www.thinx.fun/api/debug/activity?token=thinx-debug-2026'

# Client session reports (persisted)
curl 'https://www.thinx.fun/api/debug/sessions?token=thinx-debug-2026'

# Environment diagnostic (check Redis, Anthropic status)
curl 'https://www.thinx.fun/api/debug/env?token=thinx-debug-2026'
```

### What the logs tell you

**Server-side pipeline trace** (per requestId):
- Skeleton sent (instant)
- Layout design start → complete (with model, token usage, duration)
- Each card research start → complete (with model, duration)
- Overall pipeline duration
- Any errors with stack traces

**Client-side session report** (per requestId, sent by frontend):
- Upload duration (how long the POST took)
- First SSE event delay (time to first streaming event)
- Every SSE event received with timestamp
- Network info (connection type, downlink speed, RTT)
- Screen size, user agent, retry count
- Final outcome: `success` or `error` with message

**Correlated view:** Each pipeline trace includes its matching client report (if any), so you can see both what the server did and what the user saw for the same request.

### Interpreting common issues

| Symptom | Dashboard shows | Root cause |
|---------|----------------|------------|
| User stuck on skeleton cards | Server pipeline completed, client report missing or has 0 events | SSE events not reaching client (proxy buffering, mobile network) |
| "request failed" error | Client error with empty streamEvents | Upload POST failed or returned non-200 |
| Cards show but never populate | Server pipeline has cards, client has blueprint but no card events | SSE connection dropped mid-pipeline |
| Very slow analysis | Pipeline duration > 30s, designTime > 20s | Claude API latency |
| `[object Object]` in cards | Pipeline completed, client shows success | Frontend card rendering bug — check `renderCardContent()` in `hub-v2.html` |

### Log storage

**Tier 1 — In-memory ring buffer** (always active):
- 1000 log entries, 200 errors, 200 HTTP requests, 100 client sessions, 50 pipeline traces
- Fast, local to each serverless instance, resets on cold start
- All entries also go to stdout (visible in Vercel's built-in log viewer)

**Tier 2 — Redis persistence** (when UPSTASH_REDIS_REST_URL is configured):
- 100 pipeline traces, 200 client sessions, 200 errors, 500 HTTP requests, 1000 activity events
- Shared across all serverless instances, survives cold starts
- Counters (total requests, pipelines, errors) are persisted with HINCRBY
- All debug endpoints automatically read from Redis when available

**Tier 3 — Vercel Runtime Logs** (for agents via `VERCEL_TOKEN` Cursor secret):
- Agents can query Vercel's persistent runtime logs using the `vercel-logs.js` module or `gh` CLI
- VERCEL_TOKEN is stored as a Cursor Cloud Agent secret (never in Vercel env vars)
- Useful even without Redis — Vercel captures everything from console.log

### Security

All `/api/debug/*` read endpoints require authentication via `?token=` query param or `X-Debug-Token` header. Write endpoints (client error/report) are open since they only accept data from the frontend.

The default token is `thinx-debug-2026`. Override it by setting the `DEBUG_TOKEN` environment variable on Vercel.
