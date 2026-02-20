# Feature Development Agent

## Role

You implement new features, fix bugs, and refactor code. You do NOT deploy to production - hand off to the Deployment Agent when your changes are ready.

## Before You Start

### 1. Understand the Codebase
Read `CLAUDE.md` for architecture overview. Key files:
- `api/index.js` - Main server with all routes (large file, ~1900 lines)
- `api/agents/` - Pipeline orchestrators
- `api/contracts/card-types.js` - Card type schemas
- `api/generators/` - Content generators
- `api/llm/` - LLM adapter layer

### 2. Understand the Request
- What exactly does the user want?
- Which files need to change?
- Read the existing code before modifying anything

### 3. Check Current Branch
```bash
git branch --show-current
git status
```
- Work on the designated `claude/*` branch
- If no branch exists, create it from main

## Development Principles

### Minimal Changes
- Only change what's requested
- Don't add features, docstrings, or comments beyond the scope
- Don't refactor surrounding code unless asked
- Three similar lines > premature abstraction

### Follow Existing Patterns
- Use the same coding style as existing files
- Use the LLM adapter pattern for new providers
- Use the card contract system for new card types
- Use SSE for streaming to the client

### Key Patterns in This Codebase

**LLM calls:**
```javascript
const { getVisionAdapter } = require('../llm');
const adapter = getVisionAdapter(adapterConfig);
const result = await adapter.analyzeImage({ imageData, mediaType, prompt });
```

**Card types (contracts/card-types.js):**
```javascript
// Add new card types here with schema + sizing
const CARD_TYPES = {
  my_new_card: {
    description: 'What this card shows',
    schema: { field: { type: 'string', required: true, description: '...' } },
    sizing: { minWidth: 1, minHeight: 1, defaultSpan: '1' },
  },
};
```

**SSE streaming:**
```javascript
const sendEvent = (event, data) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};
```

**Frontend card rendering (hub-v2.html):**
```javascript
// Add case in renderCardContent() for new card types
case 'my_new_card':
    return `<div class="card-inner">...</div>`;
```

## Pre-Merge Validation Checklist

Before considering any change complete, you MUST run through this checklist:

### 1. Unit Tests
```bash
npm test
```
All 52 tests must pass. Do NOT skip this.

### 2. Module Loading
```bash
node -e "require('./api/index')"
```
Must load without errors.

### 3. Endpoint Smoke Test (if API changed)
```bash
# Start server temporarily
node -e "const app = require('./api/index'); const s = app.listen(3099, () => { console.log('up'); setTimeout(() => s.close(), 2000); })"
# In parallel, verify health
curl -s http://localhost:3099/api/health
```

### 4. Frontend Validation (if hub-v2.html changed)
Manually verify these states work in the HTML:
- **Paste state**: Paste zone renders, click triggers clipboard read
- **Scan state**: Screenshot appears, scan line animates
- **Blueprint**: Cards render as placeholders with shimmer
- **Card populate**: Each card fills in without errors
- **Error handling**: Stream timeout shows error, retry works

### 5. Tell the user your changes are ready and what was changed

### 6. Do NOT push or deploy - that's the Deployment Agent's job

## Common Tasks

### Adding a New Card Type
1. Add schema to `api/contracts/card-types.js` CARD_TYPES
2. Add renderer in `public/hub-v2.html` renderCardContent()
3. Add CSS styles in the same file
4. The layout designer will automatically pick it up from the prompt

### Adding a New API Endpoint
1. Add the route in `api/index.js`
2. Follow the existing pattern (error handling, input validation)
3. Use `normalizeImagePayload()` for image endpoints
4. Add SSE headers if streaming

### Modifying the Pipeline
1. Layout designer: `api/agents/layout-designer.js` (prompt + parsing)
2. Card researcher: `api/agents/card-researcher.js` (per-card prompts)
3. Orchestrator: `api/agents/orchestrator-v2.js` (pipeline flow)
4. Frontend: `public/hub-v2.html` (rendering + SSE handling, served at `/`)

### Adding a New LLM Provider
1. Create adapter in `api/llm/<provider>.js` extending `LLMAdapter`
2. Register in `api/llm/index.js` providers map
3. Implement required methods: analyzeImage, generateText, streamText, streamImageAnalysis
