# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-18** | Fixed P1: verification_card marks the screenshot's own source as "not_yet_reported". Report 89b92015 showed Reuters as "not_yet_reported" — but the screenshot IS from Reuters, making this misleading. Fix: post-processing now promotes the preAnalysis source attribution to "confirmed" in verification cards when matched, upgrading overall status from "unconfirmed" to "partially_verified". Also reviewed 9802ed7b (Levin PM) — verification worked well there since Sonar deep research ran.

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability
- [ ] `getCardTypeLabel` and `CARD_ICONS` for 6 newer card types are dead code — never called

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

## Experiment: person_card for irrelevant people in multi-topic screenshots
- Hypothesis: When a screenshot contains text about multiple topics (e.g. sports + politics), person_card gets populated for a person mentioned in background text unrelated to the main story
- Evidence: [0b69e9a9 — "Yariv Levin" person_card in Morocco AFCON story, card says "Connection to this sports story unclear"]
- Status: gathering (1/10)

## Experiment: verification card thin when research times out
- Hypothesis: When deep research times out, verification cards show only 1-2 sources with no research summary
- Evidence: [4cc0dfaa — 1 source, no summary], [f256dfce — 2 sources, research timed out], [89b92015 — 2 sources, empty summary, all not_yet_reported]
- Status: gathering (3/10) — partially addressed by fallback summary + source attribution promotion

## Experiment: pipeline duration still exceeds 25s despite grace cap
- Hypothesis: POST_ENHANCE_GRACE_MS fires correctly but total pipeline duration still exceeds threshold
- Evidence: [f256dfce — 29684ms], [2c2ef6ea — 46913ms extremely slow]
- Status: gathering (2/10)

## Experiment: deep research silently fails (no trace recorded)
- Hypothesis: Deep research sometimes doesn't run at all for breaking_news — no trace in LLM trace summary even though content type is research-worthy
- Evidence: [89b92015 — breaking_news, 3 traces (classify/pre_analysis/enhance), no deep_research trace at all]
- Status: gathering (1/10)

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- Pipeline 2.0 (llm2) is default: pre_analysis ∥ classify → enhance ∥ translation_verify ∥ deep_research.
- Pipeline durations are 15-20s typically. Sonar deep research (20-25s) is the external bottleneck.
- CSS cascade: the `@layer base` reset fix resolved all DaisyUI spacing issues.
- Client screenshots now use viewport-cropped foreignObject capture with dom-to-image-more fallback.
- Source attribution promotion: verification cards now auto-confirm the screenshot's original source.
- Verification card: fallback summary generated when research unavailable (2026-03-18).
- Person card: unverified role qualification and relevance filtering (2026-03-18).
