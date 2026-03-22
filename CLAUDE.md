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
    claude.js                 # Claude adapter (default: claude-opus-4-6)
    gemini.js                 # Gemini adapter (fallback)
    index.js                  # Provider factory
  lib/
    logger.js                 # Production logger (in-memory + Redis persistence)
    live-reports.js           # Auto-generated pipeline reports (1hr TTL, PIN-protected)
    report-store.js           # Test report storage (Redis + memory fallback)
    screenshot-capture.js     # Screenshot capture & thumbnail generation
    vercel-logs.js            # Vercel runtime logs API client
    improvement-trigger.js    # Continuous improvement agent trigger (Cursor API)

public/
  hub-v2.html                 # Main page (served at /)
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
| `/api/tv/briefing/cron` | POST | Staleness-aware trigger — only dispatches if briefing is >70 min old (require `?token=` auth). Called by GitHub Actions cron. |
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
- **Vercel env vars (for persistent logs):** UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
- **Vercel env vars (for continuous improvement):** GITHUB_DISPATCH_TOKEN (fine-grained PAT), IMPROVEMENT_ENABLED (`true` to enable)
- **GitHub Secrets (for continuous improvement):** FIX_IT (Cursor API key — never stored in Vercel)
- **Cursor Cloud Agent secret:** VERCEL_TOKEN (for agents to query Vercel API directly — never store in Vercel env vars)

## TV Briefing Agent (Hourly)

An hourly Cursor Cloud Agent that generates fresh news briefings for a Samsung TV app. The agent researches news, finds YouTube videos, and pushes a complete briefing JSON to the thinx.fun API.

### How it works

```
[Two cron sources + manual — any one is enough]

1. Vercel Cron (primary, every hour) → GET /api/tv/briefing/cron
2. GitHub Actions cron (backup, every hour) → POST /api/tv/briefing/cron
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

Vercel Cron runs on Vercel infrastructure (reliable). GitHub Actions cron is a backup (can skip hours due to scheduler delays).

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
| `CRON_SECRET` | (optional) | Vercel Cron secret — auto-sent as `Authorization: Bearer` header by Vercel |

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
