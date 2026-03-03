# Continuous Improvement Backlog

This file is automatically maintained by the Continuous Improvement Agent.
It provides continuity between agent runs — each agent reads this at the start
and updates it before pushing.

## Last Run

> **2026-03-03** | Manual: Complete hub-v2.html rewrite. Nuked the old 3100-line monolith with 23 bespoke card renderers, fragile Tailwind/DaisyUI dependencies, and the `* { padding: 0 }` CSS layer bug. New hub: ~900 lines, zero external CSS framework dependencies, all styles in custom stylesheet, unified card structure (card-head + card-body + card-foot), single-column mobile by default, consistent padding/spacing throughout. All 24 card types supported with a clean generic fallback.

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
- [x] Review phase 24.5s: Sonnet used for text-only structured merging (fixed: switched to Haiku + lean prompt + reduced maxTokens)
- [x] Enhance phase 18s with Sonnet — prompt sent all 22 schemas + 13 layouts (fixed: targeted schemas for relevant types only, compact layout info)
- [x] Enhance phase 27s with Sonnet — Sonnet too slow for tool_use card population (fixed: switched to Haiku, increased review maxTokens to 8192, compacted JSON)
- [x] Mobile uploads 15-17s + HTTP 413 errors — UPLOAD_TARGET_SIZE 3.2MB too close to Vercel 4.5MB limit (fixed: reduced to 1.5MB + MAX_DIM 1920→1568 to match Claude vision resolution)
- [x] Tool loop iterations blowing up pipeline duration — 7-card pipelines taking 31s+ due to 4-5 loop iterations per phase (fixed: maxIterations 2 for enhance, 1 for review, compact review prompt)

### P2 — Polish (UX friction, visual quality, confusing output)

- [x] Card grid had cramped margins on mobile — root cause was `* { padding: 0 }` CSS reset overriding DaisyUI @layer styles. Fixed by complete hub rewrite with zero framework dependencies.
- [x] hub-v2.html complete rewrite — 3100 lines → ~900 lines. All CSS in custom stylesheet, no Tailwind/DaisyUI dependency for layout/cards. Unified card structure. Single-column mobile.
- [ ] Render capture may need tuning after rewrite — html2canvas still used but DOM structure is simpler now
- [ ] Ongoing: review card rendering CSS on each run for visual regressions

### P3 — Resilience (logging, edge cases, retry logic)

(none)

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
- ROOT CAUSE of zero-padding UI: the global `* { margin: 0; padding: 0; }` CSS reset was unlayered, which in CSS Cascade Layers means it overrides ALL @layer-based styles regardless of specificity. DaisyUI 5 + Tailwind 4 both use @layer for their styles. So every `.badge`, `.btn`, `.card`, `p-4`, `mb-2`, `gap-3` etc. had their padding/margin stripped. Fix: move reset into `@layer base`.
