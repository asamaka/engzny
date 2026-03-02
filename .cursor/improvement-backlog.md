# Continuous Improvement Backlog

This file is automatically maintained by the Continuous Improvement Agent.
It provides continuity between agent runs — each agent reads this at the start
and updates it before pushing.

## Last Run

> **2026-03-02** | Trigger: `slow_pipeline` (0723744a, 81224ms) | Fixed P1: Pipeline taking 75-81s due to review phase re-sending the full image to Claude. Added `textWithToolLoop` to Claude adapter for text-only tool loops. Review phase now skips image re-send since cards are already populated — it only needs research data. Also doubled maxTokens (4096→8192) so Claude can batch more tool calls per response, reducing round-trips. Added prompt hint to use multiple tool calls per response. Expected improvement: ~30-40s savings on review phase.

## Active Work

Items currently being tracked across agent runs. Agents should pick up the
highest-priority incomplete item and continue where the last agent left off.

### P0 — Broken (errors, crashes, failed pipelines)

(none)

### P1 — Degraded (slow, bad results)

- [x] Cards showing 2/N populated — partial card population not detected as failure (fixed: dashboard now counts unique cardIds from card+card_update+card_add events)
- [x] Sonnet enhancer only populates 1 out of N cards — tool_use loop missing, Claude stops after first tool call (fixed: added iterative tool_use loop in Claude adapter)
- [x] Pipeline 75-81s: review phase re-sends image unnecessarily, each tool loop iteration doubles input tokens (fixed: text-only review, doubled maxTokens, batch prompt hint)

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
