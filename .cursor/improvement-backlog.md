# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-16** | Pipeline 2.0 slow pipeline fix (46.9s → ~39s estimated). Root cause: two sequential bottlenecks in `orchestrator-v2-0.js`. (1) pre_analysis and classify ran sequentially despite being independent — now parallelized with `Promise.all`. (2) deep_research waited for translation_verify to complete before starting (~6s blocked) — now starts immediately using pre-analysis claim. Also added a research duration cap (25s default, configurable via `RESEARCH_CAP_MS`) to prevent runaway Sonar calls from holding the SSE connection open. Triggered by report 2c2ef6ea (breaking_news, Arabic, 46913ms).

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
- Hypothesis: person_card gets populated with Facebook commenters/reactors (e.g. "Sherif Salah Afify") who are not relevant to the news story, rather than key figures mentioned in the article
- Evidence: [2c2ef6ea — "Sherif Salah Afify" as "News analyst/contributor" is actually a Facebook commenter]
- Status: gathering (1/10)

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- Pipeline 2.0 (llm2) is default: pre_analysis ∥ classify → enhance ∥ translation_verify ∥ deep_research.
- Pipeline durations are 15-20s typically. Sonar deep research (20-25s) is the external bottleneck.
- CSS cascade: the `@layer base` reset fix resolved all DaisyUI spacing issues.
- Client screenshots now use viewport-cropped foreignObject capture with dom-to-image-more fallback.
- fact_check verdict/confidence coherence now enforced in code (2026-03-15).
- person_card enforced at code level (2026-03-16) — detects orgs/outlets/generic titles and converts to source_card.
- Research duration cap added (2026-03-16) — 25s default via RESEARCH_CAP_MS env var.
