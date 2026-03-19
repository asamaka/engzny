# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-19** (run 2) | Fixed P1: Verdict explanation still truncated for multi-line LLM output. Reports `8c195750`, `09f878c8` all showed clipped explanations (e.g. "...tourism is a significant part" instead of the full sentence). Root cause: all three verdict parsers (streaming, server fallback, client fallback) used `.+` which only captures one physical line — when Gemini wraps a long explanation across lines, the rest is lost. Fixed: regex now uses `[\s\S]+?` with `(?=\n\n|\n---)` lookahead to capture until the next section delimiter, then joins newlines into a single string.

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability
- [ ] `getCardTypeLabel` and `CARD_ICONS` for 6 newer card types are dead code — never called

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

## Experiment: hero subtitle factual errors from classify phase
- Hypothesis: When classify phase sets intent with location errors (e.g. "Gaza region" instead of "Israeli cities"), the error propagates to hero subtitle because translation verification results don't feed back to update cards
- Evidence: [051bb8d8 — hero says "Gaza region" but targets are Acre/Haifa/Tel Aviv/Beersheba in Israel]
- Status: gathering (1/10)

## Experiment: verification card thin when research times out
- Hypothesis: When deep research times out, verification cards show only 1-2 sources with no research summary
- Evidence: [4cc0dfaa, f256dfce, 89b92015, 051bb8d8, 0fc73c87]
- Status: gathering (5/10) — partially addressed by fallback summary + source promotion

## Experiment: deep research silently fails (no trace recorded)
- Hypothesis: Deep research sometimes doesn't run at all for breaking_news — no trace in LLM trace summary
- Evidence: [89b92015, 051bb8d8, 0fc73c87]
- Status: gathering (3/10) — likely times out before any LLM call is made

## Experiment: pipeline duration still exceeds 25s despite grace cap
- Hypothesis: POST_ENHANCE_GRACE_MS fires correctly but total pipeline duration still exceeds threshold
- Evidence: [f256dfce — 29684ms, 2c2ef6ea — 46913ms, 0fc73c87 — 26583ms]
- Status: gathering (3/10)

## Experiment: factcheck pipeline zero grounding citations
- Hypothesis: Gemini grounding returns 0 citations for some factcheck analyses, meaning no web-verified sources
- Evidence: [0a60cc9a — 0 citations, FALSE verdict], [70b731b6 — 0 citations, 7.8s], [12018dc0 — 0 citations, PARTLY TRUE], [8c195750 — 0 citations, TRUE, 7.6s]
- Status: gathering (4/10) — monitor citation rate; Claude fallback provides alternative source

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- Pipeline 2.0 (llm2) is default for breaking_news; factcheck pipeline is default for factcheck content.
- CSS cascade: the `@layer base` reset fix resolved all DaisyUI spacing issues.
- Source attribution promotion: now works cross-language via intent + source_card matching (2026-03-18).
- Factcheck reports now include verdict, explanation, angles, and citation data (2026-03-19).
- Factcheck pipeline now has Claude fallback when Gemini fails (2026-03-19).
- Verdict streaming parser fixed: multi-line explanation capture with section delimiter lookahead (2026-03-19).
