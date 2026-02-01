#!/usr/bin/env node
/**
 * Knowledge Graph CLI
 * 
 * Query, update, and generate documentation from the knowledge graph.
 * 
 * Usage:
 *   node knowledge-cli.js query "what calls analyzeScreenshot"
 *   node knowledge-cli.js show file:api/index.js
 *   node knowledge-cli.js tree
 *   node knowledge-cli.js stale              # Check for outdated refs
 *   node knowledge-cli.js generate-docs      # Regenerate explorer.html
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the knowledge graph
const graphPath = path.join(__dirname, 'knowledge/graph.json');
let graph;

try {
  graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
} catch (err) {
  console.error('Failed to load graph.json:', err.message);
  process.exit(1);
}

// Command handlers
const commands = {
  
  /**
   * Show the full tree structure
   */
  tree() {
    console.log('\n📦 ' + graph.nodes[graph.root].name);
    console.log('   ' + graph.nodes[graph.root].summary);
    console.log('');
    
    printTree(graph.root, '   ');
  },
  
  /**
   * Show details for a specific node
   */
  show(nodeId) {
    const node = graph.nodes[nodeId];
    if (!node) {
      // Try to find by name
      const found = Object.entries(graph.nodes).find(([id, n]) => 
        n.name?.toLowerCase().includes(nodeId.toLowerCase()) ||
        n.path?.includes(nodeId)
      );
      if (found) {
        return commands.show(found[0]);
      }
      console.error(`Node not found: ${nodeId}`);
      return;
    }
    
    console.log(`\n━━━ ${node.name} ━━━`);
    console.log(`Type: ${node.type}`);
    if (node.path) console.log(`Path: ${node.path}`);
    console.log(`\n${node.summary}`);
    
    if (node.codeRefs?.length) {
      console.log('\n📝 Code References:');
      node.codeRefs.forEach(ref => {
        console.log(`   ${ref.file || node.path} [lines ${ref.lines[0]}-${ref.lines[1]}]`);
        if (ref.description) console.log(`   └─ ${ref.description}`);
      });
    }
    
    if (node.concepts?.length) {
      console.log('\n💡 Concepts:');
      node.concepts.forEach(id => {
        const concept = graph.nodes[id];
        if (concept) console.log(`   • ${concept.name}`);
      });
    }
    
    if (node.children?.length) {
      console.log('\n📁 Children:');
      node.children.forEach(id => {
        const child = graph.nodes[id];
        if (child) console.log(`   • ${child.name} (${child.type})`);
      });
    }
    
    // Find relationships
    const incoming = graph.edges.filter(e => e.to === nodeId);
    const outgoing = graph.edges.filter(e => e.from === nodeId);
    
    if (incoming.length) {
      console.log('\n⬅️  Referenced by:');
      incoming.forEach(e => {
        const from = graph.nodes[e.from];
        console.log(`   ${from?.name || e.from} (${e.type})`);
      });
    }
    
    if (outgoing.length) {
      console.log('\n➡️  References:');
      outgoing.forEach(e => {
        const to = graph.nodes[e.to];
        console.log(`   ${to?.name || e.to} (${e.type})`);
      });
    }
    
    console.log('');
  },
  
  /**
   * Search nodes by query
   */
  query(q) {
    const query = q.toLowerCase();
    const matches = [];
    
    for (const [id, node] of Object.entries(graph.nodes)) {
      const score = scoreMatch(node, query);
      if (score > 0) {
        matches.push({ id, node, score });
      }
    }
    
    matches.sort((a, b) => b.score - a.score);
    
    if (matches.length === 0) {
      console.log(`No matches for: "${q}"`);
      return;
    }
    
    console.log(`\n🔍 Results for "${q}":\n`);
    
    matches.slice(0, 10).forEach(({ id, node, score }) => {
      console.log(`  [${node.type}] ${node.name}`);
      console.log(`     ${node.summary?.slice(0, 80)}...`);
      if (node.codeRefs?.[0]) {
        const ref = node.codeRefs[0];
        console.log(`     📄 ${ref.file || node.path} lines ${ref.lines[0]}-${ref.lines[1]}`);
      }
      console.log('');
    });
  },
  
  /**
   * Find what references a file/function
   */
  refs(target) {
    const targetLower = target.toLowerCase();
    
    // Find nodes that reference this
    const referencing = [];
    
    for (const [id, node] of Object.entries(graph.nodes)) {
      // Check codeRefs
      if (node.codeRefs?.some(r => r.file?.toLowerCase().includes(targetLower))) {
        referencing.push({ id, node, via: 'codeRef' });
      }
      // Check path
      if (node.path?.toLowerCase().includes(targetLower)) {
        referencing.push({ id, node, via: 'path' });
      }
    }
    
    // Find edges
    const edges = graph.edges.filter(e => 
      e.from.toLowerCase().includes(targetLower) ||
      e.to.toLowerCase().includes(targetLower)
    );
    
    console.log(`\n🔗 References to "${target}":\n`);
    
    if (referencing.length) {
      console.log('Nodes:');
      referencing.forEach(({ id, node, via }) => {
        console.log(`  • ${node.name} (${via})`);
      });
    }
    
    if (edges.length) {
      console.log('\nRelationships:');
      edges.forEach(e => {
        const from = graph.nodes[e.from]?.name || e.from;
        const to = graph.nodes[e.to]?.name || e.to;
        console.log(`  ${from} --[${e.type}]--> ${to}`);
      });
    }
    
    console.log('');
  },
  
  /**
   * Check for stale code references
   */
  async stale() {
    console.log('\n🔍 Checking for stale code references...\n');
    
    const projectRoot = path.join(__dirname, '../..');
    let staleCount = 0;
    
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (!node.codeRefs) continue;
      
      for (const ref of node.codeRefs) {
        const filePath = ref.file || node.path;
        if (!filePath) continue;
        
        const fullPath = path.join(projectRoot, filePath);
        
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          
          // Check if line range is valid
          if (ref.lines[1] > lines.length) {
            console.log(`⚠️  ${node.name}`);
            console.log(`   ${filePath} has ${lines.length} lines, ref says ${ref.lines[0]}-${ref.lines[1]}`);
            staleCount++;
          }
          
          // Check if snippet still matches (if provided)
          if (ref.snippet) {
            const firstLine = ref.snippet.split('\n')[0].trim();
            const actualLine = lines[ref.lines[0] - 1]?.trim();
            
            if (actualLine && !actualLine.includes(firstLine.slice(0, 20))) {
              console.log(`⚠️  ${node.name}`);
              console.log(`   Snippet may be stale at ${filePath}:${ref.lines[0]}`);
              console.log(`   Expected: "${firstLine.slice(0, 40)}..."`);
              console.log(`   Found:    "${actualLine.slice(0, 40)}..."`);
              staleCount++;
            }
          }
        } catch (err) {
          if (err.code === 'ENOENT') {
            console.log(`❌ ${node.name}`);
            console.log(`   File not found: ${filePath}`);
            staleCount++;
          }
        }
      }
    }
    
    if (staleCount === 0) {
      console.log('✅ All code references appear valid!');
    } else {
      console.log(`\n Found ${staleCount} potentially stale reference(s).`);
    }
  },
  
  /**
   * List all nodes by type
   */
  list(type) {
    const filtered = Object.entries(graph.nodes)
      .filter(([id, node]) => !type || node.type === type)
      .sort((a, b) => a[1].type.localeCompare(b[1].type));
    
    console.log(`\n📋 Nodes${type ? ` (type: ${type})` : ''}:\n`);
    
    let currentType = '';
    filtered.forEach(([id, node]) => {
      if (node.type !== currentType) {
        currentType = node.type;
        console.log(`\n  ${currentType.toUpperCase()}`);
      }
      console.log(`    • ${node.name}`);
    });
    
    console.log(`\n  Total: ${filtered.length} nodes\n`);
  },
  
  /**
   * Show statistics
   */
  stats() {
    const types = {};
    let totalRefs = 0;
    
    for (const node of Object.values(graph.nodes)) {
      types[node.type] = (types[node.type] || 0) + 1;
      totalRefs += node.codeRefs?.length || 0;
    }
    
    console.log('\n📊 Knowledge Graph Statistics:\n');
    console.log(`  Total nodes: ${Object.keys(graph.nodes).length}`);
    console.log(`  Total edges: ${graph.edges.length}`);
    console.log(`  Code references: ${totalRefs}`);
    console.log('\n  By type:');
    Object.entries(types)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`    ${type}: ${count}`);
      });
    console.log('');
  },
  
  /**
   * Show help
   */
  help() {
    console.log(`
Knowledge Graph CLI

Commands:
  tree                    Show the full knowledge tree
  show <node-id>          Show details for a node
  query "<text>"          Search nodes
  refs <file-or-name>     Find what references something
  stale                   Check for outdated code references
  list [type]             List all nodes (optionally by type)
  stats                   Show graph statistics
  help                    Show this help

Examples:
  node knowledge-cli.js tree
  node knowledge-cli.js show file:api/index.js
  node knowledge-cli.js query "how does upload work"
  node knowledge-cli.js refs "vision-analyzer"
  node knowledge-cli.js list concept
`);
  }
};

// Helper functions
function printTree(nodeId, indent = '') {
  const node = graph.nodes[nodeId];
  if (!node) return;
  
  const children = node.children || node.concepts || [];
  
  children.forEach((childId, i) => {
    const child = graph.nodes[childId];
    if (!child) return;
    
    const isLast = i === children.length - 1;
    const prefix = isLast ? '└── ' : '├── ';
    const icon = child.type === 'folder' ? '📁' : 
                 child.type === 'file' ? '📄' : 
                 child.type === 'concept' ? '💡' :
                 child.type === 'endpoint' ? '🔌' : '•';
    
    console.log(`${indent}${prefix}${icon} ${child.name}`);
    
    const nextIndent = indent + (isLast ? '    ' : '│   ');
    printTree(childId, nextIndent);
  });
}

function scoreMatch(node, query) {
  let score = 0;
  
  if (node.name?.toLowerCase().includes(query)) score += 10;
  if (node.summary?.toLowerCase().includes(query)) score += 5;
  if (node.path?.toLowerCase().includes(query)) score += 3;
  
  // Check code snippets
  if (node.codeRefs) {
    for (const ref of node.codeRefs) {
      if (ref.snippet?.toLowerCase().includes(query)) score += 2;
      if (ref.description?.toLowerCase().includes(query)) score += 2;
    }
  }
  
  return score;
}

// Run CLI
const [,, command, ...args] = process.argv;

if (!command || command === 'help' || command === '--help') {
  commands.help();
} else if (commands[command]) {
  commands[command](...args);
} else {
  // Try as a query
  commands.query([command, ...args].join(' '));
}
