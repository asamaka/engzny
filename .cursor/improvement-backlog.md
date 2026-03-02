# Continuous Improvement Backlog

This file is automatically maintained by the Continuous Improvement Agent.
It provides continuity between agent runs — each agent reads this at the start
and updates it before pushing.

## Last Run

> **2026-03-02** | Trigger: `report_review` (a7faa1dd, success) | Fixed P1: dashboard card count showing 2/N instead of actual populated count. Root cause: (1) dashboard only counted `event === 'card'` events but most cards populate via `card_update`/`card_add`, and (2) `sendEvent` double-logged every event without cardId metadata. Fix: count unique cardIds from all card-related events + remove duplicate bare logging from `sendEvent`.

## Active Work

Items currently being tracked across agent runs. Agents should pick up the
highest-priority incomplete item and continue where the last agent left off.

### P0 — Broken (errors, crashes, failed pipelines)

(none)

### P1 — Degraded (slow, bad results)

- [x] Cards showing 2/N populated — partial card population not detected as failure (fixed: dashboard now counts unique cardIds from card+card_update+card_add events)

### P2 — Polish (UX friction, confusing output)

(none)

### P3 — Resilience (logging, edge cases, retry logic)

(none)

## Observations

Patterns noticed across multiple runs that may inform future improvements.

- Initial backlog created 2026-03-02. System averaging 20-24s pipeline times.
- sendEvent was double-logging pipeline events (bare + explicit with meta). Fixed 2026-03-02.
- Pipeline durations trending down: recent reports at 16-21s range (vs earlier 20-24s).
