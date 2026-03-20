# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-20** (run 4) | Fixed P1: Gemini skipping web search in ~85% of factcheck analyses. Reports had 0 citations because the prompt buried search instructions in rules at the bottom. Fix: restructured prompt to put "WEB SEARCH IS MANDATORY" front and center, added explicit search workflow (read→search→analyze→write), added system_instruction to Gemini API call reinforcing search-first behavior, added warning log when 0 citations returned. Evidence: 7/8 recent reports had 0 citations [0a60cc9a, 70b731b6, 12018dc0, 8c195750, 0a706c65, 3c55f876, 8c195750]; only 09f878c8 (23s, 12 citations) actually searched.

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

## Experiment: factcheck zero citations post-prompt-fix
- Hypothesis: The restructured prompt (run 4) will increase Gemini's search tool usage from ~12% to >50%
- Baseline: 1/8 reports had citations before fix (09f878c8 only)
- Evidence post-fix: [] (need 10-20 reports to evaluate)
- Status: gathering — monitor next 10-20 factcheck reports to validate the fix worked

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
- Zero-citation prompt fix applied (2026-03-20 run 4): mandatory search framing + system_instruction.
- Verdict explanation quality gate + summary fallback for short explanations (2026-03-20 run 3).
- Verdict explanation multi-line capture with section delimiter lookahead (2026-03-19).
- Source attribution promotion: works cross-language via intent + source_card matching (2026-03-18).
