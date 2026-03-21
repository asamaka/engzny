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

Follow these steps IN ORDER.

### Step 0 — Load State

1. Read `tv-briefing/news-profile.json` for user preferences
2. Fetch current briefing: `curl -s https://www.thinx.fun/api/tv/briefing`
3. Note `storyTracker` — ongoing stories needing fresh coverage
4. Note `watchLog` — videos already watched (don't re-feature)
5. Note `agentRunAt` — how stale is the current briefing?
6. Optionally check TV health: `curl -s https://www.thinx.fun/api/tv/health`

### Step 1 — Top Bar Metrics + Live Feed Config

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

### Step 2 — Photo of the Day

Pick a photo that is **NOT** directly related to the user's explicit interests. Surprise, wonder, a window into a different world.

- Use Unsplash: search for a striking image
- `title`: what the viewer sees
- `caption`: one sentence giving context and inviting curiosity
- `internalReason`: why you picked it (not displayed)

**CRITICAL — Unsplash URL format:**

The image URL MUST use the **full photo ID** from Unsplash, not the short slug from the page URL.

```
CORRECT: https://images.unsplash.com/photo-1746424919575-af1c193de14d?auto=format&fit=crop&w=1600&q=80
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                          Full photo ID (timestamp-hash format)

WRONG:   https://images.unsplash.com/photo-7n6fKjUikCM?auto=format&fit=crop&w=1600&q=80
                                          ^^^^^^^^^^^
                                          This is the PAGE slug, NOT the image ID. Will return 404.
```

**How to get the correct URL:**
1. Find the photo on Unsplash (e.g. `unsplash.com/photos/some-title-7n6fKjUikCM`)
2. Fetch the page and look for the `<img>` tag or `og:image` meta — it contains the real photo ID
3. The real ID always looks like `photo-XXXXXXXXXX-XXXXXXXXXXXX` (a Unix timestamp dash a 12-char hash)
4. Build the URL: `https://images.unsplash.com/photo-{REAL_ID}?auto=format&fit=crop&w=1600&q=80`

**Validation — MUST do before uploading:**
```bash
curl -sf "${IMAGE_URL}" -o /dev/null -w "%{http_code}"
# Must return 200. If it returns 404 or anything else, the URL is wrong.
```

### Step 3 — News Curation + Video Search

**CRITICAL RULES:**
1. This is a TV. Users watch videos. Every video card MUST have a fresh, specific video covering the exact story. Never show old or tangentially related videos.
2. Never hide a curated story. If you picked it, it appears — as a video card (with qualifying video) or story card (text-only). Nothing is hidden from the user.
3. Your job is to be GOOD at finding videos. A story without a video is your failure, not the story's failure.

#### 3a. Gather Stories

Search the web for stories from the past 48 hours matching tier 1-2 interests from `news-profile.json`:

- Iran war: ALL angles — escalation, de-escalation, intelligence, political fractures
- Egypt crisis: fuel, energy, closures, Suez, calendar events
- AI breakthroughs: Claude, GPT — from Anthropic and OpenAI specifically
- AI institutional drama: Pentagon bans, CEO conflicts, real-consequence policy
- Tech layoffs / AI replacing workers
- Cultural calendar: Eid, Ramadan, Egyptian holidays (track Islamic calendar)
- Viral/dramatic: meteor, blackout, anything with "wow factor"
- Geopolitical drama: Cuba/Trump, dramatic world events
- Egyptian athletes: Salah milestones, historic achievements
- Champions League / European football
- Apple/Samsung launches
- AI hardware: NVIDIA, Tesla, Groq
- Y Combinator / startup signals
- Construction AI/robotics (NOT employer PR)

Score: `drama + novelty + personal_impact + conversation_worthy`

Aim for **8-12 stories**.

#### 3b. Video Search Per Story

For each story, search YouTube to find a fresh, specific video.

**How to search**: Use web search for `site:youtube.com <specific query>`. Extract video ID from the URL (`v=` param). Get metadata (title, channel, duration, publish date) from the page. Iterate with different queries.

**Video must:**
- Be published within 48h of the story
- Title references the specific event (not a general topic overview)
- Duration: 3-20min news, 1-10min sports highlights, 5-25min AI deep dives
- From a recognizable channel

**Outcome per story:**
- Video found → video card (with `videoId`, YouTube metadata, thumbnail)
- No video after thorough search → story card (`videoId: null`, headline + source + summary)
- NEVER use an old or loosely-related video

#### 3c. Video Search Playbook — Examples

**Geopolitics:**
```
Story: "US Sends 2,500 Marines as Ground Option Emerges"
Search: "site:youtube.com US marines Iran ground war 2026" → WION, 9:48, 12h old → QUALIFIES
```

**Tech:**
```
Story: "Tesla Launches Terafab"
Search: "site:youtube.com Tesla Terafab launch" → Bloomberg, 11:32, 6h old → QUALIFIES
Backup: "site:youtube.com Tesla AI chip factory March 2026"
Channels: CNBC, Bloomberg, The Verge, MKBHD
```

**Sports — DIFFERENT RULES** (user wants to SEE the goal, not hear about it):
```
Story: "Salah Scores 50th Champions League Goal"
WRONG: "Salah 50th goal news" → talking head → BAD
RIGHT: "Salah goal Liverpool highlights" → actual footage → GOOD

Search 1: "site:youtube.com Salah goal Liverpool highlights Champions League"
Search 2: "site:youtube.com Liverpool highlights UCL"
Channels: UEFA (official), Sky Sports, BT Sport, beIN
Duration: 1-10min. A 90-second goal clip is perfect.
```

**Sports search rules (override general rules):**
- Search for FOOTAGE first: "highlights", "goal", "replay"
- Short is good: 90-second highlight clips are ideal
- Include opponent + competition in query
- If footage unavailable, THEN try "post-match reaction"

**Local (Egypt):**
```
Search: "site:youtube.com Egypt fuel price increase 2026"
Also try Arabic: "اسعار البنزين مصر"
Channels: Al Jazeera English, BBC Arabic, Reuters, Egyptian Streets
```

**AI:**
```
Search: "site:youtube.com GPT-5.4 launch enterprise"
Channels: Matt Wolfe, AI Explained, Fireship, Two Minute Papers
```

**Key patterns:**
- Specific proper nouns + dates/years, not generic topic words
- Try the outlet's YouTube channel by name
- Know 3-5 reliable channels per beat
- For regional stories: try Arabic queries
- Search for the EVENT, then coverage OF the event only if footage isn't available

#### 3d. Ongoing Stories

Check `storyTracker`. For active stories (Iran war, energy crisis):
- Find NEW video about the LATEST development
- Never reuse the same video from a previous briefing
- Increment `updateCount`

#### 3e. Rotation

- Previous stories with `previousPosition` shift down
- Watched videos (in `watchLog`) push further down
- New stories get top positions
- Video cards always sort before story cards

### Step 4 — Breaking News Ticker

Curate `bannerItems` from the past 48h:
- `timestamp` for client-side time-decay
- `priority`: 100 = active alerts, 50 = context, lower = background
- `kind`: `"alert"`, `"breaking"`, `"context"`
- Include curated stories as ticker items too (additive to the wall)

### Step 5 — Build and Upload

1. Set `agentRunAt` and `generatedAt` to current UTC time in ISO format
2. Set `hero.greeting`: "Good Morning, Aser!" (05-11 Cairo), "Good Afternoon, Aser!" (12-16), "Good Evening, Aser!" (17-04)
3. Build the full JSON per the schema below
4. Write to a temp file
5. **Validate all image URLs before uploading** (photoOfDay, thumbnails):

```bash
# MUST return 200 for every image URL in the briefing
curl -sf "PHOTO_OF_DAY_URL" -o /dev/null -w "%{http_code}\n"
# If any URL returns non-200, fix it BEFORE uploading.
```

6. Upload:

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
      "imageUrl": "https://images.unsplash.com/photo-1746424919575-af1c193de14d?auto=format&fit=crop&w=1600&q=80",
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
      "previousPosition": null
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

  "watchLog": []
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
