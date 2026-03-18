# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-18** | Fixed P1: verification_card source attribution promotion fails for non-Latin source names. Reports 051bb8d8 and 0fc73c87 both showed Al Jazeera as "not_yet_reported" despite the screenshot being FROM Al Jazeera — because `sourceAttribution.name` was Arabic ("الجزيرة - مصر") while verification sources used English ("Al Jazeera (Egypt)"). Fix: build cross-language candidate set from intent field, source_cards, and Latin-script extraction. Also added "partially_verified" fallback summary so promoted-but-unresearched verification cards show useful context.

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
- Evidence: [051bb8d8 — hero says "Gaza region" but targets are Acre/Haifa/Tel Aviv/Beersheba in Israel; translation_verify caught the correct locations but enhance used the original wrong intent]
- Status: gathering (1/10) — monitor whether this occurs systematically

## Experiment: verification card thin when research times out
- Hypothesis: When deep research times out, verification cards show only 1-2 sources with no research summary
- Evidence: [4cc0dfaa — 1 source, no summary], [f256dfce — 2 sources, research timed out], [89b92015 — 2 sources, empty summary], [051bb8d8 — 1 source, no research], [0fc73c87 — 1 source, no research]
- Status: gathering (5/10) — partially addressed by fallback summary + source promotion

## Experiment: deep research silently fails (no trace recorded)
- Hypothesis: Deep research sometimes doesn't run at all for breaking_news — no trace in LLM trace summary
- Evidence: [89b92015 — 3 traces, no deep_research], [051bb8d8 — 4 traces, no deep_research], [0fc73c87 — 4 traces, no deep_research]
- Status: gathering (3/10) — likely times out before any LLM call is made

## Experiment: pipeline duration still exceeds 25s despite grace cap
- Hypothesis: POST_ENHANCE_GRACE_MS fires correctly but total pipeline duration still exceeds threshold
- Evidence: [f256dfce — 29684ms], [2c2ef6ea — 46913ms], [0fc73c87 — 26583ms]
- Status: gathering (3/10)

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- Pipeline 2.0 (llm2) is default: pre_analysis ∥ classify → enhance ∥ translation_verify ∥ deep_research.
- Pipeline durations are 15-20s typically. Sonar deep research (20-25s) is the external bottleneck.
- CSS cascade: the `@layer base` reset fix resolved all DaisyUI spacing issues.
- Source attribution promotion: now works cross-language via intent + source_card matching (2026-03-18).
- Verification card: fallback summary generated for all status types including partially_verified (2026-03-18).
