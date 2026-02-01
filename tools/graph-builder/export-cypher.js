#!/usr/bin/env node

/**
 * Export Graph to Neo4j Cypher
 * Generates Cypher CREATE statements that can be run in Neo4j Browser
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseJavaScript } from './parsers/js-parser.js';
import { parseHTML } from './parsers/html-parser.js';
import { detectSimilarities } from './analyzers/similarity-detector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceRoot = path.resolve(__dirname, '../..');
const files = [];

function discoverFiles(dir, rel = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory() && !r.includes('node_modules') && !r.includes('tools')) {
      discoverFiles(full, r);
    } else if (e.isFile() && ((r.startsWith('api/') && r.endsWith('.js')) || (r.startsWith('public/') && r.endsWith('.html')))) {
      files.push(r);
    }
  }
}

discoverFiles(sourceRoot);

const parseResult = {
  files: [],
  functions: [],
  calls: [],
  imports: [],
  endpoints: [],
  uiComponents: [],
  apiCalls: [],
  codeBlocks: [],
};

// Parse all files
for (const file of files) {
  const fullPath = path.join(sourceRoot, file);
  const content = fs.readFileSync(fullPath, 'utf-8');
  const ext = path.extname(file);
  
  parseResult.files.push({
    path: file,
    language: ext === '.html' ? 'html' : 'javascript',
    loc: content.split('\n').length,
  });
  
  if (ext === '.js') {
    const jsResult = parseJavaScript(content, file);
    parseResult.functions.push(...jsResult.functions);
    parseResult.calls.push(...jsResult.calls);
    parseResult.imports.push(...jsResult.imports);
    parseResult.endpoints.push(...jsResult.endpoints);
    parseResult.codeBlocks.push(...jsResult.codeBlocks);
  } else if (ext === '.html') {
    const htmlResult = parseHTML(content, file);
    parseResult.uiComponents.push(...htmlResult.uiComponents);
    parseResult.apiCalls.push(...htmlResult.apiCalls);
    parseResult.functions.push(...htmlResult.functions);
    parseResult.calls.push(...htmlResult.calls);
    parseResult.imports.push(...htmlResult.imports);
    parseResult.codeBlocks.push(...htmlResult.codeBlocks);
  }
}

// Generate Cypher statements
let cypher = `// ============================================
// Code Knowledge Graph - Cypher Import Script
// Generated: ${new Date().toISOString()}
// 
// To use:
// 1. Open Neo4j Browser at http://localhost:7474
// 2. Connect with: bolt://localhost:7687, user: neo4j, password: password
// 3. Paste this entire script and run it
// ============================================

// Clear existing data
MATCH (n) DETACH DELETE n;

// ============================================
// CREATE FILES
// ============================================

`;

// Create files
parseResult.files.forEach(file => {
  const varName = file.path.replace(/[^a-zA-Z0-9]/g, '_');
  cypher += `CREATE (f${varName}:File {
  path: '${file.path.replace(/'/g, "\\'")}',
  language: '${file.language}',
  loc: ${file.loc}
});

`;
});

// Create functions
cypher += `\n// ============================================
// CREATE FUNCTIONS
// ============================================

`;

parseResult.functions.forEach(func => {
  const fileVar = `f${func.file.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const funcVar = `fn${func.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
  
  cypher += `MATCH (${fileVar}:File {path: '${func.file.replace(/'/g, "\\'")}'})
CREATE (${funcVar}:Function {
  id: '${func.id.replace(/'/g, "\\'")}',
  name: '${func.name.replace(/'/g, "\\'")}',
  file: '${func.file.replace(/'/g, "\\'")}',
  startLine: ${func.startLine},
  endLine: ${func.endLine},
  async: ${func.async || false},
  params: ${JSON.stringify(func.params || [])},
  exported: ${func.exported || false}
})
CREATE (${fileVar})-[:CONTAINS]->(${funcVar});

`;
});

// Create endpoints
cypher += `\n// ============================================
// CREATE ENDPOINTS
// ============================================

`;

parseResult.endpoints.forEach(endpoint => {
  const fileVar = `f${endpoint.file.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const endpointVar = `e${endpoint.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
  
  cypher += `MATCH (${fileVar}:File {path: '${endpoint.file.replace(/'/g, "\\'")}'})
CREATE (${endpointVar}:Endpoint {
  id: '${endpoint.id.replace(/'/g, "\\'")}',
  method: '${endpoint.method}',
  path: '${endpoint.path.replace(/'/g, "\\'")}',
  handler: '${endpoint.handler.replace(/'/g, "\\'")}',
  file: '${endpoint.file.replace(/'/g, "\\'")}',
  line: ${endpoint.line},
  middleware: ${JSON.stringify(endpoint.middleware || [])}
})
CREATE (${fileVar})-[:DEFINES]->(${endpointVar});

`;

  // Link endpoint to handler function if it exists
  if (endpoint.handler && !endpoint.handler.startsWith('inline@')) {
    const handlerFunc = parseResult.functions.find(f => f.name === endpoint.handler);
    if (handlerFunc) {
      const handlerVar = `fn${handlerFunc.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      cypher += `MATCH (${endpointVar}:Endpoint {id: '${endpoint.id.replace(/'/g, "\\'")}'})
MATCH (${handlerVar}:Function {id: '${handlerFunc.id.replace(/'/g, "\\'")}'})
CREATE (${endpointVar})-[:ROUTES_TO]->(${handlerVar});

`;
    }
  }
});

// Create function calls (simplified - only direct matches)
cypher += `\n// ============================================
// CREATE FUNCTION CALLS
// ============================================

`;

const callMap = new Map();
parseResult.calls.forEach(call => {
  const key = `${call.caller || 'global'}:${call.callee}:${call.file}:${call.line}`;
  if (!callMap.has(key)) {
    callMap.set(key, call);
    
    const caller = parseResult.functions.find(f => f.name === call.caller);
    const callee = parseResult.functions.find(f => 
      f.name === call.callee || call.callee.includes(f.name.split('.')[0])
    );
    
    if (caller && callee && caller.id !== callee.id) {
      const callerVar = `fn${caller.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const calleeVar = `fn${callee.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      cypher += `MATCH (${callerVar}:Function {id: '${caller.id.replace(/'/g, "\\'")}'})
MATCH (${calleeVar}:Function {id: '${callee.id.replace(/'/g, "\\'")}'})
MERGE (${callerVar})-[:CALLS {line: ${call.line}, file: '${call.file.replace(/'/g, "\\'")}'}]->(${calleeVar});

`;
    }
  }
});

// Create UI components
cypher += `\n// ============================================
// CREATE UI COMPONENTS
// ============================================

`;

parseResult.uiComponents.forEach(comp => {
  const fileVar = `f${comp.file.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const compVar = `ui${comp.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
  
  cypher += `MATCH (${fileVar}:File {path: '${comp.file.replace(/'/g, "\\'")}'})
CREATE (${compVar}:UIComponent {
  id: '${comp.id.replace(/'/g, "\\'")}',
  name: '${comp.name.replace(/'/g, "\\'")}',
  type: '${comp.type}',
  file: '${comp.file.replace(/'/g, "\\'")}',
  htmlId: '${(comp.htmlId || '').replace(/'/g, "\\'")}',
  className: '${(comp.className || '').replace(/'/g, "\\'")}'
})
CREATE (${fileVar})-[:CONTAINS]->(${compVar});

`;
});

// Link UI to endpoints
cypher += `\n// ============================================
// CREATE UI-API CONNECTIONS
// ============================================

`;

parseResult.apiCalls.forEach(apiCall => {
  if (apiCall.path) {
    const endpoint = parseResult.endpoints.find(e => 
      apiCall.path.includes(e.path) || e.path.includes(apiCall.path.split('/')[2])
    );
    
    if (endpoint) {
      const ui = parseResult.uiComponents.find(u => u.file === apiCall.file);
      if (ui) {
        const uiVar = `ui${ui.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const endpointVar = `e${endpoint.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
        
        cypher += `MATCH (${uiVar}:UIComponent {id: '${ui.id.replace(/'/g, "\\'")}'})
MATCH (${endpointVar}:Endpoint {id: '${endpoint.id.replace(/'/g, "\\'")}'})
MERGE (${uiVar})-[:READS_DATA {method: '${apiCall.method || 'GET'}', type: '${apiCall.type || 'fetch'}'}]->(${endpointVar});

`;
      }
    }
  }
});

// Create similarities
const similarities = detectSimilarities(parseResult.codeBlocks);
cypher += `\n// ============================================
// CREATE SIMILARITY RELATIONSHIPS
// ============================================

`;

similarities.forEach(sim => {
  const func1Var = `fn${sim.block1.functionId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const func2Var = `fn${sim.block2.functionId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  
  cypher += `MATCH (${func1Var}:Function {id: '${sim.block1.functionId.replace(/'/g, "\\'")}'})
MATCH (${func2Var}:Function {id: '${sim.block2.functionId.replace(/'/g, "\\'")}'})
MERGE (${func1Var})-[:SIMILAR_TO {similarity: ${sim.similarity}, type: '${sim.type}'}]->(${func2Var});

`;
});

// Add summary query
cypher += `\n// ============================================
// SUMMARY QUERIES
// ============================================

// View all nodes by type
MATCH (n)
RETURN labels(n)[0] as type, count(*) as count
ORDER BY count DESC;

// View the full graph (run this to see everything)
MATCH (n)
OPTIONAL MATCH (n)-[r]->(m)
RETURN n, r, m
LIMIT 500;

`;

// Write to file
const outputPath = path.join(__dirname, 'graph-import.cypher');
fs.writeFileSync(outputPath, cypher);

console.log(`\n✅ Generated Neo4j Cypher import script: ${outputPath}\n`);
console.log(`📊 Contains:`);
console.log(`   • ${parseResult.files.length} files`);
console.log(`   • ${parseResult.functions.length} functions`);
console.log(`   • ${parseResult.endpoints.length} endpoints`);
console.log(`   • ${parseResult.uiComponents.length} UI components`);
console.log(`   • ${callMap.size} function calls`);
console.log(`   • ${similarities.length} similarity relationships\n`);

console.log(`🚀 To view in Neo4j Browser:\n`);
console.log(`   1. Start Neo4j:`);
console.log(`      docker run -d --name neo4j -p 7474:7474 -p 7687:7687 \\`);
console.log(`        -e NEO4J_AUTH=neo4j/password neo4j:latest\n`);
console.log(`   2. Open Neo4j Browser: http://localhost:7474`);
console.log(`      Login: neo4j / password\n`);
console.log(`   3. Copy and paste the contents of:`);
console.log(`      ${outputPath}\n`);
console.log(`   4. Or run: cat ${outputPath} | pbcopy\n`);
