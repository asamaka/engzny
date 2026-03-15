# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-15** | Fixed `getCardTypeSchemaForTypes` — the function used in both enhance and review prompts was stripping array sub-field info, sending `events: array —` and `sources: array —` with no field names. LLM improvised different field names per run (time/event, timestamp/label, date/event). Now sends `events: array of {date*, event*, highlight, url}` etc. Root-cause prompt fix per backlog guidance. Reviewed 9f62965e (IRGC/Netanyahu), caea5011 (Japan/NK), fb0258e2 (Iran strikes). All pipelines healthy, 100% client success rate.

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability
- [ ] `getCardTypeLabel` and `CARD_ICONS` for 6 newer card types are dead code — never called

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

## Experiment: did_you_know_card quality issues
- Hypothesis: did_you_know_card sometimes contains facts that contradict the main content or are trivially obvious from the screenshot
- Evidence: [f2e3213a — "Melbourne ranks 21st" when article says #1], [30162e50 — "post received 6 reactions" is trivially visible]
- Status: gathering (2/10)

## Experiment: person_card shows non-persons or generic titles
- Hypothesis: person_card sometimes features organizations or generic titles instead of named individuals
- Evidence: [caea5011 — "Japanese Prime Minister" no name], [fb0258e2 — "Al Jazeera Palestine" is a news outlet], [7b72578c — "Iranian Revolutionary Guard" is an organization], [f2e3213a — "Time Out Editorial" is a publication]
- Positive: [9f62965e — "Benjamin Netanyahu" correctly identified with name and role]
- Status: gathering (4/10 negative, 1 positive)

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- Array sub-field schemas now included in enhance/review prompts (2026-03-15) — reduces LLM field name improvisation.
- Pipeline durations are 15-20s typically. Sonar deep research (20-25s) is the external bottleneck.
- CSS cascade: the `@layer base` reset fix resolved all DaisyUI spacing issues.
- Client screenshots now use viewport-cropped foreignObject capture with dom-to-image-more fallback.
- fact_check verdict/confidence coherence now enforced in code (2026-03-15) — prompt + code dual enforcement.
- verification_card source snippets must be unique per source (2026-03-14).
