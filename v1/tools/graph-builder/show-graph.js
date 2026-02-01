#!/usr/bin/env node

/**
 * Quick Graph Summary
 * Shows a text-based summary of the code graph
 */

import { parseJavaScript } from './parsers/js-parser.js';
import { parseHTML } from './parsers/html-parser.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

const endpoints = [];
const functions = [];
const uiComponents = [];
const calls = [];

for (const file of files) {
  const full = path.join(sourceRoot, file);
  const content = fs.readFileSync(full, 'utf-8');
  const ext = path.extname(file);
  
  if (ext === '.js') {
    const r = parseJavaScript(content, file);
    endpoints.push(...r.endpoints);
    functions.push(...r.functions);
    calls.push(...r.calls);
  } else if (ext === '.html') {
    const r = parseHTML(content, file);
    uiComponents.push(...r.uiComponents.filter(c => c.type === 'form' || c.type === 'state' || c.type === 'section'));
  }
}

console.log('\n📊 CODE KNOWLEDGE GRAPH STRUCTURE\n');
console.log('═'.repeat(70));

console.log('\n🌐 API ENDPOINTS:\n');
endpoints.forEach(e => {
  console.log(`  ${e.method.padEnd(6)} ${e.path.padEnd(35)} → ${e.handler} (${e.file}:${e.line})`);
});

console.log('\n⚙️  KEY FUNCTIONS (exported or endpoint handlers):\n');
const keyFunctions = functions.filter(f => 
  f.exported || 
  endpoints.some(e => e.handler === f.name) ||
  f.name.includes('compress') ||
  f.name.includes('storage') ||
  f.name.includes('upload') ||
  f.name.includes('stream')
);
keyFunctions.slice(0, 20).forEach(f => {
  const async = f.async ? 'async ' : '';
  console.log(`  • ${async}${f.name.padEnd(40)} (${f.file}:${f.startLine}-${f.endLine})`);
});

console.log('\n🔗 FUNCTION CALLS (sample):\n');
const importantCalls = calls.filter(c => 
  keyFunctions.some(f => f.name === c.caller || f.name === c.callee)
).slice(0, 15);
importantCalls.forEach(c => {
  console.log(`  ${(c.caller || 'global').padEnd(30)} → ${c.callee} (${c.file}:${c.line})`);
});

console.log('\n🎨 UI COMPONENTS:\n');
uiComponents.slice(0, 15).forEach(c => {
  console.log(`  • ${c.name.padEnd(40)} [${c.type}] (${c.file})`);
});

console.log('\n' + '═'.repeat(70));
console.log(`\n📈 Totals: ${endpoints.length} endpoints, ${functions.length} functions, ${uiComponents.length} UI components, ${calls.length} calls\n`);

console.log('💡 To see the full interactive graph:');
console.log('   Open: engzny/tools/graph-builder/graph-visualization.html\n');
