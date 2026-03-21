# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-21** (run 5) | Fixed P1: Gemini still returning 0 citations in 100% of post-fix reports. Run 4's prompt-only fix didn't work — Gemini 2.5 Flash's `google_search` tool decision is internal, not prompt-controllable. Fix: added supplementary text-only search when main analysis returns 0 citations. Text-only queries trigger Google Search more reliably (no image processing overhead, model recognizes need for current data). Evidence: 12/12 reports since run 4 had 0 citations [8de4eb06, a32ab6a9, 3c55f876, 0a706c65, 8c195750, 12018dc0, 70b731b6, 0a60cc9a + 4 pre-fix]. Only 09f878c8 ever had citations (12, 23s duration vs 6-10s for others — confirms model skipped search entirely).

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

## Experiment: supplementary search citation yield
- Hypothesis: Text-only supplementary Gemini calls will yield citations >70% of the time (vs 0% from image+text streaming)
- Baseline: 0/12 reports had citations before this fix
- Evidence post-fix: [] (need 10-20 reports to evaluate)
- Status: gathering — monitor next 10-20 factcheck reports

## Experiment: hero subtitle factual errors from classify phase
- Hypothesis: When classify phase sets intent with location errors, the error propagates to hero subtitle
- Evidence: [051bb8d8 — hero says "Gaza region" but targets are Israeli cities]
- Status: gathering (1/10)

## Experiment: verification card thin when research times out
- Hypothesis: When deep research times out, verification cards show only 1-2 sources
- Evidence: [4cc0dfaa, f256dfce, 89b92015, 051bb8d8, 0fc73c87]
- Status: gathering (5/10) — partially addressed by fallback summary + source promotion

## Experiment: deep research silently fails (no trace recorded)
- Hypothesis: Deep research sometimes doesn't run at all for breaking_news
- Evidence: [89b92015, 051bb8d8, 0fc73c87]
- Status: gathering (3/10) — likely times out before any LLM call is made

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- Factcheck pipeline is default for all content. Uses Gemini 2.5 Flash with Google Search grounding.
- Supplementary text-only search added (2026-03-21 run 5): fallback when streaming returns 0 citations.
- Zero-citation prompt fix applied (2026-03-20 run 4): mandatory search framing — insufficient alone.
- Verdict explanation quality gate + summary fallback for short explanations (2026-03-20 run 3).
- Verdict explanation multi-line capture with section delimiter lookahead (2026-03-19).
- Source attribution promotion: works cross-language via intent + source_card matching (2026-03-18).
