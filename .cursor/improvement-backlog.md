# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-21** (run 7) | Fixed P1: Factcheck pipeline slow (36.7s) when Claude supplementary search succeeds. Root cause: supplementary search ran SEQUENTIALLY after Gemini stream completed, using Sonnet (slow). Fix: (1) Start supplementary search speculatively mid-stream — once verdict+summary are streamed (---ANGLE marker), fire off the search in parallel with remaining Gemini output. (2) Switch from Sonnet to Haiku for supplementary search (faster, adequate for citation finding). (3) Add 12s timeout cap. (4) Reduce maxTokens from 2048→1024. Expected improvement: 36.7s → ~18-22s for citation-yielding pipelines. Evidence: [5a75f4a0: 36.7s with 8 citations, sequential Sonnet search was ~20s of the total].

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
- Evidence post-fix (run 6 Sonnet): [5a75f4a0=8 citations, f1f498f0=0, 8de4eb06=0, a32ab6a9=0, 3c55f876=0]
- Run 7: switched to Haiku + speculative parallel search. Continue monitoring.
- Status: gathering (1/10 success with citations) — need more data post-run-7

## Experiment: factcheck verdict inconsistency for same content
- Hypothesis: Same screenshot can get different verdicts depending on search results
- Evidence: [f1f498f0=MISLEADING, 8de4eb06=UNVERIFIED, a32ab6a9=MISLEADING — all same HRW/Netanyahu topic]
- Status: gathering (3/10)

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
- Supplementary search: Haiku + speculative mid-stream start (2026-03-21 run 7).
- Zero-citation prompt fix applied (2026-03-20 run 4): mandatory search framing — insufficient alone.
- Verdict explanation quality gate + summary fallback for short explanations (2026-03-20 run 3).
