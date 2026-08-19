# LLM Pipeline 2.0 Planning Report

**Generated:** 2026-03-15
**Based on:** Last 10 production pipeline runs (March 10-15, 2026)
**Branch:** `cursor/llm-pipeline-2-0-planning-3da8`

---

## Executive Summary

After reviewing all 10 recent pipeline runs — comparing user screenshots, LLM-generated content, verification results, and real-world information — the current pipeline produces **reasonably accurate headline extraction** but has **systemic weaknesses in verification depth, person identification, temporal awareness, and research integration**. This report catalogs every issue found and proposes the 2.0 pipeline architecture to fix them.

---

## Part 1: Run-by-Run Analysis

### Run 1: `fce0ac87` — Iran Missile Attacks (March 15)

**Screenshot:** Al Jazeera Egypt Facebook post. Arabic text reads: "Breaking | Israeli Channel 12: Iran launched attacks on Israel every 90 minutes since last night." Shows missile launch imagery with 44.2K reactions.

**What pipeline showed the user:**
- Hero: "Iran Launches Missile Attacks on Israel" — **Accurate extraction**
- Verification: "inconclusive" — Research found multiple salvos confirmed but the specific "90-minute interval" is NOT confirmed by any source. **Good nuance.**
- Person card: "Al Jazeera (Egypt Bureau)" — **WRONG.** This is a news outlet, not a person. The schema says person_card must be an individual.
- Location card: "Israel" — **Too generic.** The screenshot references Channel 12 and specific attack patterns; a card about specific targets (Eilat, Jerusalem, central Israel) from the research would be more useful.
- Timeline: Events listed with real research data — **Useful.**
- Research findings: Rich data from Times of Israel, Jerusalem Post with real URLs. **Strong.**

**Gap vs Reality:** The claim in the screenshot (90-minute interval) was correctly flagged as unverified. However, the pipeline's deep research DID find detailed information about 6+ salvos and specific locations but this wasn't surfaced well to the user. The verification card summary is overly long and repetitive.

**Score: 7/10** — Good headline, good verification caution, weak person card, verbose summaries.

---

### Run 2: `9f62965e` — IRGC Threatens Netanyahu (March 15)

**Screenshot:** Al Jazeera Mubasher Facebook post. Arabic text: "IRGC threatens to pursue and kill Netanyahu if he remains alive." Shows Netanyahu's photo with 3.3K reactions. Duration: 20s (hit timeout).

**What pipeline showed:**
- Hero: "Iran Guards Threaten Netanyahu Pursuit" — **Accurate.**
- Verification: Status "unconfirmed" with **0 research findings** (researchFindings: 0). All sources show "not_yet_reported." This means Sonar/research timed out or returned nothing. **Major gap.**
- Person card: "Benjamin Netanyahu" — **Correct** (one of the few correct person cards).
- Timeline: Fabricated placeholder data ("TBD", "Ongoing") — **Low value.**

**Gap vs Reality:** The IRGC statement was a real, widely-reported event. The pipeline failed to find ANY web corroboration because deep research timed out (20s ceiling). The user got no verification whatsoever on a highly verifiable claim.

**Score: 5/10** — Correct classification and person, but total research failure. User sees "unconfirmed" with zero evidence either way.

---

### Run 3: `30162e50` — Sharon Cohen-ofir Leadership Post (March 15)

**Screenshot:** Facebook post by "Sharon Cohen-ofir" in English: "Taking responsibility / How simple! / This is leadership!!!" Below it: a Channel N12 Hebrew news banner about a military official's responsibility. Also shows story bubbles and Booking.com ad.

**What pipeline showed:**
- Hero: "Leadership Demands Responsibility" — **Accurate extraction.**
- Person card: "Sharon Cohen-ofir" as "Facebook Content Creator" — **Partially correct** but the "notableInfo" says the pipeline couldn't find this person, and speculates it might be "Inspector Sharon Cohen" — **Unverified guess presented as content.**
- Quote card: Direct text extraction — **Accurate.**
- Fact check: Verdict "verified" on an opinion statement ("Taking responsibility is a defining characteristic of leadership") with confidence "low" — **Contradictory.** You can't "verify" an opinion.
- Did you know: "The post received 6 reactions" — **Trivially visible from screenshot.** No added value.
- URL used: `https://layoftheland.online/2023/10/` appears on multiple cards — **Irrelevant URL** that has nothing to do with this Facebook post.

**Gap vs Reality:** The N12 banner below the post (about a military chief of staff taking responsibility for not updating citizens about an attack) is **completely ignored** by the pipeline despite being the most newsworthy content visible. The pipeline fixated on the simple Facebook post above and missed the actual breaking news beneath it.

**Score: 4/10** — Missed the real story (N12 news banner), fabricated URLs, trivial did-you-know, contradictory fact-check.

---

### Run 4: `caea5011` — NK Missile Launch (March 14)

**Screenshot:** Al Jazeera Channel Facebook post. Arabic text: "New escalation in East Asia.. #Japan raises alert level after North Korean ballistic missile launch." Shows missile launch imagery.

**What pipeline showed:**
- Hero: "Japan Raises Alert After NK Missile" — **Accurate translation.**
- Verification: "inconclusive" — Research correctly found that **no major outlets confirmed a March 14 launch**; verified launches were from January 2026. **Excellent fact-checking.** The pipeline correctly identified this could be a recycled/outdated claim.
- Person card: "Japanese Prime Minister" — **WRONG.** Generic title, not a named individual. Should have been Shigeru Ishiba or skipped entirely.
- Research URLs: All point to January 2026 articles — **Correctly identifying the temporal discrepancy.**

**Gap vs Reality:** This is arguably the pipeline's **best verification performance**. It correctly caught that the claim couldn't be confirmed for March 14 and all evidence pointed to January launches. The user gets an honest "this might be old news being recirculated." However, the person_card is still broken.

**Score: 8/10** — Excellent verification, caught potential misinformation. Person card still broken.

---

### Run 5: `f2e3213a` — Melbourne Best City 2026 (March 14)

**Screenshot:** Arabic Facebook post with Melbourne skyline photo celebrating Melbourne being named Time Out's best city for 2026. Mentions 44 criteria, Sydney at #21, Adelaide at #29.

**What pipeline showed:**
- Hero: "Melbourne Wins Best City 2026" — **Accurate.**
- Verification status: "confirmed" with a direct link to timeout.com — **Correct and verified.**
- Person card: "Time Out Editorial" — **WRONG.** An organization, not a person.
- Quote card: "We officially live in the best city in the world" attributed to "Australian City Residents" — **Fabricated attribution.** The actual post is by a specific user account.
- Fact check: Verdict "verified" but confidence "low" — **Contradictory again.** If verified, confidence should be high.
- Did you know: "Melbourne ranks 21st globally while Adelaide ranks 29th" — **WRONG and contradictory.** The whole article says Melbourne is #1, not #21. This appears to be confusing Sydney's ranking with Melbourne's.
- Location card: Added programmatically with correct data — **Good.**

**Gap vs Reality:** The core claim is correct and well-verified. But the did_you_know_card contains a factual error that directly contradicts the headline, the person_card misidentifies an organization as a person, and the fact_check has contradictory verdict/confidence. Research was strong overall — real URLs from timeout.com and ABC News.

**Score: 6/10** — Good verification on the main claim, but self-contradictory cards undermine trust.

---

### Run 6: `fb0258e2` — Iran Strikes Israel Overnight (March 13)

**Screenshot:** Al Jazeera Palestine Facebook post. Arabic text: "Breaking | Times of Israel from military sources: Iranian ballistic missile fired at central Israel tonight carried cluster warhead." Shows night sky with missiles/explosions. 5.5K reactions.

**What pipeline showed:**
- Hero: "Iran Strikes Israel Overnight" — **Accurate.**
- Verification: "verified" with "confirmed" from Al Jazeera Palestine and Al Jazeera Live — But the snippets for BOTH sources are **identical copy-paste text**. The summary even acknowledges "Confirmed only by Al Jazeera; no coverage from Reuters, AP, BBC, CNN." So it's marked "verified" when only one source family confirms it. **Over-confident verification.**
- Person card: "Al Jazeera Palestine" — **WRONG.** News outlet, not a person.
- Timeline: Fabricated approximate times ("~5 hours ago", "~3 hours ago") — **Low confidence data.**

**Gap vs Reality:** The screenshot specifically mentions "Times of Israel from military sources" as the original source, but the pipeline attributes everything to Al Jazeera. The actual claim about cluster warheads is a significant military detail that deserved its own verification. The verification card shows "verified" but the evidence only comes from one news network.

**Score: 5/10** — Over-confident verification, missed the actual source attribution (Times of Israel), identical copy-paste source snippets.

---

### Run 7: `7adc0c15` — Spain Recalls Ambassador (March 12)

**Screenshot:** Scoop Empire Facebook post with Spanish flag and Pedro Sánchez photo. Arabic text: "Spain withdraws its ambassador in Tel Aviv and reduces diplomatic representation in Israel." 204 reactions. Below: Al Jazeera Palestine post visible.

**What pipeline showed:**
- Hero: "Spain Recalls Ambassadors From Israel" — **Accurate.**
- Verification: "partially_verified" with sources from i24NEWS, CGTN, DW, Middle East Eye all confirmed. **Strong multi-source verification.** Correctly notes "unconfirmed by major Western sources yet."
- Person card: "Pedro Sánchez" — **CORRECT.** Identified the actual person in the photo.
- Location card: "Israel" with broken imageUrl field — Has a URL with commentary text appended: `"https://www.middleeasteye.net/news/spain-decides-remove-ambassador-israel-iran-war (photo of Pedro Sanchez)"` — **Broken URL with appended text.**

**Gap vs Reality:** This is one of the **best pipeline outputs overall.** The verification found 4 independent sources confirming the story, correctly identified it as a formal diplomatic action documented in Spain's Official State Gazette, and named the specific ambassador (Ana María Salomón Pérez). The person card is correct. The main issue is the fabricated imageUrl with text commentary.

**Score: 8/10** — Best verification, correct person, good detail. Minor URL formatting issue.

---

### Run 8: `7b72578c` — Iran Oil Tanker Attack (March 12)

**Screenshot:** Al Jazeera Mubasher Facebook post/video. Arabic text: "Breaking | IRGC: We targeted at dawn today an American oil tanker in Gulf waters for not complying with our naval warnings." Shows fire/explosion video. 3.4K reactions.

**What pipeline showed:**
- Hero: "Iran Claims US Oil Tanker Attack" — **Accurate. Good use of "Claims" for unverified assertion.**
- Verification: "partially_verified" — Found Xinhua, Times of Israel, Reuters (via KFGO) all reporting the IRGC claim. Correctly notes "independent confirmation of attack details pending." **Good nuanced verification.**
- Person card: "Iranian Revolutionary Guard" — **WRONG.** Organization, not a person. Should have been skipped or converted to source_card.
- Additional detail from research: Found the tanker names (Zefyros, Safesea Vishnu), casualty count (1 dead, 38 rescued), and the trigger event (US sinking of IRIS Dena). **Excellent contextual enrichment.**

**Gap vs Reality:** Research quality is high — found the specific tanker names, flags, and contextual events. The verification correctly distinguishes between "IRGC claims" and independently confirmed facts. The main failure is the person_card.

**Score: 7/10** — Strong research and verification, correct "claims" framing, broken person_card.

---

### Run 9: `052f92cb` — Trump Iran Nuclear Statement (March 11)

**Screenshot:** Al Jazeera Egypt Facebook post. Arabic text: "Breaking | Trump: Iran must remove any mines it has planted in the Strait of Hormuz immediately." Shows Trump speaking at "Shield of the Americas Doral 2026" event. 20.9K reactions.

**What pipeline showed:**
- Hero: "Trump Demands Iran Nuclear Elimination" — **INACCURATE TRANSLATION.** The Arabic says "mines" (ألغام, alghaam — naval mines), NOT "nuclear weapons." The pipeline hallucinated "nuclear" from context/bias. The actual claim is about maritime mines in the Strait of Hormuz.
- Verification: Looking for "nuclear weapons" claims — **Searching for the wrong thing** because the initial translation was wrong.
- Person card: "Donald Trump" as "Former U.S. President" — **Partially wrong.** Trump is the current president (as of March 2026), not "former."
- Location card: "Doral, Florida" — **Correct, visible in screenshot.**
- Research: Found White House page about "74 times Trump said Iran cannot have nuclear weapon" — **Confirming the wrong claim** because the original translation error cascaded.

**Gap vs Reality:** This is the **most critical failure in the dataset.** The Arabic word "ألغام" (mines) was mistranslated as "nuclear weapons," which completely changed the meaning of the news. The screenshot is about Trump demanding Iran remove naval mines from the Strait of Hormuz — a maritime/military demand. The pipeline turned it into a nuclear proliferation story. Every subsequent card and verification searched for the wrong thing. This is a cascading translation error at Phase 1 (Haiku classification).

**Score: 2/10** — Critical mistranslation cascaded through entire pipeline. Every card is about the wrong topic.

---

### Run 10: `6c8dbee9` — Iran Hormuz Passage Deal (March 10)

**Screenshot:** Middle East Monitor (MEMO) Facebook post in English: "Iran announces that any Arab or European country that expels Israeli and US ambassadors will be granted free passage through the Strait of Hormuz." 136K reactions, 10.9K comments. Below: Al-Arabiya Palestine post.

**What pipeline showed:**
- Hero: "Iran Offers Strait Passage Deal" — **Accurate.**
- Verification: "unconfirmed" with all sources "not_yet_reported" and snippets all saying "Unable to verify — check source directly" — **Zero research results.** Research timed out at 20s with 0 findings.
- Person card: "Iran (Government)" — **WRONG.** A government entity, not a person.
- Timeline: Shows dates as "Mar 9, 2024" — **WRONG YEAR.** Should be 2026, not 2024. Temporal confusion.
- Did you know: Strait of Hormuz facts — **Relevant and interesting.** One of the better did_you_know entries.

**Gap vs Reality:** The MEMO post is in English and easily verifiable. However, deep research returned zero findings and timed out. The user gets zero verification on a viral post (136K reactions). The year error (2024 instead of 2026) is a significant temporal confusion that erodes trust.

**Score: 4/10** — Correct headline but zero verification, wrong year, non-person person_card.

---

## Part 2: Systemic Issues Found

### Issue 1: CRITICAL — Translation Errors Cascade
**Frequency:** 1/10 runs (052f92cb), but catastrophic when it occurs
**Root cause:** Haiku classification translates Arabic to English in one shot with no verification. A single mistranslation ("mines" → "nuclear weapons") corrupts the entire pipeline — every downstream card, research query, and verification searches for the wrong thing.
**Impact:** User sees a completely fabricated news story.

### Issue 2: HIGH — Deep Research Timeout/Failure
**Frequency:** 3/10 runs returned 0 research findings (9f62965e, 6c8dbee9 had 0 findings; fb0258e2 had research but only from one source family)
**Root cause:** Sonar deep research often exceeds the 20-second pipeline cap and gets killed before returning results. Research runs in parallel with enhancement, but the pipeline has a hard ceiling.
**Impact:** User sees "unconfirmed" or "not_yet_reported" with zero evidence, even for easily verifiable claims.

### Issue 3: HIGH — Person Card Misidentification
**Frequency:** 7/10 runs had incorrect person cards (organizations, outlets, or generic titles)
**Root cause:** The layout's `suggestedCards` for `breaking_news` always includes `person_card`. The LLM fills it with whatever entity is most prominent — usually the news source — rather than leaving it empty. Recently fixed in prompts but the fix hasn't propagated to all runs.
**Impact:** "Al Jazeera Palestine" shown as a "person" with a profile card. Looks broken.

### Issue 4: MEDIUM — Verification Confidence Inconsistencies
**Frequency:** 3/10 runs had contradictory verdict/confidence combos
**Root cause:** `fact_check` cards show "verified" + "low confidence" or verification_card shows "verified" with only one source family. The LLM's confidence scoring doesn't follow consistent rules.
**Impact:** User sees conflicting signals — "Verified!" but also "Low confidence."

### Issue 5: MEDIUM — Template Uniformity (Breaking News Monotony)
**Frequency:** 8/10 runs are `breaking_news` layout with identical card structure
**Root cause:** The layout always uses the same 7 cards: hero, verification, person, location, timeline, news, did_you_know. This is correct for the content type but means every run looks nearly identical regardless of the actual story.
**Impact:** User experience feels repetitive. Stories about missile attacks look the same as stories about city rankings.

### Issue 6: MEDIUM — Duplicate/Verbose Verification Summaries
**Frequency:** 5/10 runs had excessively long or repetitive verification summaries
**Root cause:** Multiple research findings get concatenated without deduplication. The `deduplicateSentences()` function exists but doesn't catch all patterns (e.g., same fact attributed to different sources).
**Impact:** Verification card text is overwhelming and hard to read on mobile.

### Issue 7: LOW — Temporal Confusion
**Frequency:** 2/10 runs (6c8dbee9 shows "2024" instead of "2026"; 052f92cb says "Doral 2024" instead of "Doral 2026")
**Root cause:** LLM confuses or defaults to training-data year rather than current year.
**Impact:** Dates shown to user are wrong, reducing trust.

### Issue 8: LOW — Irrelevant/Broken URLs
**Frequency:** 3/10 runs had clearly wrong URLs (30162e50 linked to layoftheland.online for a Facebook post; 7adc0c15 had URL with appended text commentary)
**Root cause:** Deep research sometimes returns loosely-related URLs. The URL validation only checks format, not relevance. Also, LLM appends descriptive text to URLs.
**Impact:** User clicks link and gets unrelated content.

### Issue 9: LOW — Missing Multi-Content Detection
**Frequency:** 1/10 runs (30162e50 — missed N12 news banner below Facebook post)
**Root cause:** Pipeline classifies the screenshot as ONE content type and focuses on the first/primary content. When screenshots contain multiple distinct pieces of content (a Facebook post AND a news banner), only one gets analyzed.
**Impact:** The most newsworthy content in the screenshot gets ignored.

### Issue 10: LOW — Did-You-Know Quality
**Frequency:** 3/10 runs had trivially obvious or self-contradictory facts
**Root cause:** The LLM sometimes generates facts that repeat what's visible in the screenshot, contradict the main content, or state widely known information.
**Impact:** Card feels like filler rather than genuinely interesting content.

---

## Part 3: Current Pipeline Flow (v1) vs Proposed 2.0

### Current Flow (v1)
```
Screenshot → Haiku classify (1-2s) → Skeleton cards → Sonnet enhance (12-18s) + Sonar research (parallel, 20s cap)
                                                        ↓                              ↓
                                                   Card updates via SSE          Wire to verification cards
                                                        ↓
                                                   Complete (15-20s total)
```

**Problems:**
1. Translation happens once in Haiku with no verification step
2. Research and enhancement race — research often loses
3. Card types are fixed by layout template, not by actual content
4. Single-pass enhancement with no self-review
5. No multi-content detection

### Proposed Pipeline 2.0

```
Screenshot → Phase 0: Smart Pre-Analysis (2-3s)
  ├─ Content detection: How many distinct stories/items in this screenshot?
  ├─ Language detection + careful translation (if non-English)
  ├─ Temporal anchor: What date/time context is shown?
  └─ Source attribution: Who is making this claim?

→ Phase 1: Verified Classification (1-2s)
  ├─ Content type + layout selection
  ├─ Cross-check translation against visible text elements
  └─ Generate research queries (specific, not generic)

→ Phase 2: Parallel Execution (run simultaneously)
  ├─ 2a: Card Population (Sonnet with tool_use, 10-15s)
  │    - Populate cards from screenshot data
  │    - Skip person_card if no named individual visible
  │    - Dynamic card selection (not template-fixed)
  │
  ├─ 2b: Deep Verification (Sonar/Perplexity, up to 30s)
  │    - Source-specific searches (e.g., "Reuters Iran missile March 2026")
  │    - Date-anchored queries (always include current date)
  │    - Multi-source cross-referencing
  │
  └─ 2c: Translation Verification (for non-English, 2-3s)
       - Second model verifies Phase 0 translation
       - Flag discrepancies before they cascade

→ Phase 3: Research Integration (2-3s)
  ├─ Wire research findings to verification cards
  ├─ Correct any facts contradicted by research
  ├─ Add source URLs to relevant cards
  └─ Self-consistency check (do cards contradict each other?)

→ Phase 4: Quality Gate (0.5-1s, no LLM)
  ├─ Verify person_card has a real person (not org/outlet)
  ├─ Check verdict/confidence coherence
  ├─ Validate all URLs are well-formed
  ├─ Ensure did_you_know doesn't repeat visible info
  ├─ Check year/date consistency
  └─ Truncate verbose summaries
```

---

## Part 4: Specific 2.0 Recommendations

### R1: Two-Pass Translation with Verification
**Problem it solves:** Issue 1 (catastrophic mistranslation)
**Implementation:**
- Phase 0: Haiku does initial translation + classification
- Phase 2c: A second, independent model (or same model with different prompt) re-translates the key Arabic/Hebrew text
- If translations disagree on any key term, flag it and use the more conservative/literal translation
- For the `052f92cb` case: "ألغام" should always translate to "mines" not "nuclear weapons"

### R2: Decouple Research from Pipeline Timeout
**Problem it solves:** Issue 2 (research timeout)
**Implementation:**
- Allow research to continue after the main pipeline completes
- Send initial cards without research, then send `card_update` SSE events as research arrives (even after "complete")
- Change pipeline completion from "everything done" to "cards shown, research may still arrive"
- Use a "research_pending" → "research_complete" status indicator
- Extend research timeout to 30-45 seconds independently of card population

### R3: Dynamic Card Selection (Not Template-Fixed)
**Problem it solves:** Issue 3 (person_card misidentification), Issue 5 (template monotony)
**Implementation:**
- Don't force `person_card` for every breaking_news layout
- Let the enhancer LLM decide which card types to use based on actual content
- If no named individual is visible, skip person_card entirely
- Consider `source_card` for news outlets instead of forcing them into person_card
- Allow the LLM to propose 4-7 cards from the full card type menu rather than filling a template

### R4: Self-Consistency Validation Pass
**Problem it solves:** Issue 4 (contradictory verdicts), Issue 10 (bad did-you-know)
**Implementation:**
- After all cards are populated, run a fast programmatic check:
  - `fact_check` verdict="verified" requires confidence="high" or "medium"
  - `did_you_know` fact must not contain words from the hero title (too obvious)
  - `did_you_know` fact must not contradict any other card
  - `verification_card` status must match the aggregate of its source statuses
  - Check year is 2026 not 2024/2025

### R5: Date-Anchored Research Queries
**Problem it solves:** Issue 7 (temporal confusion), Issue 2 (research finding old results)
**Implementation:**
- Always inject "as of [current date]" into research queries
- For breaking news: search for "[event] [today's date]" specifically
- Research query template: `"{claim}" site:reuters.com OR site:bbc.com OR site:apnews.com {month} {year}`
- Reject research results older than 7 days for breaking_news content type

### R6: Multi-Content Detection
**Problem it solves:** Issue 9 (missing N12 banner)
**Implementation:**
- Phase 0 asks: "How many distinct pieces of content are visible? List each one."
- If multiple content items are detected, either:
  a) Analyze the most newsworthy one (with a note about other content)
  b) Create a "multi-story" layout with mini-cards for each item
- For the `30162e50` case: detect both the Facebook post AND the N12 news banner

### R7: Post-Pipeline Research Delivery
**Problem it solves:** Issue 2 (research returns nothing because it timed out)
**Implementation:**
- After pipeline completes, if research has 0 findings, queue a background research job
- Research results arrive via SSE `card_update` events 10-30 seconds later
- Frontend shows a subtle "checking sources..." indicator that resolves when research arrives
- This turns research from "now or never" to "eventually consistent"

### R8: URL Relevance Validation
**Problem it solves:** Issue 8 (irrelevant/broken URLs)
**Implementation:**
- After receiving URLs from research, validate:
  - URL is well-formed (no appended text)
  - URL domain is relevant to the content (news domains for news)
  - URL path contains keywords related to the topic
- Strip anything after the URL that isn't part of the path/query
- Maintain a allowlist of trusted news domains

---

## Part 5: Scoring Summary & Priority Matrix

| Run ID | Content | Score | Key Issues |
|--------|---------|-------|------------|
| fce0ac87 | Iran missiles 90min | 7/10 | Wrong person card, verbose verification |
| 9f62965e | IRGC threatens Netanyahu | 5/10 | Zero research (timeout), fabricated timeline |
| 30162e50 | Leadership Facebook post | 4/10 | Missed real story (N12), trivial did_you_know, wrong URLs |
| caea5011 | NK missile launch | 8/10 | Excellent verification, caught recycled news |
| f2e3213a | Melbourne best city | 6/10 | Self-contradictory did_you_know, org as person |
| fb0258e2 | Iran strikes overnight | 5/10 | Over-confident verification, duplicate snippets |
| 7adc0c15 | Spain recalls ambassador | 8/10 | Best overall output, correct person, multi-source |
| 7b72578c | Iran oil tanker | 7/10 | Strong research, correct "claims" framing |
| 052f92cb | Trump mines/nuclear | 2/10 | **CRITICAL:** Mistranslation cascaded everywhere |
| 6c8dbee9 | Iran Hormuz passage | 4/10 | Zero research, wrong year (2024) |
| **Average** | | **5.6/10** | |

### Priority Matrix for 2.0

| Priority | Issue | Fix | Impact | Effort |
|----------|-------|-----|--------|--------|
| **P0** | Translation cascade | R1: Two-pass translation | Prevents catastrophic errors | Medium |
| **P0** | Research timeout | R2 + R7: Decouple + post-pipeline delivery | 30% of runs get zero research | High |
| **P1** | Person card misuse | R3: Dynamic card selection | 70% of runs affected | Low |
| **P1** | Verdict inconsistency | R4: Self-consistency validation | 30% of runs affected | Low |
| **P2** | Temporal confusion | R5: Date-anchored queries | 20% of runs affected | Low |
| **P2** | Template monotony | R3: Dynamic cards | UX improvement | Medium |
| **P3** | Multi-content detection | R6: Content counting in Phase 0 | 10% of runs affected | Medium |
| **P3** | URL quality | R8: URL relevance validation | 30% of runs affected | Low |

---

## Part 6: Replaying Old Images in 2.0

When rerunning old screenshots through the 2.0 pipeline, the key challenge is **temporal awareness.** A screenshot from March 10 about Iran's Hormuz announcement will get different research results on March 15 vs March 10. For a fair evaluation:

### Recommended Test Protocol

1. **Freeze the screenshot timestamp** — Include the original post date in the pipeline context
2. **Evaluate translation separately** — For Arabic/Hebrew screenshots, have the 2.0 translation step produce its output, then manually verify before allowing it to cascade
3. **Score on these dimensions:**
   - **Extraction accuracy:** Does the headline match the actual screenshot content?
   - **Translation fidelity:** For non-English content, is the translation correct?
   - **Verification honesty:** Does the pipeline correctly distinguish "verified," "unverified," and "contradicted"?
   - **Card relevance:** Do the chosen card types match what's actually in the screenshot?
   - **Research depth:** Does deep research find the right sources with correct information?
   - **Self-consistency:** Do cards not contradict each other?

### Baseline Test Set (from current runs)

These 10 screenshots should be the regression test suite for 2.0:

| # | Screenshot | Key 2.0 Test |
|---|-----------|-------------|
| 1 | Iran 90-min missiles | Can research find the specific interval claim? |
| 2 | IRGC Netanyahu threat | Can research complete within pipeline window? |
| 3 | Sharon Cohen-ofir post | Can multi-content detection find the N12 banner? |
| 4 | NK missile launch | Can pipeline detect potentially recycled/old news? |
| 5 | Melbourne best city | Can did_you_know avoid contradicting the headline? |
| 6 | Iran overnight strikes | Can verification avoid over-confidence with single source? |
| 7 | Spain ambassador recall | Baseline: already works well — don't regress |
| 8 | Iran oil tanker | Can person_card be correctly skipped for organizations? |
| 9 | Trump Hormuz mines | **CRITICAL:** Can translation correctly handle "ألغام" as "mines"? |
| 10 | Iran Hormuz passage | Can research complete even for viral posts? |

---

## Part 7: Implementation Roadmap

### Phase A: Quick Wins (1-2 days)
- [ ] R4: Self-consistency validation (programmatic, no LLM)
- [ ] R5: Date-anchored research queries (template change)
- [ ] R8: URL cleanup (strip appended text, validate format)
- [ ] Fix person_card enforcement in enhance prompt (partially done)

### Phase B: Core Architecture (3-5 days)
- [ ] R1: Two-pass translation verification
- [ ] R2: Decouple research timeout from pipeline timeout
- [ ] R3: Dynamic card selection instead of template-fixed

### Phase C: Research Enhancement (3-5 days)
- [ ] R7: Post-pipeline research delivery via SSE updates
- [ ] Source-specific verification queries
- [ ] Research result deduplication improvements

### Phase D: Advanced (1 week+)
- [ ] R6: Multi-content detection
- [ ] Replay test suite with all 10 screenshots
- [ ] A/B comparison of v1 vs v2 outputs
- [ ] User satisfaction signals

---

*End of report. This document should serve as the specification and test plan for the 2.0 pipeline launch.*
