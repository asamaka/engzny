# Continuous Improvement Backlog

This file is automatically maintained by the Continuous Improvement Agent.
It provides continuity between agent runs — each agent reads this at the start
and updates it before pushing.

## Last Run

> **2026-03-04** | Trigger: `report_review` (ea6f56b7 news/editorial) | Fixed P2: progress bar stuck at 65% for 8+ seconds while deep research runs after cards are populated. Heartbeat now switches from `phase: 'enhancing'` to `phase: 'researching'` once enhance completes, advancing progress from 70% to 90% with research-specific messages. Also fixed misleading `source: 'sonnet'` labels in card events (actual model is Haiku) — renamed to `source: 'enhance'`. Enhanced programmatic research enrichment to propagate `imageUrl`, `context`, `background`, and `details` from Sonar findings to person_card, location_card, did_you_know_card, and hero_summary. UI rubric: all 5 criteria PASS (report ea6f56b7, 393px viewport, 6/6 cards, Daisy components).

## Active Work

Items currently being tracked across agent runs. Agents should pick up the
highest-priority incomplete item and continue where the last agent left off.

### P0 — Broken (errors, crashes, failed pipelines)

- [x] Reports missing screenshot thumbnail (hasThumb: false) — sharp fails silently on Vercel, no thumbnail saved (fixed: client-side thumbnail generation, sent with upload)
- [x] Reports missing render capture — html2canvas errors swallowed, no fallback (fixed: retry logic, DOM-only fallback, console warnings)

### P1 — Degraded (slow, bad results)

- [x] Cards showing 2/N populated — partial card population not detected as failure (fixed: dashboard now counts unique cardIds from card+card_update+card_add events)
- [x] Sonnet enhancer only populates 1 out of N cards — tool_use loop missing, Claude stops after first tool call (fixed: added iterative tool_use loop in Claude adapter)
- [x] Pipeline 75-81s: review phase re-sends image unnecessarily, each tool loop iteration doubles input tokens (fixed: text-only review, doubled maxTokens, batch prompt hint)
- [x] Verification card status inconsistent: shows "unconfirmed" while 2/3 sources are green (fixed: post-phase reconciliation re-computes overall status from source statuses)
- [x] Verification card field name mismatches — LLM sends `status:"verified"` but reconciliation only checks `"confirmed"`, and LLM sends `.source` but code checks `.name` (fixed: normalizeSourceStatus + field fallbacks in orchestrator + frontend)
- [x] Haiku prematurely sets verification source statuses ("verified"/"confirmed") without research — Phase 2.5 skipped these sources entirely (fixed: prompt tells Haiku to leave as "checking", Phase 2.5 re-evaluates ALL sources against research regardless of current status)
- [x] Review phase 24.5s: Sonnet used for text-only structured merging (fixed: switched to Haiku + lean prompt + reduced maxTokens)
- [x] Enhance phase 18s with Sonnet — prompt sent all 22 schemas + 13 layouts (fixed: targeted schemas for relevant types only, compact layout info)
- [x] Enhance phase 27s with Sonnet — Sonnet too slow for tool_use card population (fixed: switched to Haiku, increased review maxTokens to 8192, compacted JSON)
- [x] Mobile uploads 15-17s + HTTP 413 errors — UPLOAD_TARGET_SIZE 3.2MB too close to Vercel 4.5MB limit (fixed: reduced to 1.5MB + MAX_DIM 1920→1568 to match Claude vision resolution)
- [x] Tool loop iterations blowing up pipeline duration — 7-card pipelines taking 31s+ due to 4-5 loop iterations per phase (fixed: maxIterations 2 for enhance, 1 for review, compact review prompt)
- [x] Enhance phase misses cards (6/7) when Claude returns end_turn early — review phase excluded unpopulated cards from prompt (fixed: review always includes unpopulated cards with NEEDS_POPULATION flag, orchestrator runs review even without research findings)
- [x] Product pipeline 75.6s — enhance 33.2s + review 40.9s due to image re-processing and verbose research data (fixed: prompt caching via cache_control for tool loop, research data truncation in review/enhance prompts)
- [x] Review phase always runs LLM call when research findings exist even if all cards populated — 7s overhead for marginal enrichment (fixed: skip LLM review when all cards populated, programmatic research enrichment instead)
- [x] chart_card shows "undefined" and NaN% bars when LLM uses variant field names (e.g., `{team, minute}` instead of `{label, value}`) — fixed: normalize label/value from common LLM alternatives, fallback to first numeric field for value (report 4515184b)
- [x] stats_grid_card fragile to LLM field name variants — fixed: accept `name`/`title`/`metric`/`key` for label, `stat`/`number`/`amount` for value, `data`/`items` as array source alternatives
- [x] Sonnet model appears in 3/5 pipeline traces — was caused by hard-coded `source: 'sonnet'` label in orchestrator card events + `sonnetEnhancePromise` variable name. Actual model was always Haiku. Fixed: renamed to `source: 'enhance'` and `enhancePromise`. card-researcher.js fallback model string also noted (line 180) but doesn't affect functionality.

### P2 — Polish (UX friction, visual quality, confusing output)

- [x] Card grid had cramped margins on mobile — padding was 8px, gap was 8px. Increased to 16px padding + 12px gap (mobile), 20px/14px (tablet), 16px gap (desktop). Follow-up section padding also fixed.
- [x] ALL DaisyUI/Tailwind padding broken — unlayered `* { padding: 0 }` reset overrides `@layer` styles (CSS cascade: unlayered beats layered regardless of specificity). Moved reset into `@layer base` so DaisyUI components and Tailwind utilities take proper effect. Root cause of zero-padding cards, cramped badges/pills, and all spacing issues.
- [x] Progress bar showed wrong card count (1-2 out of 7) and client telemetry reported completedCards=1-2 — `onCardUpdated` handler didn't count `card_update` events as completed cards. Fixed: now tracks newly populated cards, increments counter, updates progress text, triggers first-card-shown transition.
- [ ] Render capture shows full-length card grid — consider viewport-height clipping for very long card lists
- [x] Chat card field name mismatches — LLM sends `isOwn`/`timestamp` but renderer only checked `isUser`/`time`. Fixed: accept `isOwn`/`isOwnMessage`, `timestamp`/`ts`, `content`/`message` variants.
- [x] Follow-up questions always empty — fast classifier returns `[]`, research Sonar Q&A never surfaced. Fixed: orchestrator merges research follow-up questions, frontend re-renders on complete event.
- [ ] `getCardTypeLabel` function and `CARD_ICONS` for 6 new card types (chat_card, map_card, order_card, stats_grid_card, gallery_card, source_card) are dead code — never called. Consider removing or integrating.
- [x] Web research citations never displayed — `appendCitations()` queried `.card-inner` which no card renderer creates, silently dropping all Perplexity/Claude citations (fixed: append directly to card element, add horizontal margin to CSS)
- [ ] Ongoing: review card rendering CSS on each run for visual regressions (margins, padding, spacing, typography, responsive breakpoints)
- [ ] Ongoing: agent diversification — if last 3+ commits are same area, agents must pick a different area (enforced via prompt + spec)

### P3 — Resilience (logging, edge cases, retry logic)

- [ ] Adapter singleton cache uses module-level Map — could cause subtle issues across warm serverless invocations. Simplified cache key to `provider:model` to reduce stale entries.

## Observations

Patterns noticed across multiple runs that may inform future improvements.

- Initial backlog created 2026-03-02. System averaging 20-24s pipeline times.
- sendEvent was double-logging pipeline events (bare + explicit with meta). Fixed 2026-03-02.
- Pipeline durations trending down: recent reports at 16-21s range (vs earlier 20-24s).
- 100% of recent users are mobile (ua: "mobile"). Render captures will be iPhone-width by default.
- html2canvas added as CDN dependency (~40KB gzipped). Non-blocking, deferred load.
- Sonnet enhance+review phases each make one LLM call that returns stop_reason:tool_use — without looping, only first card per phase gets populated. Tool loop fix means ~4-8 iterations per phase but each card appears in real-time via SSE.
- Review phase was re-sending the base64 image in every tool loop iteration — for a 2333KB image, this adds massive input token cost. Switched to text-only for review since cards are already populated from the enhance pass.
- With maxTokens at 4096, Claude could only fit ~4 tool calls per response, forcing multiple round-trips. Increasing to 8192 lets Claude batch 7+ cards in one response.
- Phase 3 (review) overwrites Phase 2.5's verification status computation. The review LLM picks an overall status that may contradict the individual source icons the user sees. Added post-phase reconciliation to always re-derive status from source data.
- Report thumbnails depend on `sharp` which requires native binaries. On Vercel serverless, sharp fails silently. Moved thumbnail generation to client-side (canvas resize to 360px JPEG).
- html2canvas render capture had zero error visibility — all `.catch(() => {})`. Added console.warn, retry (up to 3 attempts for script loading), and DOM-only fallback when canvas capture fails.
- Review phase was using Sonnet (24.5s) for text-only card updates — a perfect fit for Haiku since no image analysis needed. Lean prompt with only relevant card schemas reduces input tokens significantly.
- Pipeline breakdown for 46s run: classify 1.5s + enhance 20s (parallel with research 11s) + review 24.5s. After Haiku review fix, expected: classify 1.5s + enhance 20s + review ~3-5s = ~25s total.
- Enhance prompt was sending all 22 card type schemas (~3500 tokens) + 13 layout type summaries (~500 tokens) even though classifier already chose specific types. For a "simple" layout with 4 cards, only 4 schemas are needed. Switched to targeted schemas: existing types + layout suggested types + did_you_know_card.
- Pipeline breakdown for 28.8s run (f843d2b8): classify 1.0s + enhance 18.1s (parallel with research 10.9s) + review 9.7s. After targeted schema fix, expected: classify 1.0s + enhance ~12s + review ~9s = ~22s total.
- Pipeline breakdown for 42.3s run (cc177943): classify 1.5s + enhance 27.3s (Sonnet, parallel with research 9.5s) + review 13.5s (Haiku, 4096 maxTokens). Switched enhance to Haiku and unified maxTokens to 8192. Expected: classify 1.5s + enhance ~6s + review ~6s = ~14-18s total.
- Haiku is sufficient for card population from screenshots — the task is structured extraction, not complex reasoning. Quality maintained by review phase as second pass.
- Client-side UPLOAD_TARGET_SIZE was 3.2MB (3.2 * 4/3 = 4.27MB base64 + JSON overhead → dangerously close to Vercel 4.5MB limit). Reduced to 1.5MB (~2MB base64) — eliminates HTTP 413 risk and halves mobile upload time. MAX_DIM reduced from 1920 to 1568 to match Claude's internal vision processing resolution.
- Dashboard showed 2x "Upload failed (HTTP 413)" client errors and upload times of 15-17s for ~2.6MB images on mobile. After fix: expected upload times ~5-8s, zero 413 errors.
- Tool loop iterations are the main pipeline duration driver for 7-card layouts. Each iteration re-sends the full conversation (including image in enhance phase), growing input tokens. Default maxIterations=8 allows up to 8 round-trips. Capped enhance at 2 (first pass populates most cards, second catches remainder) and review at 1 (all updates in a single batch). Also compacted review prompt to only include cards matching research findings — reduces input tokens by ~40% for typical 7-card pipelines.
- UI quality was a blind spot: card grid had 8px padding/gap on mobile, giving a cramped edge-to-edge look. No agent caught this because checks were focused on errors/performance. Agent spec updated to always review UI quality regardless of trigger reason.
- Pipeline 3da0bca5 had 6/7 cards because enhance phase (maxIterations=2) made only 1 LLM call that populated 6 cards with stop_reason: end_turn. The 7th card stayed as a loading skeleton. Root cause: buildReviewPrompt filtered cards to research-matching ones only, silently dropping empty cards. The review phase is text-only (no image) but can still populate cards like did_you_know_card, action_card, warning_card from content analysis + research context.
- ROOT CAUSE of zero-padding UI: the global `* { margin: 0; padding: 0; }` CSS reset was unlayered, which in CSS Cascade Layers means it overrides ALL @layer-based styles regardless of specificity. DaisyUI 5 + Tailwind 4 both use @layer for their styles. So every `.badge`, `.btn`, `.card`, `p-4`, `mb-2`, `gap-3` etc. had their padding/margin stripped. Fix: move reset into `@layer base`.
- Product pipeline d9c9b87f: 75.6s total, 145K input tokens. Enhance 33.2s + review 40.9s. The trace shows Sonnet model despite code specifying Haiku for both phases. Possible causes: adapter cache returning stale instance, API model routing, or warm serverless instance reuse. Added model logging (configModel vs adapterModel) to enhance function to help diagnose. Also added prompt caching (cache_control: ephemeral) to reduce re-processing cost on tool loop iteration 2, and truncated research data (summaries ≤200 chars, explanations ≤150 chars, max 8 findings) to cap review prompt size.
- Breaking news pipeline 6f376be3: 25.9s total (6520 input, 4108 output tokens). Enhance 17.5s (single Haiku call, 6 cards) + review 6.9s (text-only Haiku). Enhance duration is intrinsic to Haiku output generation speed (~2500 tokens for 6 tool calls). Review was marginal — all 6 cards were already populated, and Phase 2.5 already handled verification sources. Replaced LLM review with programmatic research enrichment (adds sourceUrls, context). Expected pipeline: classify 1.5s + enhance 17.5s + programmatic 0ms ≈ 19s.
- Client-side `completedCards` tracking was fundamentally broken: the enhance phase sends `card_update` events (via `onCardUpdate` callback), but the `onCardUpdated` handler in hub-v2.html never counted these as completed. Only `card` events (from `onCardPopulated`, typically just hero from Haiku phase) and `card_add` events were counted. Every session in Redis shows completedCards=1-2 despite 5-7 cards being rendered. This also meant the progress bar text ("X/Y") was stuck at low values during the enhance phase, and the `entering` CSS animation class wasn't applied to enhance-populated cards.
- The `fastClassify` function (used by orchestrator) always returns empty `topQuestions: []` and `followUpQuestions: []`. The full `layout-designer.js` asks for them in its prompt but is not used in the current pipeline. Sonar deep research is the only source of follow-up Q&A. The `complete` SSE event sends `contentAnalysis` but the frontend was ignoring it entirely — `onPipelineComplete()` never used the data parameter.
- Chat card schema defines `isUser` (boolean) and `time` (string) for messages, but the LLM frequently uses alternative names like `isOwn`, `isOwnMessage`, `timestamp`, `ts`, `content`, `message`. Making renderers defensive against common LLM field name variants is more reliable than expecting perfect schema adherence.
- Verification card had the same LLM field variant issue: schema says `name`/`confirmed` but Haiku sends `source`/`verified`. The `computeVerificationStatus` function only checked for exact `"confirmed"` match, causing all-green sources to compute as `"unconfirmed"`. This pattern will recur for any card type — **always normalize LLM-provided enum values before comparing**.
- Haiku should NEVER set verification statuses — it has no research data to back claims. Its role is speed-to-first-card with assumptions that get confirmed/denied by Sonar research. Phase 2.5 must always re-evaluate ALL sources against research, not just "checking" ones.
- The `appendCitations` function was referencing `.card-inner` — a class that was likely removed during a card renderer refactor but the citation code wasn't updated. This meant zero research citations were ever visible to users since the feature was added. Always verify DOM selectors against actual rendered HTML when making changes.
- UI Rubric (2026-03-03, report 89b5e4b3): Component consistency — inline `style=` attrs on cards still present in prod DOM (fix may not be deployed yet); Hub cohesion — PASS; Card integrity — 7/7 PASS; Population integrity — 7/7 PASS; Mobile readability — PASS (393px viewport, 16px padding). Overall: P1 at most (inline styles), pending deployment of recent UI commits.
- UI Rubric (2026-03-04, report ea6f56b7): All 5 criteria PASS. Daisy components, gap-4 p-4 grid, 6/6 populated, 393px mobile viewport, no clipping. Inline style issue from 89b5e4b3 is resolved — recent UI refactor commits are now deployed.
- Pipeline ea6f56b7: 22.1s total. Enhance 12.4s (Haiku, 6 cards), deep_research 20.6s (Sonar). Sonar is the bottleneck — enhance finishes at ~11s but pipeline waits until ~22s. Progress bar was stuck at 65% for 8+ seconds with stale "enhancing" phase messages. Fixed: heartbeat now detects enhance completion and switches to "researching" phase with advancing progress 70-90%.
- Programmatic research enrichment (`applyResearchToCards`) was missing imageUrl propagation, did_you_know_card context, person_card background, and location_card details. Only fact_check verdict and news_card relatedContext were enriched. Extended to cover 5 additional card types × fields.
- chart_card renderer assumed `{label, value}` schema compliance. LLM sent `{team: "Wolves (Gomes)", minute: 78}` for a sports goal timeline — same class of bug as chat_card and verification_card field mismatches. Pattern: **every card type with arrays of objects should normalize field names defensively** rather than trusting schema compliance.
- Report 00c854e0 (messaging/WhatsApp, 5 cards, 11.2s): research phase returned 2 follow-up Q&A with answers + 3 additional questions — all valuable context that was being discarded. Report f38c2ec1 (breaking news, 7 cards, 17.4s): person_card and location_card data was swapped by the LLM (person_card had location data and vice versa) — potential P2 output quality issue for future fix.
