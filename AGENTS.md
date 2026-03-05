# AGENTS.md

## Cursor Cloud specific instructions

### Overview

thinx.fun is a Node.js + Express screenshot intelligence app. See `CLAUDE.md` for full architecture, pipeline flow, endpoints, and agent role definitions.

### Running the dev server

```bash
npm run dev   # Starts Express on PORT=3000 (default)
```

The server does **not** hot-reload; restart manually after code changes.

### Testing

```bash
npm test          # All 184 tests (unit, mocked — no API key needed)
npm run test:unit # Unit tests only
```

- Tests use Jest and run fully offline (mocked LLM calls). No `ANTHROPIC_API_KEY` required.
- `npm run test:health` runs 3 integration tests that require a real API key and network access.
- If tests hang, use `npx jest --forceExit`.
- There is **no ESLint or linter** configured in this project.

### Environment variables

- `ANTHROPIC_API_KEY` — required for the screenshot analysis pipeline (Claude LLM calls). Without it the server starts and serves the UI, but uploads will fail at the analysis step.
- `PORT` — server port, defaults to `3000`.
- Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) — optional; falls back to in-memory storage.

### Key gotchas

- The upload endpoint (`POST /api/hub/v2/start`) expects a JSON body with `image` as a base64 data URI (e.g. `data:image/png;base64,...`), **not** multipart form upload.
- Debug endpoints require `?token=thinx-debug-2026` (or `X-Debug-Token` header). See `CLAUDE.md` for the full list.
- The Jest worker may warn about force-exit due to open handles — this is benign and does not indicate test failures.
