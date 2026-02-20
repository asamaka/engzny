# thinx.fun - Agent System

## Project Overview

thinx.fun is a mobile-first screenshot intelligence app powered by Claude AI. Users paste screenshots and get structured, card-based analysis with dynamic layouts.

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
- Monitor deployment status after push
- Handle deployment failures (fix tests, resolve merge conflicts)
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
    orchestrator.js           # v1 GIUE pipeline coordinator
    orchestrator-v2.js        # v2 layout pipeline (screenshot -> layout -> parallel research)
    layout-designer.js        # Vision LLM: analyzes screenshot, designs card layout
    card-researcher.js        # Research LLM: populates individual cards in parallel
  contracts/
    card-types.js             # Card type schemas + layout type definitions
  generators/
    vision-analyzer.js        # Screenshot hotspot detection
    html-generator.js         # HTML generation for GIUE canvas
    canvas-generator.js       # Direct LLM-to-HTML generation
    keypoint-extractor.js     # Structured keypoint extraction
    style-manager.js          # Theme/color extraction
  llm/
    adapter.js                # Base LLM interface
    claude.js                 # Claude adapter (default: claude-opus-4-6)
    gemini.js                 # Gemini adapter (fallback)
    index.js                  # Provider factory

public/
  paste.html                  # Mobile home (clipboard paste)
  hub-v2.html                 # New dynamic layout page (/hub)
  analyze.html                # v1 analysis page
  keypoints.html              # Card-based keypoints view
  index.html                  # Desktop landing page

tests/
  unit/                       # 49 unit tests (mocked)
  integration/                # 3 health checks (real API)
```

## Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Mobile paste page |
| `/hub` | GET | New v2 dynamic layout page |
| `/api/upload` | POST | Upload image, get jobId |
| `/api/job/:id/stream` | GET | SSE stream for v1 analysis |
| `/api/hub/analyze` | POST | v1 hub analysis (tool calls) |
| `/api/hub/v2/analyze` | POST | v2 pipeline SSE (layout + parallel research) |
| `/api/keypoints` | POST | Keypoint extraction |
| `/api/health` | GET | Health check |

## Deployment Pipeline

```
Push to claude/* branch
        |
        v
GitHub Actions: auto-deploy-production.yml
        |
        +--> Merge feature branch -> main
        +--> Install Vercel CLI
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

## v2 Pipeline (New)

The enhanced content layout pipeline:

1. **Screenshot** -> Layout Designer LLM (vision analysis)
   - Identifies content type, intent, top user questions
   - Chooses the best layout (editorial, dashboard, product, social, investigation, simple)
   - Creates placeholder cards with research briefs

2. **Blueprint** -> Client via SSE (cards render as placeholders immediately)

3. **Blueprint** -> Parallel Card Researchers (multiple LLM calls)
   - Each card gets its own researcher
   - Researchers populate cards per the card type contract
   - As each completes -> SSE card event -> card animates in

4. **Complete** -> All cards populated

### Card Types Available
hero_summary, key_metric, info_list, fact_check, person_card, product_card, timeline_card, quote_card, comparison_card, warning_card, action_card, text_extract, location_card
