## Cursor Cloud specific instructions

### Overview

thinx.fun is a single Node.js/Express server (`api/index.js`) with no build step, no Docker, and no database required for local dev. See `CLAUDE.md` for full architecture and endpoint reference.

### Running the app

```bash
npm start          # or: node api/index.js
# Serves on http://localhost:3000
```

The server starts without `ANTHROPIC_API_KEY` but the screenshot analysis pipeline requires it. Without the key, the UI loads and health/debug endpoints work, but actual AI analysis will fail.

### Testing

```bash
npm test           # All tests (Jest, --forceExit recommended if they hang)
npm run test:unit  # Unit tests only (142 tests, fast, fully mocked)
npm run test:health # Integration health checks (requires live API)
```

No linter is configured in this project.

### Key caveats

- There is no hot-reload/watch mode for the server. After code changes to `api/`, you must restart `node api/index.js`.
- The `v1/` directory is a legacy copy of the project; current development targets the root `api/` and `public/` directories.
- Redis is optional; the app falls back to in-memory ring buffers. The `persistence` field in the debug dashboard shows `memory-only` or `redis`.
- The debug dashboard is at `/api/debug/dashboard?token=thinx-debug-2026` (default token).
- Jest may report "worker failed to exit gracefully" warnings; this is a known non-issue caused by timers in the logger module.
