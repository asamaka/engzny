# Continuous Improvement Backlog

This file is automatically maintained by the Continuous Improvement Agent.
It provides continuity between agent runs — each agent reads this at the start
and updates it before pushing.

## Last Run

> **2026-03-03** | Trigger: `slow_pipeline` (f843d2b8, 28783ms) | Fixed P1: Enhance phase took 18.1s because prompt included all 22 card type schemas + 13 layout types. Trimmed to only relevant types (existing cards + layout suggestions + did_you_know_card) and replaced layout list with just current layout. Also compacted review prompt JSON. Expected enhance reduction: ~5-7s (from 18s to ~11-13s), bringing total pipeline to ~22-24s.

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
- Enhance prompt was sending all 22 card type schemas (~3500 tokens) + 13 layout type summaries (~500 tokens) even though classifier already chose specific types. For a "simple" layout with 4 cards, only 4 schemas are needed. Switched to targeted schemas: existing types + layout suggested types + did_you_know_card.
- Pipeline breakdown for 28.8s run (f843d2b8): classify 1.0s + enhance 18.1s (parallel with research 10.9s) + review 9.7s. After targeted schema fix, expected: classify 1.0s + enhance ~12s + review ~9s = ~22s total.
