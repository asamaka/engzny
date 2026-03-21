---
description: Generate TV briefing content - news, videos, photos - and push to thinx.fun API
globs:
  - tv-briefing/**
alwaysApply: false
---

When asked to "update the briefing", "refresh the TV", "generate new content", "run the briefing", or similar:

1. Read and follow `tv-briefing/SKILL.md` — it is the complete playbook.
2. Read `tv-briefing/news-profile.json` for user preferences.
3. Reference `tv-briefing/briefing-example.json` for the exact JSON schema.
4. Your output is a single JSON file uploaded to `POST https://www.thinx.fun/api/tv/briefing`.
5. You do NOT touch TV code, deploy anything, or modify any other files in this repo.
