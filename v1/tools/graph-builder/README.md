# Code Knowledge Graph

A Neo4j-backed code intelligence system that captures the complete mental model of your codebase - from high-level concepts to line-by-line references.

## Quick Start

### 1. Start Neo4j

Using Docker (easiest):
```bash
docker run -d --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:latest
```

Or use [Neo4j Aura](https://neo4j.com/cloud/aura/) free tier.

### 2. Configure Environment

```bash
# In engzny/tools/graph-builder/
cp .env.example .env

# Edit .env with your credentials:
# NEO4J_URI=bolt://localhost:7687
# NEO4J_USERNAME=neo4j
# NEO4J_PASSWORD=password
# ANTHROPIC_API_KEY=sk-ant-... (optional, for LLM features)
```

### 3. Install Dependencies

```bash
cd engzny/tools/graph-builder
npm install
```

### 4. Build the Knowledge Graph

```bash
# Full build with LLM annotations
node ingest.js

# Quick build (skip LLM, faster)
node ingest.js --skip-llm

# Dry run (parse only, no Neo4j)
node ingest.js --dry-run
```

### 5. Query Your Code

```bash
# Natural language questions
node query.js "What happens when an image is uploaded?"
node query.js "What would break if I changed the compression logic?"
node query.js "Show me duplicate code"

# Direct Cypher queries
node query.js --cypher "MATCH (e:Endpoint) RETURN e.method, e.path"

# Interactive mode
node query.js --interactive
```

## What Gets Captured

### Node Types

| Type | Description |
|------|-------------|
| `File` | Source files with path, language, lines of code |
| `Function` | Functions with name, location, params, description |
| `Endpoint` | API routes with method, path, handler |
| `UIComponent` | Frontend sections (forms, states, containers) |
| `Concept` | Business domains (e.g., "Job Management") |
| `ExternalDep` | npm packages and external APIs |

### Relationships

| Relationship | Description |
|--------------|-------------|
| `CONTAINS` | File contains function/component |
| `CALLS` | Function calls another function |
| `IMPORTS` | File imports module/package |
| `IMPLEMENTS` | Function implements a concept |
| `ROUTES_TO` | Endpoint routes to handler |
| `READS_DATA` | UI component reads from endpoint |
| `SIMILAR_TO` | Code blocks are similar/duplicate |

## Example Queries

### Find all endpoints
```cypher
MATCH (e:Endpoint)
RETURN e.method, e.path, e.file, e.line
ORDER BY e.path
```

### What calls a function?
```cypher
MATCH (caller:Function)-[r:CALLS]->(fn:Function {name: 'compressImageForAPI'})
RETURN caller.name, caller.file, r.line
```

### Impact analysis
```cypher
MATCH (fn:Function {name: 'storage'})
OPTIONAL MATCH (caller:Function)-[:CALLS*1..3]->(fn)
OPTIONAL MATCH (e:Endpoint)-[:ROUTES_TO]->(fn)
RETURN fn.name, collect(DISTINCT caller.name) as callers, collect(DISTINCT e.path) as endpoints
```

### Find duplicate code
```cypher
MATCH (fn1:Function)-[r:SIMILAR_TO]-(fn2:Function)
WHERE r.type = 'exact-duplicate'
RETURN fn1.name, fn1.file, fn2.name, fn2.file
```

### UI to API connections
```cypher
MATCH (ui:UIComponent)-[:READS_DATA]->(e:Endpoint)-[:ROUTES_TO]->(fn:Function)
RETURN ui.name, ui.file, e.method, e.path, fn.name
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Source Code                              │
│  api/index.js, public/*.html                                │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   Parsers                                    │
│  ┌─────────────┐  ┌─────────────┐                          │
│  │ JS Parser   │  │ HTML Parser │  (Babel, Cheerio)        │
│  │ - Functions │  │ - UI comps  │                          │
│  │ - Calls     │  │ - Embedded  │                          │
│  │ - Imports   │  │   scripts   │                          │
│  └─────────────┘  └─────────────┘                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   Analyzers                                  │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ Similarity      │  │ Concept         │                  │
│  │ Detector        │  │ Extractor       │ (Claude LLM)     │
│  │ - Duplicates    │  │ - Business      │                  │
│  │ - Patterns      │  │   domains       │                  │
│  └─────────────────┘  └─────────────────┘                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   Neo4j Graph                                │
│                                                              │
│   (File)──CONTAINS──▶(Function)──CALLS──▶(Function)         │
│      │                    │                                  │
│      │               IMPLEMENTS                              │
│      │                    │                                  │
│      ▼                    ▼                                  │
│  (Endpoint)          (Concept)                              │
│      ▲                                                       │
│      │                                                       │
│  READS_DATA                                                  │
│      │                                                       │
│ (UIComponent)                                                │
└─────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   Query Interface                            │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ Cypher Direct   │  │ Natural Language│ (Claude LLM)     │
│  │ --cypher "..."  │  │ "What happens..." │                │
│  └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Neo4j Connection Failed
```bash
# Check if Neo4j is running
docker ps | grep neo4j

# View logs
docker logs neo4j

# Restart
docker restart neo4j
```

### LLM Features Not Working
- Ensure `ANTHROPIC_API_KEY` is set in `.env`
- Use `--skip-llm` for faster builds without LLM features

### Graph is Empty
- Run `node ingest.js --dry-run` first to see what would be parsed
- Check that source files exist in `../../api/` and `../../public/`

## Extending

### Add New File Types
Edit `CONFIG.includePatterns` in `ingest.js`:
```javascript
includePatterns: [
  'api/**/*.js',
  'public/**/*.html',
  'src/**/*.ts',  // Add TypeScript
],
```

### Add Custom Concepts
After ingestion, add concepts manually:
```cypher
CREATE (c:Concept {
  name: 'Custom Domain',
  description: 'What it represents',
  category: 'core-feature'
})

MATCH (fn:Function {name: 'relevantFunction'})
MATCH (c:Concept {name: 'Custom Domain'})
MERGE (fn)-[:IMPLEMENTS]->(c)
```
