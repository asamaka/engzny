# Knowledge Graph Storage Schema

## Design Goals

1. **Lives in the repo** — Version controlled alongside the code it documents
2. **Human-readable** — Developers can read and edit directly
3. **Machine-queryable** — Tools can traverse, search, and update it
4. **Hybrid data** — Supports precise code refs AND fuzzy explanations
5. **Incrementally updatable** — Change one file, update one node

---

## Proposed Structure: JSON Knowledge Graph + Markdown Prose

```
tools/graph-builder/
├── knowledge/
│   ├── graph.json          # The structured graph (nodes + edges)
│   ├── explanations/       # Prose explanations (one per concept)
│   │   ├── project.md
│   │   ├── api-server.md
│   │   ├── orchestrator.md
│   │   ├── vision-analysis.md
│   │   └── ...
│   └── code-index.json     # Fast lookup: file → nodes that reference it
```

---

## graph.json Schema

```json
{
  "version": "1.0",
  "generated": "2026-01-25T10:00:00Z",
  "root": "project",
  
  "nodes": {
    "project": {
      "type": "project",
      "name": "Engzny (thinx.fun)",
      "explanation": "explanations/project.md",
      "children": ["folder:public", "folder:api"]
    },
    
    "folder:public": {
      "type": "folder",
      "path": "public/",
      "name": "Frontend",
      "explanation": "explanations/frontend.md",
      "children": ["file:public/index.html", "file:public/canvas.html", "file:public/job.html", "file:public/paste.html"]
    },
    
    "file:public/canvas.html": {
      "type": "file",
      "path": "public/canvas.html",
      "name": "Canvas Generator & Viewer",
      "explanation": "explanations/canvas-page.md",
      "children": ["concept:canvas-states", "concept:canvas-streaming", "concept:canvas-render"],
      "codeRefs": [
        { "description": "Full file", "lines": [1, 612] }
      ]
    },
    
    "concept:canvas-states": {
      "type": "concept",
      "name": "State Management",
      "explanation": "explanations/canvas-page.md#states",
      "parent": "file:public/canvas.html",
      "codeRefs": [
        { 
          "file": "public/canvas.html",
          "lines": [344, 382],
          "snippet": "const states = {\n  upload: ...,\n  loading: ...,\n  canvas: ...,\n  error: ...\n};",
          "description": "The four possible UI states"
        }
      ]
    },
    
    "func:analyzeScreenshot": {
      "type": "function",
      "name": "analyzeScreenshot",
      "parent": "file:api/generators/vision-analyzer.js",
      "explanation": "explanations/vision-analysis.md#main-function",
      "codeRefs": [
        {
          "file": "api/generators/vision-analyzer.js",
          "lines": [130, 144],
          "signature": "async function analyzeScreenshot({ imageData, mediaType, adapterConfig })"
        }
      ],
      "calls": ["func:getVisionAdapter", "func:normalizeAnalysis"],
      "calledBy": ["method:Orchestrator.process"]
    }
  },
  
  "edges": [
    { "from": "file:api/index.js", "to": "file:api/agents/orchestrator.js", "type": "imports" },
    { "from": "func:analyzeScreenshot", "to": "func:getVisionAdapter", "type": "calls" },
    { "from": "concept:canvas-streaming", "to": "file:api/index.js", "type": "communicates_with", "via": "SSE" }
  ]
}
```

---

## Explanation Files (Markdown)

Each `.md` file contains the prose explanation for a node. This keeps the JSON clean (just structure) and the prose readable/editable.

### Example: `explanations/canvas-page.md`

```markdown
# Canvas Generator & Viewer

This is the most sophisticated page in the application. It handles the entire 
flow from upload to viewing the result, all without leaving the page.

## How it Works

You upload an image, watch a scanning animation while AI analyzes it, 
and then see the interactive canvas appear.

The page manages four different "states" - only one is visible at a time:

- **upload** — Waiting for user to provide an image
- **loading** — Showing progress with scanning animation  
- **canvas** — Displaying the generated result
- **error** — Showing what went wrong with retry option

## States {#states}

The page tracks which "mode" it's in using a simple state object...
(This section corresponds to concept:canvas-states)

## Streaming {#streaming}

Instead of waiting for the entire result...
(This section corresponds to concept:canvas-streaming)
```

---

## code-index.json — Reverse Lookup

For quickly finding "what nodes reference this file?"

```json
{
  "public/canvas.html": [
    "file:public/canvas.html",
    "concept:canvas-states",
    "concept:canvas-streaming",
    "concept:canvas-render"
  ],
  "api/generators/vision-analyzer.js": [
    "file:api/generators/vision-analyzer.js",
    "func:analyzeScreenshot",
    "func:normalizeAnalysis",
    "concept:hotspot-detection"
  ]
}
```

When a file changes, we know exactly which nodes to check/update.

---

## Node Types

| Type | Description | Key Properties |
|------|-------------|----------------|
| `project` | Root node | name, children |
| `folder` | Directory | path, children |
| `file` | Source file | path, children, codeRefs |
| `concept` | Business/logical concept | explanation, codeRefs |
| `function` | Named function | signature, calls, calledBy |
| `class` | Class definition | methods, properties |
| `endpoint` | API route | method, path, handler |

---

## Update Workflow

### When code changes:

1. **Detect changed files** (git diff)
2. **Look up affected nodes** (via code-index.json)
3. **Re-parse those files** (extract functions, lines, etc.)
4. **Update codeRefs** (new line numbers, snippets)
5. **Flag explanations for review** (content may be stale)

### When adding new code:

1. **Parse new file** → create file node
2. **Extract functions/classes** → create child nodes
3. **Prompt for explanation** (or generate draft with AI)
4. **Link to existing nodes** (calls, imports, etc.)

---

## Query Examples

### "What does the Orchestrator coordinate?"

```javascript
const orchestrator = graph.nodes['file:api/agents/orchestrator.js'];
const children = orchestrator.children.map(id => graph.nodes[id]);
// Returns: [GlobalContextManifest, Orchestrator class, process method, etc.]
```

### "What code implements image compression?"

```javascript
const matches = Object.values(graph.nodes).filter(node => 
  node.explanation?.includes('compress') || 
  node.name?.toLowerCase().includes('compress')
);
// Returns nodes with code refs to exact lines
```

### "What would break if I changed vision-analyzer.js?"

```javascript
const callers = graph.edges
  .filter(e => e.to.startsWith('func:') && e.to.includes('vision'))
  .map(e => e.from);
// Returns: Orchestrator.process, etc.
```

---

## Benefits of This Approach

1. **Version controlled** — Graph changes tracked alongside code
2. **Human-editable** — Markdown prose is easy to improve
3. **Queryable** — JSON can be loaded and traversed
4. **Maintainable** — code-index makes updates targeted
5. **Portable** — Can export to Neo4j, generate docs, power search
6. **AI-friendly** — Structure helps LLMs understand and update

---

## Next Steps

1. Build a parser that extracts the initial graph from code
2. Create a tool that detects stale nodes after git changes
3. Build a simple query CLI (`./query.js "what calls analyzeScreenshot"`)
4. Generate the explorer.html automatically from graph.json
