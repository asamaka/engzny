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
    logger.js                 # Production logger (ring buffer, pipeline traces, client telemetry)

public/
  hub-v2.html                 # Main page (served at /)
  keypoints.html              # Keypoint card navigation view
  canvas.html                 # GIUE canvas view

tests/
  unit/                       # 73 unit tests (mocked)
  integration/                # 3 health checks (real API)
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

### Debug & Monitoring (require `?token=` auth)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/debug/dashboard` | GET | **At-a-glance production status** — use this first |
| `/api/debug/logs` | GET | Raw structured logs (filterable by level, category) |
| `/api/debug/logs?summary=true` | GET | Full summary with pipeline stats |
| `/api/debug/pipelines` | GET | Pipeline traces with phase timing |
| `/api/debug/client-error` | POST | Client error reports (open, no auth) |
| `/api/debug/client-report` | POST | Client session telemetry (open, no auth) |

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
npm test              # All 73 tests (must pass before deploy)
npm run test:unit     # Unit tests only (fast, mocked)
npm run test:health   # Integration health checks (real API)
```

Tests MUST pass before any deployment. Run `npx jest --forceExit` if tests hang.

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
- **Vercel env vars:** ANTHROPIC_API_KEY, DEBUG_TOKEN (optional, defaults to `thinx-debug-2026`)

## Runtime Monitoring & Logs

**This is about RUNTIME behavior (what users experience), not deployment CI.**

### Quick check: Dashboard

```bash
curl 'https://www.thinx.fun/api/debug/dashboard?token=thinx-debug-2026'
```

Shows at a glance:
- **Server health:** HEALTHY / DEGRADED / WARNINGS
- **Counters:** total requests, pipelines, errors, SSE disconnects
- **Recent pipelines:** each with status, duration, design time, card count, errors
- **Client sessions:** what users actually saw — upload time, first event delay, events received, retries, outcome (success/error), device type
- **Recent HTTP requests:** method, path, status code, duration
- **Client errors:** exact error messages users saw

### Detailed queries

```bash
# All recent errors
curl 'https://www.thinx.fun/api/debug/logs?level=error&limit=20&token=thinx-debug-2026'

# Pipeline traces with full phase timing
curl 'https://www.thinx.fun/api/debug/pipelines?token=thinx-debug-2026'

# Full log summary (everything)
curl 'https://www.thinx.fun/api/debug/logs?summary=true&token=thinx-debug-2026'
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

Logs are stored in an **in-memory ring buffer** within the Vercel serverless function. They persist across requests in a warm container but reset on cold starts. This is fine for debugging recent issues — the failure and its context will be in the same container.

- Max entries: 1000 logs, 200 errors, 200 HTTP requests, 100 client sessions, 50 pipeline traces
- Logs also go to stdout (visible in Vercel's built-in log viewer)

### Security

All `/api/debug/*` read endpoints require authentication via `?token=` query param or `X-Debug-Token` header. Write endpoints (client error/report) are open since they only accept data from the frontend.

The default token is `thinx-debug-2026`. Override it by setting the `DEBUG_TOKEN` environment variable on Vercel.
