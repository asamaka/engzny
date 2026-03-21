# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-21** (run 6) | Fixed P1: Supplementary search still producing 0 citations. Root cause: Gemini 2.5 Flash's `google_search` tool is unreliable — model internally decides whether to search and skips it ~95% of the time. Both the main streaming analysis and the run-5 supplementary text-only Gemini call failed identically. Fix: switched supplementary search from Gemini to Claude with `web_search_20250305` tool. Claude's web search is tool-based (explicitly searches when the tool is available). Evidence: 7/7 post-run-5 reports had 0 citations from Gemini supplementary search [f1f498f0 gap=2.2s, 8de4eb06, a32ab6a9, 3c55f876, 0a706c65, 8c195750, 12018dc0]. Added `generateTextWithWebSearch` to Claude adapter, added "Verifying sources..." progress phase for UX.

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

## Experiment: Claude supplementary search citation yield
- Hypothesis: Claude web_search will yield citations >70% of the time (replacing Gemini supplementary search which yielded 0%)
- Baseline: 0/7 Gemini supplementary searches produced citations (run 5)
- Evidence post-fix: [] (need 10-20 reports to evaluate)
- Status: gathering — monitor next 10-20 factcheck reports

## Experiment: factcheck verdict inconsistency for same content
- Hypothesis: Same screenshot can get different verdicts (MISLEADING vs UNVERIFIED) depending on whether Gemini searched
- Evidence: [f1f498f0=MISLEADING, 8de4eb06=UNVERIFIED, a32ab6a9=MISLEADING — all same HRW/Netanyahu topic]
- Status: gathering (3/10) — may improve once citations provide grounding

## Experiment: hero subtitle factual errors from classify phase
- Hypothesis: When classify phase sets intent with location errors, the error propagates to hero subtitle
- Evidence: [051bb8d8 — hero says "Gaza region" but targets are Israeli cities]
- Status: gathering (1/10)

## Experiment: verification card thin when research times out
- Hypothesis: When deep research times out, verification cards show only 1-2 sources
- Evidence: [4cc0dfaa, f256dfce, 89b92015, 051bb8d8, 0fc73c87]
- Status: gathering (5/10) — partially addressed by fallback summary + source promotion

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- Factcheck pipeline is default for all content. Uses Gemini 2.5 Flash with Google Search grounding.
- Supplementary search switched to Claude web_search (2026-03-21 run 6): Gemini grounding unreliable.
- Zero-citation prompt fix applied (2026-03-20 run 4): mandatory search framing — insufficient alone.
- Verdict explanation quality gate + summary fallback for short explanations (2026-03-20 run 3).
