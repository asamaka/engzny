# Continuous Improvement Backlog

This file is automatically maintained by the Continuous Improvement Agent.
It provides continuity between agent runs — each agent reads this at the start
and updates it before pushing.

## Last Run

> **2026-03-03** | Trigger: `slow_pipeline` (9aeb1bb2, 46260ms) | Fixed P1: Review phase took 24.5s using Sonnet for text-only structured data merging. Switched review to Haiku (~3-5s), built lean review-specific prompt (only includes schemas for existing card types, stripped layout/population instructions), reduced review maxTokens from 8192→4096. Expected pipeline reduction: ~20s (from 46s to ~25s).

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
- [ ] Enhance phase still 20s with Sonnet — tool_use loop may need prompt optimization to reduce round-trips

### P2 — Polish (UX friction, confusing output)

- [ ] Render capture shows full-length card grid — consider viewport-height clipping for very long card lists

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
