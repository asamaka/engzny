#!/usr/bin/env node

/**
 * Graph Visualizer
 * Generates a visual representation of the code knowledge graph
 * Works without Neo4j - uses parsed data directly
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseJavaScript } from './parsers/js-parser.js';
import { parseHTML } from './parsers/html-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate Mermaid diagram from parsed data with improved clustering
 */
function generateMermaidDiagram(parseResult) {
  let mermaid = 'graph LR\n';
  
  // 1. Group by File (Subgraphs)
  parseResult.files.forEach(file => {
    const fileNodeId = file.path.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = file.path.split('/').pop();
    
    mermaid += `  subgraph cluster_${fileNodeId} ["${file.path}"]\n`;
    
    // Add UI Components in this file
    const fileUI = parseResult.uiComponents.filter(u => u.file === file.path);
    fileUI.forEach(ui => {
      const uiId = `ui_${ui.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      mermaid += `    ${uiId}["🎨 ${ui.name}"]\n`;
    });
    
    // Add Endpoints in this file
    const fileEndpoints = parseResult.endpoints.filter(e => e.file === file.path);
    fileEndpoints.forEach(e => {
      const eId = `endpoint_${e.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      mermaid += `    ${eId}["🌐 ${e.method} ${e.path}"]\n`;
    });
    
    // Add Key Functions in this file
    const fileFuncs = parseResult.functions.filter(f => 
      f.file === file.path && (f.exported || parseResult.endpoints.some(e => e.handler === f.name) || f.name.length > 0)
    ).slice(0, 10); // Limit to top 10 per file for clarity
    
    fileFuncs.forEach(f => {
      const fId = `func_${f.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      mermaid += `    ${fId}["⚙️ ${f.name}"]\n`;
    });
    
    mermaid += `  end\n\n`;
  });
  
  // 2. Add Relationships between clusters
  
  // Endpoint -> Function
  parseResult.endpoints.forEach(e => {
    const handler = parseResult.functions.find(f => f.name === e.handler);
    if (handler) {
      const eId = `endpoint_${e.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const fId = `func_${handler.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      mermaid += `  ${eId} -->|routes| ${fId}\n`;
    }
  });
  
  // UI -> Endpoint
  parseResult.apiCalls.forEach(call => {
    const endpoint = parseResult.endpoints.find(e => call.path && (call.path.includes(e.path) || e.path.includes(call.path.split('/')[2])));
    if (endpoint) {
      const ui = parseResult.uiComponents.find(u => u.file === call.file);
      if (ui) {
        const uiId = `ui_${ui.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const eId = `endpoint_${endpoint.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
        mermaid += `  ${uiId} -->|calls| ${eId}\n`;
      }
    }
  });

  // Function -> Function (Sample of important calls)
  const importantFuncs = ['storage', 'compress', 'upload', 'stream', 'generate', 'orchestrate'];
  parseResult.calls.forEach(call => {
    if (importantFuncs.some(name => call.callee.includes(name) || (call.caller && call.caller.includes(name)))) {
      const caller = parseResult.functions.find(f => f.name === call.caller);
      const callee = parseResult.functions.find(f => f.name === call.callee || (call.callee.includes(f.name) && f.name.length > 5));
      if (caller && callee && caller.id !== callee.id) {
        const cId = `func_${caller.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const targetId = `func_${callee.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
        mermaid += `  ${cId} -.->|calls| ${targetId}\n`;
      }
    }
  });
  
  return mermaid;
}

/**
 * Generate HTML visualization
 */
function generateHTMLVisualization(parseResult, mermaid) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Code Intelligence - thinx.fun</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    body {
      font-family: 'JetBrains Mono', 'Monaco', monospace;
      margin: 0;
      padding: 0;
      background: #0f172a;
      color: #94a3b8;
    }
    .header {
      background: #1e293b;
      padding: 20px 40px;
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1 { color: #f8fafc; margin: 0; font-size: 20px; }
    .stats {
      display: flex;
      gap: 20px;
    }
    .stat-box {
      background: #334155;
      padding: 5px 15px;
      border-radius: 4px;
      font-size: 12px;
    }
    .stat-val { color: #22d3ee; font-weight: bold; }
    
    .view-container {
      display: flex;
      height: calc(100vh - 65px);
    }
    
    .sidebar {
      width: 300px;
      background: #1e293b;
      border-right: 1px solid #334155;
      overflow-y: auto;
      padding: 20px;
    }
    
    .graph-viewport {
      flex: 1;
      overflow: auto;
      background: #0f172a;
      padding: 40px;
      position: relative;
    }
    
    .mermaid-wrapper {
      background: #ffffff;
      padding: 40px;
      border-radius: 8px;
      min-width: fit-content;
    }
    
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-top: 25px; }
    .item-list { font-size: 12px; margin-top: 10px; }
    .item { margin-bottom: 5px; cursor: pointer; }
    .item:hover { color: #22d3ee; }
    
    .controls {
      position: absolute;
      top: 20px;
      right: 20px;
      z-index: 100;
      display: flex;
      gap: 10px;
    }
    button {
      background: #334155;
      border: 1px solid #475569;
      color: #f8fafc;
      padding: 8px 12px;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover { background: #475569; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔍 Code Knowledge Graph</h1>
    <div class="stats">
      <div class="stat-box">Files <span class="stat-val">${parseResult.files.length}</span></div>
      <div class="stat-box">Functions <span class="stat-val">${parseResult.functions.length}</span></div>
      <div class="stat-box">Endpoints <span class="stat-val">${parseResult.endpoints.length}</span></div>
    </div>
  </div>
  
  <div class="view-container">
    <div class="sidebar">
      <h2>Endpoints</h2>
      <div class="item-list">
        ${parseResult.endpoints.map(e => `<div class="item"><b>${e.method}</b> ${e.path}</div>`).join('')}
      </div>
      
      <h2>Core Logic</h2>
      <div class="item-list">
        ${parseResult.functions
          .filter(f => f.name.includes('storage') || f.name.includes('compress') || f.name.includes('stream'))
          .map(f => `<div class="item">${f.name}</div>`).join('')}
      </div>
    </div>
    
    <div class="graph-viewport" id="viewport">
      <div class="controls">
        <button onclick="zoom(1.2)">+</button>
        <button onclick="zoom(0.8)">-</button>
        <button onclick="resetZoom()">Reset</button>
      </div>
      <div class="mermaid-wrapper" id="mermaid-wrapper">
        <div class="mermaid">
${mermaid}
        </div>
      </div>
    </div>
  </div>
  
  <script>
    mermaid.initialize({ 
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose',
      flowchart: {
        useMaxWidth: false,
        htmlLabels: true,
        curve: 'basis'
      }
    });

    let currentZoom = 1;
    const wrapper = document.getElementById('mermaid-wrapper');
    
    function zoom(factor) {
      currentZoom *= factor;
      wrapper.style.transform = 'scale(' + currentZoom + ')';
      wrapper.style.transformOrigin = '0 0';
    }
    
    function resetZoom() {
      currentZoom = 1;
      wrapper.style.transform = 'scale(1)';
    }

    // Auto-scroll to center after render
    setTimeout(() => {
      const viewport = document.getElementById('viewport');
      viewport.scrollLeft = (wrapper.offsetWidth - viewport.offsetWidth) / 2;
    }, 1000);
  </script>
</body>
</html>`;
}

/**
 * Main
 */
async function main() {
  console.log('🔍 Building graph visualization...\n');
  
  // Parse all files (same logic as ingest.js)
  const sourceRoot = path.resolve(__dirname, '../..');
  const files = [];
  
  function discoverFiles(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      
      if (entry.isDirectory()) {
        if (!relPath.includes('node_modules') && !relPath.includes('tools')) {
          discoverFiles(fullPath, relPath);
        }
      } else if (entry.isFile()) {
        if ((relPath.startsWith('api/') && relPath.endsWith('.js')) ||
            (relPath.startsWith('public/') && relPath.endsWith('.html'))) {
          files.push(relPath);
        }
      }
    }
  }
  
  discoverFiles(sourceRoot);
  
  const parseResult = {
    files: [],
    functions: [],
    calls: [],
    imports: [],
    exports: [],
    variables: [],
    endpoints: [],
    uiComponents: [],
    apiCalls: [],
    codeBlocks: [],
  };
  
  // Parse files
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
      Object.keys(jsResult).forEach(key => {
        if (parseResult[key]) {
          parseResult[key].push(...(jsResult[key] || []));
        }
      });
    } else if (ext === '.html') {
      const htmlResult = parseHTML(content, file);
      parseResult.uiComponents.push(...htmlResult.uiComponents);
      parseResult.apiCalls.push(...htmlResult.apiCalls);
      parseResult.functions.push(...htmlResult.functions);
      parseResult.calls.push(...htmlResult.calls);
      parseResult.imports.push(...htmlResult.imports);
    }
  }
  
  // Generate visualization
  const mermaid = generateMermaidDiagram(parseResult);
  const html = generateHTMLVisualization(parseResult, mermaid);
  
  // Write HTML file
  const outputPath = path.join(__dirname, 'graph-visualization.html');
  fs.writeFileSync(outputPath, html);
  
  console.log(`✅ Graph visualization generated: ${outputPath}`);
  console.log(`\n📊 Summary:`);
  console.log(`   Files: ${parseResult.files.length}`);
  console.log(`   Functions: ${parseResult.functions.length}`);
  console.log(`   Endpoints: ${parseResult.endpoints.length}`);
  console.log(`   UI Components: ${parseResult.uiComponents.length}`);
  console.log(`\n🌐 Open ${outputPath} in your browser to view the graph!`);
}

main().catch(console.error);
