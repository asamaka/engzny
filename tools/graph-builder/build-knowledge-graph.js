#!/usr/bin/env node
/**
 * Iterative Knowledge Graph Builder
 * 
 * Builds a knowledge graph through multiple LLM-driven passes:
 * 
 * Pass 1: SKELETON     - One node per file, basic metadata
 * Pass 2: UNDERSTAND   - LLM analyzes each file's purpose and extracts key elements
 * Pass 3: CONNECT      - LLM identifies relationships between files
 * Pass 4: CONCEPTS     - LLM extracts business concepts and creates concept nodes
 * Pass 5: QUESTIONS    - LLM generates questions this file could answer
 * 
 * The goal: Any developer question should translate to a Cypher query
 * that returns relevant code with clear reasoning.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Claude
const anthropic = new Anthropic();

// Project configuration
const PROJECT_ROOT = path.join(__dirname, '../..');
const OUTPUT_PATH = path.join(__dirname, 'knowledge/graph.json');
const FILES_TO_ANALYZE = [
  'api/index.js',
  'api/agents/orchestrator.js',
  'api/generators/vision-analyzer.js',
  'api/generators/html-generator.js',
  'api/generators/style-manager.js',
  'api/llm/adapter.js',
  'api/llm/claude.js',
  'api/llm/index.js',
  'public/index.html',
  'public/canvas.html',
  'public/job.html',
  'public/paste.html',
];

// Graph state
let graph = {
  version: '2.0',
  generated: new Date().toISOString(),
  project: 'engzny',
  buildPasses: [],
  nodes: {},
  edges: [],
};

// ============================================
// PASS 1: SKELETON
// Create one node per file with basic metadata
// ============================================

async function pass1_skeleton() {
  console.log('\n━━━ PASS 1: SKELETON ━━━');
  console.log('Creating basic file nodes...\n');
  
  // Add project root
  graph.nodes['project:engzny'] = {
    id: 'project:engzny',
    type: 'project',
    name: 'Engzny',
    path: '/',
    children: [],
  };
  
  for (const filePath of FILES_TO_ANALYZE) {
    const fullPath = path.join(PROJECT_ROOT, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    
    const nodeId = `file:${filePath}`;
    
    graph.nodes[nodeId] = {
      id: nodeId,
      type: 'file',
      path: filePath,
      name: path.basename(filePath),
      directory: path.dirname(filePath),
      extension: path.extname(filePath),
      lineCount: lines.length,
      sizeBytes: content.length,
      // To be filled in later passes
      purpose: null,
      exports: [],
      imports: [],
      questions: [],
      concepts: [],
    };
    
    console.log(`  📄 ${filePath} (${lines.length} lines)`);
    
    // Track in project children (just directories for now)
    const dir = path.dirname(filePath);
    if (!graph.nodes[`dir:${dir}`]) {
      graph.nodes[`dir:${dir}`] = {
        id: `dir:${dir}`,
        type: 'directory',
        path: dir,
        name: dir,
        children: [],
      };
      graph.nodes['project:engzny'].children.push(`dir:${dir}`);
    }
    graph.nodes[`dir:${dir}`].children.push(nodeId);
  }
  
  graph.buildPasses.push({ pass: 1, name: 'skeleton', timestamp: new Date().toISOString() });
  console.log(`\n✓ Created ${Object.keys(graph.nodes).length} nodes`);
}

// ============================================
// PASS 2: UNDERSTAND
// LLM analyzes each file to understand its purpose
// ============================================

async function pass2_understand() {
  console.log('\n━━━ PASS 2: UNDERSTAND ━━━');
  console.log('Analyzing each file with LLM...\n');
  
  for (const filePath of FILES_TO_ANALYZE) {
    const fullPath = path.join(PROJECT_ROOT, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const nodeId = `file:${filePath}`;
    
    console.log(`  🔍 Analyzing ${filePath}...`);
    
    const prompt = `You are analyzing a source file to build a knowledge graph for code documentation.

FILE: ${filePath}
CONTENT:
\`\`\`
${content.slice(0, 8000)}${content.length > 8000 ? '\n... (truncated)' : ''}
\`\`\`

Analyze this file and return JSON with:
{
  "purpose": "One sentence explaining what this file does and why it exists",
  "exports": ["list of functions/classes/constants this file exports"],
  "keyElements": [
    {
      "name": "functionOrClassName",
      "type": "function|class|constant|endpoint",
      "lineStart": 10,
      "lineEnd": 50,
      "description": "What it does"
    }
  ],
  "dependencies": ["other files this imports/requires (relative paths)"],
  "businessPurpose": "In plain English, what business problem does this solve?"
}

Return ONLY valid JSON, no markdown.`;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const text = response.content[0].text;
      const analysis = JSON.parse(text);
      
      // Update node
      graph.nodes[nodeId].purpose = analysis.purpose;
      graph.nodes[nodeId].exports = analysis.exports || [];
      graph.nodes[nodeId].keyElements = analysis.keyElements || [];
      graph.nodes[nodeId].dependencies = analysis.dependencies || [];
      graph.nodes[nodeId].businessPurpose = analysis.businessPurpose;
      
      console.log(`     └─ ${analysis.purpose?.slice(0, 60)}...`);
      
      // Create nodes for key elements
      for (const elem of analysis.keyElements || []) {
        const elemId = `${elem.type}:${filePath}:${elem.name}`;
        graph.nodes[elemId] = {
          id: elemId,
          type: elem.type,
          name: elem.name,
          parentFile: nodeId,
          lineStart: elem.lineStart,
          lineEnd: elem.lineEnd,
          description: elem.description,
        };
        
        // Edge: file contains element
        graph.edges.push({
          from: nodeId,
          to: elemId,
          type: 'contains',
        });
      }
      
    } catch (err) {
      console.log(`     ⚠️  Failed: ${err.message}`);
    }
    
    // Small delay to avoid rate limits
    await delay(500);
  }
  
  graph.buildPasses.push({ pass: 2, name: 'understand', timestamp: new Date().toISOString() });
}

// ============================================
// PASS 3: CONNECT
// LLM identifies relationships between files
// ============================================

async function pass3_connect() {
  console.log('\n━━━ PASS 3: CONNECT ━━━');
  console.log('Discovering relationships...\n');
  
  // Build a summary of all files for context
  const fileSummaries = FILES_TO_ANALYZE.map(f => {
    const node = graph.nodes[`file:${f}`];
    return `- ${f}: ${node.purpose || 'Unknown'}`;
  }).join('\n');
  
  for (const filePath of FILES_TO_ANALYZE) {
    const nodeId = `file:${filePath}`;
    const node = graph.nodes[nodeId];
    
    console.log(`  🔗 Finding connections for ${filePath}...`);
    
    const prompt = `You are building a knowledge graph. Given this file and the list of all files in the project, identify relationships.

THIS FILE: ${filePath}
PURPOSE: ${node.purpose}
EXPORTS: ${JSON.stringify(node.exports)}
DEPENDENCIES: ${JSON.stringify(node.dependencies)}

ALL FILES IN PROJECT:
${fileSummaries}

What relationships does ${filePath} have with other files? Consider:
1. IMPORTS - files this directly imports/requires
2. USED_BY - files that likely use this file's exports
3. CALLS - if this file calls functions from another
4. IMPLEMENTS - if this file implements an interface/contract from another
5. EXTENDS - if this file extends functionality from another

Return JSON:
{
  "relationships": [
    {
      "targetFile": "path/to/other.js",
      "type": "imports|used_by|calls|implements|extends",
      "reason": "Why this relationship exists"
    }
  ]
}

Return ONLY valid JSON.`;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const text = response.content[0].text;
      const result = JSON.parse(text);
      
      for (const rel of result.relationships || []) {
        const targetId = `file:${rel.targetFile}`;
        
        // Only add if target exists
        if (graph.nodes[targetId]) {
          graph.edges.push({
            from: nodeId,
            to: targetId,
            type: rel.type,
            reason: rel.reason,
          });
          console.log(`     └─ ${rel.type} → ${rel.targetFile}`);
        }
      }
      
    } catch (err) {
      console.log(`     ⚠️  Failed: ${err.message}`);
    }
    
    await delay(500);
  }
  
  graph.buildPasses.push({ pass: 3, name: 'connect', timestamp: new Date().toISOString() });
  console.log(`\n✓ Created ${graph.edges.length} edges`);
}

// ============================================
// PASS 4: CONCEPTS
// LLM extracts business concepts
// ============================================

async function pass4_concepts() {
  console.log('\n━━━ PASS 4: CONCEPTS ━━━');
  console.log('Extracting business concepts...\n');
  
  // Gather all file purposes for context
  const allPurposes = FILES_TO_ANALYZE.map(f => {
    const node = graph.nodes[`file:${f}`];
    return `${f}: ${node.businessPurpose || node.purpose}`;
  }).join('\n');
  
  const prompt = `You are building a knowledge graph for a codebase. Based on these file descriptions, identify the key BUSINESS CONCEPTS that span multiple files.

FILES AND THEIR PURPOSES:
${allPurposes}

Identify 8-15 high-level concepts that a developer or stakeholder would want to understand. These should be BUSINESS concepts, not just technical terms.

Good examples: "Image Upload Flow", "AI-Powered Analysis", "Real-time Progress Updates"
Bad examples: "JavaScript", "Functions", "HTTP"

Return JSON:
{
  "concepts": [
    {
      "name": "Concept Name",
      "description": "2-3 sentence explanation in plain English",
      "involvedFiles": ["file1.js", "file2.js"],
      "keyQuestions": [
        "Question a developer might ask that this concept answers"
      ]
    }
  ]
}

Return ONLY valid JSON.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });
    
    const text = response.content[0].text;
    const result = JSON.parse(text);
    
    for (const concept of result.concepts || []) {
      const conceptId = `concept:${concept.name.toLowerCase().replace(/\s+/g, '-')}`;
      
      graph.nodes[conceptId] = {
        id: conceptId,
        type: 'concept',
        name: concept.name,
        description: concept.description,
        keyQuestions: concept.keyQuestions || [],
      };
      
      console.log(`  💡 ${concept.name}`);
      console.log(`     └─ ${concept.description.slice(0, 60)}...`);
      
      // Link concept to involved files
      for (const file of concept.involvedFiles || []) {
        const fileId = `file:${file}`;
        if (graph.nodes[fileId]) {
          graph.edges.push({
            from: conceptId,
            to: fileId,
            type: 'implemented_in',
          });
          
          // Also track on file node
          graph.nodes[fileId].concepts = graph.nodes[fileId].concepts || [];
          graph.nodes[fileId].concepts.push(conceptId);
        }
      }
    }
    
  } catch (err) {
    console.log(`  ⚠️  Failed: ${err.message}`);
  }
  
  graph.buildPasses.push({ pass: 4, name: 'concepts', timestamp: new Date().toISOString() });
}

// ============================================
// PASS 5: QUESTIONS
// Generate questions each file can answer
// ============================================

async function pass5_questions() {
  console.log('\n━━━ PASS 5: QUESTIONS ━━━');
  console.log('Generating answerable questions...\n');
  
  for (const filePath of FILES_TO_ANALYZE) {
    const fullPath = path.join(PROJECT_ROOT, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const nodeId = `file:${filePath}`;
    const node = graph.nodes[nodeId];
    
    console.log(`  ❓ ${filePath}...`);
    
    const prompt = `You are building a knowledge graph. For this file, generate questions that a developer might ask where THIS FILE contains the answer.

FILE: ${filePath}
PURPOSE: ${node.purpose}
BUSINESS PURPOSE: ${node.businessPurpose}
KEY ELEMENTS: ${JSON.stringify(node.keyElements?.map(e => e.name))}

CODE (first 3000 chars):
\`\`\`
${content.slice(0, 3000)}
\`\`\`

Generate 5-10 questions that:
1. A developer would realistically ask
2. This specific file answers (not just relates to)
3. Range from simple ("What does X do?") to complex ("How do I modify Y?")

Return JSON:
{
  "questions": [
    {
      "question": "The question a developer would ask",
      "answerLocation": {
        "element": "functionName or section",
        "lineStart": 10,
        "lineEnd": 30
      },
      "shortAnswer": "1-2 sentence answer"
    }
  ]
}

Return ONLY valid JSON.`;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const text = response.content[0].text;
      const result = JSON.parse(text);
      
      // Create question nodes
      for (const q of result.questions || []) {
        const qId = `question:${nodeId}:${graph.nodes[nodeId].questions?.length || 0}`;
        
        graph.nodes[qId] = {
          id: qId,
          type: 'question',
          question: q.question,
          shortAnswer: q.shortAnswer,
          answerFile: nodeId,
          answerLocation: q.answerLocation,
        };
        
        // Edge: question answered by file
        graph.edges.push({
          from: qId,
          to: nodeId,
          type: 'answered_by',
          location: q.answerLocation,
        });
        
        // Track on file
        graph.nodes[nodeId].questions = graph.nodes[nodeId].questions || [];
        graph.nodes[nodeId].questions.push(qId);
      }
      
      console.log(`     └─ Generated ${result.questions?.length || 0} questions`);
      
    } catch (err) {
      console.log(`     ⚠️  Failed: ${err.message}`);
    }
    
    await delay(500);
  }
  
  graph.buildPasses.push({ pass: 5, name: 'questions', timestamp: new Date().toISOString() });
}

// ============================================
// UTILITIES
// ============================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function saveGraph() {
  // Ensure directory exists
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(graph, null, 2));
  console.log(`\n💾 Saved to ${OUTPUT_PATH}`);
}

function printStats() {
  const nodeTypes = {};
  const edgeTypes = {};
  
  for (const node of Object.values(graph.nodes)) {
    nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
  }
  
  for (const edge of graph.edges) {
    edgeTypes[edge.type] = (edgeTypes[edge.type] || 0) + 1;
  }
  
  console.log('\n━━━ FINAL STATISTICS ━━━');
  console.log(`\nNodes (${Object.keys(graph.nodes).length} total):`);
  Object.entries(nodeTypes).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
  
  console.log(`\nEdges (${graph.edges.length} total):`);
  Object.entries(edgeTypes).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
}

function generateCypherExamples() {
  console.log('\n━━━ EXAMPLE CYPHER QUERIES ━━━');
  console.log('\n// Find all files that implement a concept');
  console.log(`MATCH (c:Concept {name: "Image Upload Flow"})-[:IMPLEMENTED_IN]->(f:File)
RETURN f.path, f.purpose`);
  
  console.log('\n// Find answer to a question');
  console.log(`MATCH (q:Question)-[:ANSWERED_BY]->(f:File)
WHERE q.question CONTAINS "upload"
RETURN q.question, q.shortAnswer, f.path`);
  
  console.log('\n// Trace dependencies');
  console.log(`MATCH path = (f:File {path: "api/index.js"})-[:IMPORTS*1..3]->(dep:File)
RETURN path`);
  
  console.log('\n// What would break if I change this file?');
  console.log(`MATCH (f:File {path: "api/llm/adapter.js"})<-[:IMPLEMENTS]-(dependent:File)
RETURN dependent.path, dependent.purpose`);
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  ITERATIVE KNOWLEDGE GRAPH BUILDER        ║');
  console.log('║  Building understanding through 5 passes  ║');
  console.log('╚═══════════════════════════════════════════╝');
  
  const startTime = Date.now();
  
  // Run all passes
  await pass1_skeleton();
  saveGraph();
  
  await pass2_understand();
  saveGraph();
  
  await pass3_connect();
  saveGraph();
  
  await pass4_concepts();
  saveGraph();
  
  await pass5_questions();
  saveGraph();
  
  // Final output
  printStats();
  generateCypherExamples();
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Complete in ${elapsed}s`);
}

// Run
main().catch(console.error);
