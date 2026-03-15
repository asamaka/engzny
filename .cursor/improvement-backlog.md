# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-15** | Enforced fact_check verdict/confidence coherence in code. Prompt-only fix (ea5cd13) didn't work — LLM still returns "verified" + "low" confidence. Added post-processing in orchestrator that downgrades "verified+low" to "needs_context+low" and "false/misleading+low" to "unverified+low". Same approach as verification_card status reconciliation. Confirmed in 30162e50 (social_media) and f2e3213a (news) — both showed green "Verified" badge for claims the LLM itself said couldn't be verified.

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
- Status: gathering

## Experiment: person_card shows non-persons or generic titles
- Hypothesis: person_card sometimes features organizations or generic titles instead of named individuals
- Evidence: [caea5011 — "Japanese Prime Minister" no name], [fb0258e2 — "Al Jazeera Palestine" is a news outlet], [7b72578c — "Iranian Revolutionary Guard" is an organization], [f2e3213a — "Time Out Editorial" is a publication]
- Status: gathering (4/10)

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- LLM field name mismatches are systemic — all card types have defensive normalization now. Fix prompts before adding more fallback chains.
- Pipeline durations are 15-20s typically. Sonar deep research (20-25s) is the external bottleneck.
- CSS cascade: the `@layer base` reset fix resolved all DaisyUI spacing issues.
- Client screenshots now use viewport-cropped foreignObject capture with dom-to-image-more fallback.
- fact_check verdict/confidence coherence now enforced in code (2026-03-15) — prompt + code dual enforcement.
- verification_card source snippets must be unique per source (2026-03-14).
