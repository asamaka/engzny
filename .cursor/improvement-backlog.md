# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history.

## Last Run

> **2026-03-13** | Prompt engineering overhaul — shifted from bug-hunting to product-judging. New philosophy: expected-vs-actual postmortem analysis, experiment-based decisions (10-20 similar reports before fixing), holistic product evaluation. Replaced html2canvas with dom-to-image-more, added viewport-cropped captures with metadata.

## Open Items

### P1 — Degraded

- [ ] Sonar deep research often times out before pipeline cap — most breaking_news pipelines miss research enrichment. Consider post-complete SSE card_updates so research arrives late rather than never.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid when viewport crop fails — consider improving foreignObject reliability
- [ ] `getCardTypeLabel` and `CARD_ICONS` for 6 newer card types are dead code — never called

### Experiments (gathering evidence)

Track patterns here. Log requestIds as evidence. When an experiment has 10-20 data points, it's ready to implement.

_No active experiments yet. Start logging patterns from report analysis._

**Template:**
```
## Experiment: [short description]
- Hypothesis: [what you think is happening and why]
- Evidence: [id1] [id2] [id3] ... (need 10-20 before acting)
- Status: gathering | confirmed | rejected
```

## Key Context (for reference, not action items)

- 100% of users are mobile (iPhone, 393x852). All changes must be mobile-first.
- LLM field name mismatches are systemic — all card types have defensive normalization now. Fix prompts before adding more fallback chains.
- Pipeline durations are 15-20s typically. Sonar deep research (20-25s) is the external bottleneck.
- CSS cascade: the `@layer base` reset fix resolved all DaisyUI spacing issues.
- Client screenshots now use viewport-cropped foreignObject capture with dom-to-image-more fallback. Capture metadata stored with reports for method evaluation.
