# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-20** (run 3) | Fixed P1: Verdict explanation truncation in factcheck reports. Reports `12018dc0` (explanation = "The"), `8c195750` (cut off mid-sentence) showed users absurdly short or incomplete verdict explanations — the first thing they see. Root cause: streaming parser accepted any text between VERDICT line and first blank line. When Gemini output "The\n\n---SUMMARY", the lazy regex captured just "The". Fix: added quality gate (30-char minimum), summary-sentence fallback for short explanations, and prompt rule requiring complete explanation sentences. Applied to all 3 parsers (streaming, server fallback, client fallback).

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

## Experiment: factcheck pipeline zero grounding citations
- Hypothesis: Gemini grounding returns 0 citations for many factcheck analyses, meaning no web-verified sources
- Evidence: [0a60cc9a, 70b731b6, 12018dc0, 8c195750, 0a706c65, 3c55f876] — 6 reports with 0 citations
- Only 09f878c8 had citations (12) — took 23s vs ~7s for others
- Status: gathering (6/10) — Gemini may be skipping search when it thinks it knows the answer

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
- Verdict streaming parser fixed: quality gate + summary fallback for short explanations (2026-03-20).
- Verdict explanation multi-line capture with section delimiter lookahead (2026-03-19).
- Source attribution promotion: works cross-language via intent + source_card matching (2026-03-18).
