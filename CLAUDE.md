# thinx.fun - Agent System

## Project Overview

thinx.fun is a mobile-first screenshot intelligence app powered by Claude AI. Users paste screenshots and get structured, card-based analysis with dynamic layouts chosen by the LLM.

**Stack:** Node.js + Express + Vercel + Claude API
**Production:** https://thinx.fun/
**Repo:** https://github.com/asamaka/engzny

## Agent Roles

This project uses specialized agents with clear responsibilities. Each agent has a single concern and should not step outside its scope.

### 1. Deployment Agent (REQUIRED for any production changes)

**Spec:** `.claude/agents/deployment.md`
**Scope:** The SOLE agent authorized to push to production. No other agent should push, merge to main, or trigger deployments.

**Responsibilities:**
- Run tests before any push (`npm test` must pass)
- Push to `claude/*` branches (triggers auto-deploy via GitHub Actions)
- Monitor deployment status after push (check GitHub Actions)
- Handle deployment failures (fix tests, resolve merge conflicts, verify Vercel)
- Verify production health after deployment (`/api/health`)
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

public/
  hub-v2.html                 # Main page (served at /)
  keypoints.html              # Keypoint card navigation view
  canvas.html                 # GIUE canvas view

tests/
  unit/                       # 49 unit tests (mocked)
  integration/                # 3 health checks (real API)
```

## Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Main page - dynamic layout hub |
| `/api/hub/v2/analyze` | POST | Primary analysis SSE (layout + parallel research) |
| `/api/keypoints` | POST | Keypoint extraction |
| `/api/upload` | POST | Upload image, get jobId |
| `/api/job/:id/stream` | GET | SSE stream for raw markdown analysis |
| `/api/health` | GET | Health check |

## Pipeline

```
Screenshot
    |
    v
[Layout Designer LLM] -- Vision analysis
    |                     - Content type, intent, top questions
    |                     - Best layout selection
    |                     - Placeholder card blueprint with research briefs
    v
[SSE: blueprint] -- Client renders placeholder cards immediately
    |
    v
[Card Researcher LLMs] -- Run in PARALLEL (one per card)
    |   |   |   |          - Each follows card type contract
    v   v   v   v          - Populates card with researched data
[SSE: card events] -- Each card animates in as it completes
    |
    v
[Complete] -- All cards populated
```

### Card Types
hero_summary, key_metric, info_list, fact_check, person_card, product_card, timeline_card, quote_card, comparison_card, warning_card, action_card, text_extract, location_card

### Layout Types
editorial, dashboard, product_showcase, social_feed, investigation, simple

## Deployment Pipeline

```
Push to claude/* branch
        |
        v
GitHub Actions: auto-deploy-production.yml
        |
        +--> Merge feature branch -> main
        +--> Configure env vars (ANTHROPIC_API_KEY)
        +--> Build project
        +--> Deploy to Vercel (production)
        +--> Verify health check
        v
Live at https://thinx.fun/
```

**Required secrets (GitHub):** VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, CLAUDE_API_KEY
**Required env vars (Vercel):** ANTHROPIC_API_KEY

## Testing

```bash
npm test              # All 52 tests
npm run test:unit     # Unit tests only (fast, mocked)
npm run test:health   # Integration health checks (real API)
```

Tests MUST pass before any deployment. The Deployment Agent is responsible for this.
