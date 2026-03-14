# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-14** | Fixed verification_card source snippet duplication — a confirmed P1 pattern where ALL breaking_news reports (4/4 reviewed: caea5011, fb0258e2, 7adc0c15, 7b72578c) had identical boilerplate text copied across every source snippet. Root cause: prompt didn't enforce unique per-source snippets. Fixed both the Claude vision prompt (card-researcher.js verificationInstructions) and the Perplexity Sonar query path to require distinct, source-specific 1-sentence snippets.

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability
- [ ] `getCardTypeLabel` and `CARD_ICONS` for 6 newer card types are dead code — never called

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

## Experiment: did_you_know_card factual accuracy
- Hypothesis: The did_you_know_card sometimes contains facts that contradict the main article (e.g. f2e3213a claimed "Melbourne ranks 21st" when the article says #1)
- Evidence: [f2e3213a] (need 10-20 before acting)
- Status: gathering

## Experiment: person_card shows non-persons or generic titles
- Hypothesis: person_card sometimes features organizations ("Al Jazeera Palestine", "Iranian Revolutionary Guard") or generic titles ("Japanese Prime Minister" without the actual name) instead of named individuals
- Evidence: [caea5011 — "Japanese Prime Minister" no name], [fb0258e2 — "Al Jazeera Palestine" is a news outlet], [7b72578c — "Iranian Revolutionary Guard" is an organization]
- Status: gathering

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- LLM field name mismatches are systemic — all card types have defensive normalization now. Fix prompts before adding more fallback chains.
- Pipeline durations are 15-20s typically. Sonar deep research (20-25s) is the external bottleneck.
- CSS cascade: the `@layer base` reset fix resolved all DaisyUI spacing issues.
- Client screenshots now use viewport-cropped foreignObject capture with dom-to-image-more fallback.
- fact_check verdict/confidence coherence enforced in prompt + rendering (2026-03-14).
- verification_card source snippets must be unique per source (2026-03-14).
