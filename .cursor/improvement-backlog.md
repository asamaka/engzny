# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-16** | Fixed P1: verification card showing fabricated summaries when research times out. Root cause: enhance phase (Haiku) generates plausible verification summaries ("Multiple credible sources confirm...") from screenshot context alone. When deep research times out (grace cap fires before Sonar completes), `applyResearchFindings` didn't trigger because sources weren't in "checking" state, so the fabricated summary persisted — contradicting the "not_yet_reported" source statuses. Fix: (1) Always run `applyResearchFindings` on verification cards — when research has no findings, clear the summary and normalize sources to "not_yet_reported". (2) Improved `findMatchingFinding` word threshold from 4 to 3 chars so "BBC", "CNN", "AP" etc. can match. (3) When research has verdicts but specific source names don't match, infer "inconclusive" for unmatched sources instead of leaving contradictory "not_yet_reported".

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability
- [ ] `getCardTypeLabel` and `CARD_ICONS` for 6 newer card types are dead code — never called

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

## Experiment: did_you_know_card quality issues
- Hypothesis: did_you_know_card sometimes contains facts that are redundant with hero takeaway, contradict the main content, or are trivially obvious from the screenshot
- Evidence: [f2e3213a — "Melbourne ranks 21st" when article says #1], [30162e50 — "post received 6 reactions" trivially visible], [fce0ac87 — "90-minute interval suggests coordinated waves" restates claim], [1ba66d97 — cluster munitions fact duplicates hero takeaway], [caea5011 — generic fact about Japan's missile defense, not wrong but generic], [4cc0dfaa — "Al Jazeera operates a dedicated Lebanon bureau" irrelevant to missile story]
- Status: gathering (6/10)

## Experiment: person_card for Facebook commenters (not newsworthy)
- Hypothesis: person_card gets populated with Facebook commenters/reactors who are not relevant to the news story
- Evidence: [2c2ef6ea — "Sherif Salah Afify" as "News analyst/contributor" is actually a Facebook commenter]
- Status: gathering (1/10)

## Experiment: verification card thin when research times out
- Hypothesis: When deep research times out, verification cards show only 1 source (from Haiku enhance) with no research summary, making the verification feel incomplete
- Evidence: [4cc0dfaa — 1 source, no summary, research timed out], [f256dfce — 2 sources, fabricated summary (now fixed), research timed out at grace cap]
- Status: gathering (2/10) — partially addressed by clearing fabricated summaries

## Experiment: pipeline duration still exceeds 25s despite grace cap
- Hypothesis: POST_ENHANCE_GRACE_MS fires correctly but total pipeline duration still exceeds threshold due to other factors (translation verify, quality gate, post-processing)
- Evidence: [f256dfce — 29684ms despite 2s grace cap, research traces show 24.5s but should have been capped]
- Status: gathering (1/10)

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- Pipeline 2.0 (llm2) is default: pre_analysis ∥ classify → enhance ∥ translation_verify ∥ deep_research.
- Pipeline durations are 15-20s typically. Sonar deep research (20-25s) is the external bottleneck.
- CSS cascade: the `@layer base` reset fix resolved all DaisyUI spacing issues.
- Client screenshots now use viewport-cropped foreignObject capture with dom-to-image-more fallback.
- fact_check verdict/confidence coherence now enforced in code (2026-03-15).
- person_card enforced at code level (2026-03-16) — detects orgs/outlets/generic titles and converts to source_card.
- Research duration cap tightened (2026-03-16) — 20s default via RESEARCH_CAP_MS + 5s POST_ENHANCE_GRACE_MS.
- Verification card: fabricated summaries now cleared when research unavailable (2026-03-16).
