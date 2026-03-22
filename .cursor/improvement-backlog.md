# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-22** (run 8) | Fixed P1: Verdict explanation truncation — report 12018dc0 stored "The" as explanation. Root cause: mid-stream `enhanceExplanationFromSummary()` fires when `---SUMMARY` marker appears but before summary content streams, enhancement fails, `emitVerdict()` sends the short fragment permanently. Fix: (1) Only emit pending verdict mid-stream if enhanced explanation >= 30 chars, allowing retry on subsequent chunks. (2) Added post-stream report-saving fallback that re-enhances short explanations from full text. Evidence: [12018dc0=explanation "The", 8c195750=truncated mid-sentence].

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

## Experiment: Claude supplementary search citation yield
- Hypothesis: Claude web_search will yield citations >70% of the time
- Baseline: 0/7 Gemini supplementary searches produced citations (run 5)
- Evidence post-fix: [5a75f4a0=8, f1f498f0=0, 8de4eb06=0, a32ab6a9=0, 3c55f876=0, 0a706c65=0, 8c195750=0, 09f878c8=12, 52ccc428=3]
- Run 8: 3/9 reports with citations (33%). Haiku + speculative parallel search.
- Status: gathering (9 data points) — nearing threshold, 33% yield is low but improving

## Experiment: factcheck verdict inconsistency for same content
- Hypothesis: Same screenshot can get different verdicts depending on search results
- Evidence: [f1f498f0=MISLEADING, 8de4eb06=UNVERIFIED, a32ab6a9=MISLEADING — all same HRW/Netanyahu topic]
- Status: gathering (3/10)

## Experiment: verification card thin when research times out
- Hypothesis: When deep research times out, verification cards show only 1-2 sources
- Evidence: [4cc0dfaa, f256dfce, 89b92015, 051bb8d8, 0fc73c87]
- Status: gathering (5/10) — partially addressed by fallback summary + source promotion

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- Factcheck pipeline is default for all content. Uses Gemini 2.5 Flash with Google Search grounding.
- Supplementary search: Haiku + speculative mid-stream start (2026-03-21 run 7).
- Verdict explanation quality gate + summary fallback for short explanations (2026-03-20 run 3).
- Verdict mid-stream truncation fix (2026-03-22 run 8): don't emit pending verdict until explanation >= 30 chars.
