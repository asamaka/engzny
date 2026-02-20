# Backlog - Pre-Production Test Improvements

Items for agents to pick up to improve test coverage and pre-prod validation.

## Priority 1: Critical Test Gaps

### [ ] E2E Pipeline Test (SSE round-trip)
**Agent:** Feature Development
**Why:** The full pipeline (image → layout designer → card researcher → SSE events) has no automated test. The current tests only cover unit-level mocks.
**What to build:**
- Test that starts a local server, sends an image to `/api/hub/v2/analyze`, and verifies:
  - SSE `connected` event received
  - SSE `blueprint` event received with valid layout schema
  - SSE `card` events received for each card
  - SSE `complete` event received
  - Stream ends cleanly
- Use a small test image (1x1 pixel PNG base64)
- Mock the LLM adapter to return deterministic JSON
- File: `tests/integration/pipeline-e2e.test.js`

### [ ] SSE Error Handling Test
**Agent:** Feature Development
**Why:** When LLM fails or stream drops, the client can get stuck with no feedback. Need to verify error events propagate correctly.
**What to build:**
- Test that the `error` SSE event is sent when:
  - LLM adapter throws
  - Pipeline orchestrator fails
  - Invalid image is sent
- Verify the stream ends after error
- File: `tests/unit/sse-error-handling.test.js`

### [ ] Card Contract Validation Test
**Agent:** Feature Development
**Why:** LLM responses don't always match the card schema. Need tests for each card type.
**What to build:**
- For each of the 13 card types, test `validateCardData()` with:
  - Valid data → passes
  - Missing required fields → fails with errors
  - Extra fields → passes (ignored)
- File: `tests/unit/card-contracts.test.js`

## Priority 2: Frontend Validation

### [ ] Frontend State Machine Test
**Agent:** Feature Development
**Why:** The frontend has multiple states (paste → scan → blueprint → cards → complete) and transitions can break silently (as seen with the screenshot disappearing bug).
**What to build:**
- Use JSDOM or similar to test the state transitions:
  - paste → scan: screenshot appears, scan line active
  - scan → blueprint: screenshot fades, cards appear
  - blueprint → complete: progress hides, cards populated
  - error: error state shows from any state
  - reset: returns to paste state cleanly
- File: `tests/unit/frontend-states.test.js`

### [ ] Card Rendering Snapshot Tests
**Agent:** Feature Development
**Why:** Each card type has its own HTML rendering. Changes can break card layouts.
**What to build:**
- For each card type, render with mock data and snapshot the HTML output
- Detect regressions when card rendering changes unexpectedly
- File: `tests/unit/card-rendering.test.js`

## Priority 3: Deployment Validation

### [ ] Post-Deploy Health Check Script
**Agent:** Deployment
**Why:** The auto-deploy workflow verifies health but doesn't test the actual analysis pipeline.
**What to build:**
- Script that can be run post-deploy to verify:
  - `/api/health` returns 200
  - `/` returns hub-v2.html (check for key markers)
  - `/api/hub/v2/analyze` accepts a POST and returns SSE stream
- Could be a GitHub Actions step or standalone script
- File: `scripts/verify-deploy.sh`

### [ ] Vercel Secret Validation
**Agent:** Deployment
**Why:** Missing ANTHROPIC_API_KEY in Vercel causes silent failures in production.
**What to build:**
- Pre-deploy check that required env vars exist
- Post-deploy check that the API doesn't return "API Configuration Missing"
- Add to auto-deploy workflow

## Priority 4: Performance & Reliability

### [ ] Pipeline Timeout Tests
**Agent:** Feature Development
**Why:** Long-running LLM calls can cause the SSE connection to drop or Vercel to timeout (10s for hobby, 60s for pro).
**What to build:**
- Test that the keepalive mechanism works (sends `: keep-alive\n\n` every 15s)
- Test that the frontend 60s timeout fires correctly
- Test that partial results are still shown if some cards fail

### [ ] Concurrent Request Test
**Agent:** Feature Development
**Why:** Multiple users analyzing screenshots simultaneously could cause issues.
**What to build:**
- Test that 3 concurrent pipeline requests don't interfere with each other
- Each should get its own SSE stream with correct card data

---

**Last updated:** 2026-02-20
**Created by:** Feature Development session
