# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-14** | Fixed fact_check verdict/confidence contradiction — a confirmed pattern where ~38% of fact_check cards showed contradictory signals (e.g. green "Verified" badge + "low confidence" text). Root cause: prompt didn't enforce coherence. Fixed both prompt (card-researcher.js rule 6) and rendering (hub-v2.html defensive suppression). Evidence: f2e3213a, a63d1701, 9e268ef6, 9aeb1bb2 across 13 reviewed cards.

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

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- LLM field name mismatches are systemic — all card types have defensive normalization now. Fix prompts before adding more fallback chains.
- Pipeline durations are 15-20s typically. Sonar deep research (20-25s) is the external bottleneck.
- CSS cascade: the `@layer base` reset fix resolved all DaisyUI spacing issues.
- Client screenshots now use viewport-cropped foreignObject capture with dom-to-image-more fallback. Capture metadata stored with reports for method evaluation.
- fact_check verdict/confidence coherence enforced in prompt + rendering (2026-03-14).
