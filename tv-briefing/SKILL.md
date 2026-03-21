# TV Briefing — Cloud Agent Playbook

You are a cloud Cursor agent running on the `engzny` repo. Your job: research fresh news, find YouTube videos, and push a briefing JSON to the thinx.fun API. A Samsung TV app polls that API and displays the content. You never touch the TV.

## What You Have

| Resource | Location | Notes |
|----------|----------|-------|
| User profile | `tv-briefing/news-profile.json` | Interests, demographics, scoring model |
| Example briefing | `tv-briefing/briefing-example.json` | Reference for the JSON schema |
| Upload API | `POST https://www.thinx.fun/api/tv/briefing` | Auth: `Bearer <token>` |
| Current briefing | `GET https://www.thinx.fun/api/tv/briefing` | Read current state before updating |
| TV health | `GET https://www.thinx.fun/api/tv/health` | Feed status, user interactions, errors |
| API token | `tv-briefing/.env` | Contains `TV_BRIEFING_TOKEN=...` — source it before uploading |

## Quick Start

```bash
# 1. Load token
source tv-briefing/.env

# 2. Read current state
curl -s https://www.thinx.fun/api/tv/briefing > /tmp/current-briefing.json

# 3. After building the new briefing JSON:
curl -X POST "https://www.thinx.fun/api/tv/briefing" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TV_BRIEFING_TOKEN" \
  -d @/tmp/new-briefing.json
# Expect: {"ok":true}
```

---

## Content Generation Pipeline

Follow these steps IN ORDER. The order matters — you research fresh news FIRST, then merge with existing state. Never start from the old briefing.

### Step 0 — Check TV Health & User Activity (MANDATORY)

**This is the most important step. Do it first.**

1. Fetch TV health: `curl -s https://www.thinx.fun/api/tv/health`
2. Parse the `recentLog` entries. Look for these event types:
   - `user-play-video` → User watched this video. Add `videoId` to `watchLog`. Do NOT re-feature this exact video.
   - `user-switch-video` → User switched to this video mid-playback. Also counts as watched.
   - `user-select-story` → User clicked a story card (especially one without a video). This is HIGH SIGNAL — the user wanted to engage but couldn't watch. Try harder to find a video for this topic next time.
   - `user-navigate` → User scrolled to this story. Frequent returns to the same card = interest. Cards never navigated to = low interest.
   - `user-close-video` → User closed video player.
3. Build a picture of what the user has already seen, what they tried to watch but couldn't, and what they skipped.
4. Note any `feedErrors` or `render-*-fail` errors.

**Use this data to:**
- Populate `watchLog` with watched videoIds (prevent re-featuring)
- Prioritize finding videos for stories the user clicked but couldn't watch
- Drop stories the user scrolled past repeatedly without engaging
- Bring in fresh angles on topics the user showed strong interest in

### Step 1 — Read Profile & Current State

1. Read `tv-briefing/news-profile.json` for user preferences
2. Fetch current briefing: `curl -s https://www.thinx.fun/api/tv/briefing`
3. Note `storyTracker` — ongoing stories needing fresh coverage
4. Note `watchLog` — videos already watched (don't re-feature)
5. Note `agentRunAt` — how stale is the current briefing?
6. **DO NOT start building the new briefing from the old one.** The old briefing is reference only.

### Step 2 — Fresh News Research (INDEPENDENT of old briefing)

**CRITICAL: Research the news FIRST, then merge with existing state. Do NOT start by looking at the old stories and updating them.**

Start with a wide sweep of the user's tier 1-2 interests from `news-profile.json`. Search the web broadly:

- What happened in the world in the last 48 hours?
- What's the biggest story right now?
- What would this specific user care about based on their profile?

Score each story: `drama + novelty + personal_impact + conversation_worthy`

**Search categories (open-ended, not a fixed list):**
- Start with "top news today" / "breaking news" to catch stories you'd never predict
- Then sweep each tier-1 interest area for fresh developments
- Look for NEW stories that weren't in the previous briefing at all
- Check if any previous ongoing stories have had significant NEW developments

Aim for **8-12 stories**.

**After gathering stories, THEN merge with existing state:**
- Ongoing stories from `storyTracker` that have new developments → keep and update
- Old stories with no new angle and already seen by user → drop
- Old stories the user engaged with (from health data) but need better coverage → improve
- Brand new stories → add at top priority

### Step 3 — Top Bar Metrics + Live Feed Config

Set **up to 4 contextual metric pills** in `header.metrics`:
- Holiday/calendar context (Hijri calendar, Egyptian holidays, Eid)
- Latest sports results for Liverpool / Egyptian national team
- Local Cairo alerts (closures, regulations, events)
- Notable data points the user would care about today

Configure `liveFeeds` — API URLs the TV app polls independently:

| Feed | URL | Parser | Refresh |
|------|-----|--------|---------|
| Weather | `https://api.open-meteo.com/v1/forecast?latitude=30.04&longitude=31.24&current=temperature_2m,apparent_temperature,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=Africa%2FCairo&forecast_days=1` | `openmeteo` | 1800s |
| Crypto | `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true` | `coingecko` | 600s |
| Sports | `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard` | `espn` | 120s |
| Breaking news | `https://saurav.tech/NewsAPI/top-headlines/category/general/us.json` | `saurav-news` | 900s |
| Self-refresh | `https://www.thinx.fun/api/tv/briefing` | `self` | 300s |

All keyless. Change the ESPN league path based on what's playing today:
- Premier League: `eng.1`, Champions League: `uefa.champions`, Egyptian: `egy.1`, La Liga: `esp.1`

Set `header.weather` with approximate current Cairo weather as fallback (TV shows this until live feed loads).

### Step 4 — Photo of the Day

Pick a photo that is **NOT** directly related to the user's explicit interests. Surprise, wonder, a window into a different world.

- Use Unsplash: search for a striking image, use URL format `https://images.unsplash.com/photo-XXXXX?auto=format&fit=crop&w=1600&q=80`
- `title`: what the viewer sees
- `caption`: one sentence giving context and inviting curiosity
- `internalReason`: why you picked it (not displayed)

### Step 5 — Video Search (AGENTIC, not keyword scripting)

**YOUR #1 JOB IS FINDING VIDEOS. This is a TV. The user watches things.**

Target: **at least 60-70% of stories should have videos.** If you have 10 stories, at least 6-7 should be video cards. A story without a video is your failure.

#### 5a. Think Like a Human, Not a Search Script

Before searching, THINK about each story:
- **Who would cover this on YouTube?** Think specific channels, not keywords.
- **What would the video title look like?** YouTube titles are clickbaity — imagine the actual title.
- **Is this a "footage" story or an "analysis" story?** Sports = footage. War = both. AI = analysis/explainer.
- **What language might coverage be in?** Egypt stories → Arabic channels. War → English + Hindi news.

#### 5b. Search Strategy Per Story (do ALL of these, not just the first one)

For each story, try **at least 3 different search approaches** before giving up:

1. **Channel-first search**: Search for the topic on a specific known channel.
   ```
   "WION Iran war" or "CNBC tech layoffs" or "Sky Sports Liverpool"
   ```

2. **Title-guess search**: Imagine what the actual YouTube title would be and search for that.
   ```
   "Iran fires missiles Diego Garcia" (not "Iran war update")
   "Atlassian cuts 1600 jobs AI" (not "tech layoffs 2026")
   ```

3. **Recency-focused search**: Add time markers.
   ```
   "Iran war today" or "Iran war March 21"
   ```

4. **Alternative angle search**: Same story, different framing.
   ```
   Story: "Oil prices surge 50%"
   Try: "oil price crisis Hormuz" AND "gas prices America 2026" AND "oil market analysis"
   ```

5. **Regional/language search**: Try non-English queries for regional stories.
   ```
   "مصر اغلاق المحلات" (Egypt shop closures in Arabic)
   ```

6. **Fetch the video page** to verify: date, duration, channel, and that it actually covers YOUR story (not a tangential topic).

#### 5c. Known Reliable YouTube Channels by Beat

Use these as starting points — search for the topic ON these channels:

| Beat | Channels |
|------|----------|
| Geopolitics/War | WION, NDTV, CNN, BBC News, Al Jazeera English, DW News, Firstpost, Hindustan Times |
| US Politics | Forbes Breaking News, NBC News, ABC News, CBS News, Fox News |
| AI/Tech | Fireship, Matt Wolfe, AI Explained, Two Minute Papers, TheAIGRID, Dave's Garage |
| Tech Business | CNBC, Bloomberg, The Verge, TechCrunch, Linus Tech Tips |
| Football/Sports | Sky Sports, BT Sport, beIN Sports, CBS Sports Golazo, DAZN, Liverpool FC official |
| Egypt/Arabic | Al Jazeera Arabic, BBC Arabic, Egyptian Streets, MBC |
| Science/Viral | Veritasium, SmarterEveryDay, Tom Scott, Mark Rober |
| Construction/Industry | B1M, The Practical Engineer, Machine Herald |

#### 5d. Video Requirements — Freshness Is Non-Negotiable

**The 48-hour rule is HARD. Do not rationalize stale videos.**

A video published 6+ days ago about the "same topic" is NOT acceptable even if it's high-quality. The TV must feel like RIGHT NOW, not "here's a good explainer from last week." A fresh story card always beats a stale video card.

**Video must:**
- Be published within 48h of NOW (not 48h of the story — of the current briefing generation time)
- Title references the specific event (not a general topic overview)
- Duration: 3-20min news, 1-10min sports highlights, 5-25min AI deep dives
- From a recognizable channel (not spam/clickbait)

**Freshness hierarchy (in order of preference):**
1. Video published today covering today's development → BEST
2. Video published yesterday covering yesterday's development → GOOD
3. Video published 2 days ago on a still-active story → ACCEPTABLE (edge of window)
4. Video published 3+ days ago → REJECT, even if it's the best video ever made on the topic
5. No qualifying video found → Story card (this is FINE — a fresh story card beats a stale video)

**Duration exceptions:**
- Sports highlights: 90 seconds is PERFECT. Short clips of actual goals/plays are ideal.
- Breaking news: 30-second clips from major outlets are acceptable if they show actual footage.
- Deep dives: Up to 30 minutes for exceptionally well-produced content.

**Common trap to avoid:**
You find a 15-minute DW News deep dive on Hormuz from 10 days ago. It's brilliant analysis. You want to include it because it's "still relevant." DON'T. The Hormuz situation 10 days ago is materially different from today. Find a video about TODAY's Hormuz development, or make it a story card.

**Outcome per story:**
- Fresh video found (within 48h) → video card
- No fresh video after thorough search (3+ approaches) → story card (`videoId: null`)
- NEVER use a stale video to inflate the video card ratio

**Ratio target vs freshness:** The 60-70% video card ratio is a GOAL, not a rule. Freshness always wins. A 40% ratio with all-fresh content is better than 60% padded with week-old videos. Breaking news cycles naturally have fewer videos — that's expected.

#### 5e. Sports Video Rules (OVERRIDE general rules)

The user wants to SEE the goal, not hear about it.

```
Story: "Salah Scores 50th Champions League Goal"
WRONG: "Salah 50th goal news" → talking head → BAD
RIGHT: "Salah goal Liverpool highlights" → actual footage → GOOD

Search 1: "Liverpool Galatasaray highlights all goals"
Search 2: "Salah goal Champions League" on Sky Sports / BT Sport channel
Search 3: "Liverpool 4-0 Galatasaray" (just the scoreline — often in titles)
Search 4: CBS Sports Golazo channel (they post extended UCL highlights)
Search 5: beIN Sports, DAZN (alternative broadcasters)
```

- Search for FOOTAGE first: "highlights", "goal", "replay", "all goals"
- Short is GOOD: 90-second highlight clips are ideal
- Include opponent + competition + scoreline in query
- If footage unavailable, THEN try "post-match reaction" or "analysis"

#### 5f. Ongoing Stories

Check `storyTracker`. For active stories (Iran war, energy crisis):
- Find NEW video about the LATEST development (not the same angle as before)
- Never reuse a video from `watchLog`
- Increment `updateCount`

#### 5g. Rotation

- Watched videos (in `watchLog`) → these stories need a FRESH video or get pushed down
- Stories the user selected/clicked → find a video this time
- New stories get top positions
- Video cards always sort before story cards
- Previous stories with `previousPosition` shift down if no new development

### Step 6 — Breaking News Ticker

Curate `bannerItems` from the past 48h:
- `timestamp` for client-side time-decay
- `priority`: 100 = active alerts, 50 = context, lower = background
- `kind`: `"alert"`, `"breaking"`, `"context"`
- Include curated stories as ticker items too (additive to the wall)

### Step 7 — Build and Upload

1. Set `agentRunAt` and `generatedAt` to current UTC time in ISO format
2. Set `hero.greeting`: "Good Morning, Aser!" (05-11 Cairo), "Good Afternoon, Aser!" (12-16), "Good Evening, Aser!" (17-04)
3. Build the full JSON per the schema below
4. Write to a temp file
5. Upload:

```bash
source tv-briefing/.env
curl -X POST "https://www.thinx.fun/api/tv/briefing" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TV_BRIEFING_TOKEN" \
  -d @/tmp/new-briefing.json
```

6. Verify: expect `{"ok":true}`. If 401, check `tv-briefing/.env` has the correct token.

The TV picks up the new briefing within 5 minutes automatically.

---

## Briefing JSON Schema

The JSON is a **complete replacement** every time — include ALL fields.

`tag` must be exactly one of: `Breaking`, `Tech`, `AI`, `Sports`, `Local`, `Career`, `Follow` (case-sensitive).

See `tv-briefing/briefing-example.json` for a full working example. Here's the structure:

```jsonc
{
  "agentRunAt": "2026-03-21T19:00:00+02:00",
  "generatedAt": "2026-03-21T19:00:00+02:00",
  "timezone": "Africa/Cairo",
  "location": { "city": "New Cairo", "country": "Egypt" },

  "liveFeeds": {
    "weather":      { "url": "...", "refreshSeconds": 1800, "parser": "openmeteo" },
    "crypto":       { "url": "...", "refreshSeconds": 600,  "parser": "coingecko", "display": { "label": "Bitcoin", "prefix": "$", "changeKey": "usd_24h_change" } },
    "sports":       { "url": "...", "refreshSeconds": 120,  "parser": "espn", "display": { "label": "Liverpool", "teamFilter": "Liverpool" } },
    "breakingNews": { "url": "...", "refreshSeconds": 900,  "parser": "saurav-news" },
    "briefing":     { "url": "https://www.thinx.fun/api/tv/briefing", "refreshSeconds": 300, "parser": "self" }
  },

  "header": {
    "weather": { "temperatureC": 28, "feelsLikeC": 30, "condition": "Clear", "highC": 32, "lowC": 20 },
    "metrics": [
      { "id": "unique-id", "label": "LABEL", "title": "Detail", "value": "VALUE", "changeText": "subtext", "trend": "up|down|flat" }
    ]
  },

  "hero": {
    "greeting": "Good Evening, Aser!",
    "context": "Brief 1-2 sentence summary of the past 48 hours...",
    "photoOfDay": {
      "imageUrl": "https://images.unsplash.com/photo-...",
      "title": "Visible title",
      "caption": "One-sentence story",
      "internalReason": "Why you picked this (NOT displayed)"
    }
  },

  "videoRecommendations": [
    {
      "id": "unique-story-id",
      "storyTitle": "News headline",
      "storyContext": "One-line relevance to the user",
      "tag": "Breaking",
      "label": "Short label",
      "ongoingStory": false,
      "ongoingStoryId": null,

      "videoId": "YouTube video ID or null",
      "videoTitle": "Actual YouTube title or null",
      "videoChannel": "Actual YouTube channel or null",
      "videoPublishedAt": "ISO timestamp or null",
      "videoDurationText": "9:48 or null",
      "videoDurationSeconds": 588,
      "thumbnailUrl": "https://i.ytimg.com/vi/VIDEO_ID/hqdefault.jpg or null",

      "storySummary": "1-2 sentence summary (for story cards without video)",
      "storySource": "News outlet name",
      "storyPublishedAt": "ISO timestamp",

      "searchQuery": "What you searched on YouTube",
      "searchIterations": 2,
      "internalReason": "Why you picked this (NOT displayed)",
      "previousPosition": null,
      "playable": true
    }
  ],

  "bannerItems": [
    {
      "id": "unique-id",
      "tag": "Alert|Breaking|Context|Live|Local|Follow",
      "text": "One-line alert text",
      "priority": 100,
      "kind": "alert",
      "timestamp": "ISO timestamp"
    }
  ],

  "storyTracker": {
    "story-slug": { "firstSeen": "2026-03-18", "updateCount": 5, "status": "active" }
  },

  "watchLog": ["videoId1", "videoId2"]
}
```

---

## User Profile Summary

From `tv-briefing/news-profile.json`:
- **Who**: 40yo Egyptian male, Cairo, CS degree. Senior Engineering Manager at Procore (construction tech). Lived in Australia and California.
- **Tier 1** (always include): Iran-Israel war, Egypt crisis news, AI model breakthroughs (Claude/GPT), AI institutional drama, tech layoffs
- **Tier 2** (strong interest): Cultural calendar (Eid/Ramadan), viral dramatic events, geopolitical drama, Egyptian athletes, Champions League, Apple/Samsung launches, NVIDIA/Tesla/Groq, YC signals
- **Tier 3** (moderate): Construction AI, space, cybersecurity policy
- **Scoring**: drama + novelty + personal_impact + conversation_worthy. NOT category alone.
