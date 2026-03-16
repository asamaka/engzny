# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-16** | Tightened post-enhance research grace period. Root cause: after enhance completes (~17-20s), Pipeline 2.0 waited up to 7.5s for deep research that often timed out without findings — inflating the reported pipeline duration past 25s. Fixed by (1) reducing RESEARCH_CAP_MS default from 25s to 20s, (2) adding POST_ENHANCE_GRACE_MS hard cap (5s default) so we never idle >5s after enhance. For the triggering report 4cc0dfaa (breaking_news, Arabic, 25001ms), this would reduce duration to ~20s. User-perceived latency (onComplete) was already ~17.5s — the extra time was only delaying the settled event.

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
- Evidence: [f2e3213a — "Melbourne ranks 21st" when article says #1], [30162e50 — "post received 6 reactions" trivially visible], [fce0ac87 — "90-minute interval suggests coordinated waves" restates claim], [1ba66d97 — cluster munitions fact duplicates hero takeaway], [caea5011 — generic fact about Japan's missile defense, not wrong but generic]
- Status: gathering (5/10)

## Experiment: person_card for Facebook commenters (not newsworthy)
- Hypothesis: person_card gets populated with Facebook commenters/reactors who are not relevant to the news story
- Evidence: [2c2ef6ea — "Sherif Salah Afify" as "News analyst/contributor" is actually a Facebook commenter]
- Status: gathering (1/10)

## Experiment: verification card thin when research times out
- Hypothesis: When deep research times out, verification cards show only 1 source (from Haiku enhance) with no research summary, making the verification feel incomplete
- Evidence: [4cc0dfaa — 1 source (Al Jazeera), no summary, research timed out]
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
