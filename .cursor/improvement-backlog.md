# Continuous Improvement Backlog

Maintained by the Continuous Improvement Agent. Read at the start of every run, update before pushing.
**Keep this file under 80 lines.** Completed items belong in git history, not here.

## Last Run

> **2026-03-12** | Trigger: `healthcheck` | Fixed P1: hallucinated `imageUrl` from Sonar research leaking into cards — added `isValidUrl()` validation at both data-cleaning and enrichment stages.

## Active Work

### P1 — Degraded

- [ ] Sonar deep research often times out (20-25s) before pipeline cap (20s after enhance) — most breaking_news pipelines miss research enrichment entirely. Consider post-complete SSE card_updates so research results arrive late rather than never.
- [ ] Research-enriched verification sources all get identical generic snippets — same finding text copied to all sources. Low visual impact but noticeable on cards with 3+ sources.

### P2 — Meaningful Polish

- [ ] Render capture shows full-length card grid — consider viewport-height clipping for very long card lists
- [ ] `getCardTypeLabel` and `CARD_ICONS` for 6 newer card types are dead code — never called anywhere
- [ ] `completedCards` shows `None` in Redis sessions despite being sent by client — not extracted during persistence

### P3 — Low Priority (do not ship unless combined with higher-priority work)

- [ ] Adapter singleton cache uses module-level Map — could cause subtle issues across warm serverless invocations
- [ ] Verification sources from research URLs all get identical generic snippets from same finding

## Key Patterns (for context, not action items)

- 100% of users are mobile (iPhone, 393x852). All UI changes must be mobile-first.
- LLM field name mismatches are systemic — all card types with structured fields now have defensive normalization. If a new card type is added, it needs the same treatment.
- Sonar API returns citation markers `[1][2]` — stripped at storage time by `cleanResearchData()`.
- LLM-generated imageUrl/photoUrl are always hallucinated — stripped by `stripFabricatedImageUrls()` for enhance phase, validated by `isValidUrl()` for research phase.
- The CSS cascade fix (moving reset into `@layer base`) resolved all DaisyUI spacing issues. If spacing looks broken, check for unlayered CSS rules first.
- Pipeline durations are now 15-20s for typical content. Sonar deep research (20-25s) is the external bottleneck.
