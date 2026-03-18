# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-18** | Fixed P1: person_card role presented unverified claim as fact. Reports 79e8e690 and 9802ed7b (Levin PM claim) showed person_card with role "Israeli Prime Minister (interim)" while verification_card said "unconfirmed — no major outlets confirm." Product contradiction misleads users. Fix: post-processing step after investigation status resolved — when claim is "unconfirmed", (1) person_card roles for people named in the claim get "— unverified" suffix; (2) if verification summary contains the person's actual verified role, it's surfaced as notableInfo; (3) news_card summaries echoing the claim get "Per unverified reports:" prefix.

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability
- [ ] `getCardTypeLabel` and `CARD_ICONS` for 6 newer card types are dead code — never called

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

## Experiment: person_card for Facebook commenters (not newsworthy)
- Hypothesis: person_card gets populated with Facebook commenters/reactors who are not relevant to the news story
- Evidence: [2c2ef6ea — "Sherif Salah Afify" as "News analyst/contributor" is actually a Facebook commenter]
- Status: gathering (1/10) — partially addressed by low-confidence filtering

## Experiment: verification card thin when research times out
- Hypothesis: When deep research times out, verification cards show only 1 source with no research summary
- Evidence: [4cc0dfaa — 1 source, no summary], [f256dfce — 2 sources, research timed out at grace cap]
- Status: gathering (2/10) — partially addressed by clearing fabricated summaries

## Experiment: pipeline duration still exceeds 25s despite grace cap
- Hypothesis: POST_ENHANCE_GRACE_MS fires correctly but total pipeline duration still exceeds threshold
- Evidence: [f256dfce — 29684ms], [2c2ef6ea — 46913ms extremely slow]
- Status: gathering (2/10)

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- Pipeline 2.0 (llm2) is default: pre_analysis ∥ classify → enhance ∥ translation_verify ∥ deep_research.
- Pipeline durations are 15-20s typically. Sonar deep research (20-25s) is the external bottleneck.
- CSS cascade: the `@layer base` reset fix resolved all DaisyUI spacing issues.
- Client screenshots now use viewport-cropped foreignObject capture with dom-to-image-more fallback.
- fact_check verdict/confidence coherence now enforced in code (2026-03-15).
- person_card enforced at code level (2026-03-16) — detects orgs/outlets/generic titles and converts to source_card.
- person_card relevance filtering (2026-03-18) — low-confidence pre-analysis people no longer get skeleton cards; quality gate catches LLM-flagged irrelevance.
- person_card unverified role qualification (2026-03-18) — when claim is unconfirmed, person_card roles for named claim subjects get "(unverified)" suffix and verified role from research surfaced.
- Research duration cap tightened (2026-03-16) — 20s default via RESEARCH_CAP_MS + 5s POST_ENHANCE_GRACE_MS.
- Verification card: fabricated summaries now cleared when research unavailable (2026-03-16).
- Timeline card: research findings now enriched into timeline events (2026-03-17).
- DYK card: enhance prompt now has specific quality guidance + post-processing replaces redundant facts from research (2026-03-17).
