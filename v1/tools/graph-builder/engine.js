/**
 * Knowledge Engine
 * Processes technical data and business concepts into a unified graph
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseJavaScript } from './parsers/js-parser.js';
import { parseHTML } from './parsers/html-parser.js';
import { detectSimilarities } from './analyzers/similarity-detector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceRoot = path.resolve(__dirname, '../..');

/**
 * The "Knowledge Layer" - Business concepts mapped to code
 * This is the 'Senior SWE Memory' represented as data
 */
const BUSINESS_KNOWLEDGE = {
  concepts: [
    {
      id: 'c_image_pipeline',
      name: 'Image Processing Pipeline',
      description: 'The end-to-end flow of image upload, validation, and compression before AI analysis.',
      domain: 'Core Product',
      criticality: 'High',
      implementations: ['api/index.js:compressImageForAPI', 'api/index.js:detectMediaType']
    },
    {
      id: 'c_job_lifecycle',
      name: 'Asynchronous Job Lifecycle',
      description: 'Manages the state of an analysis request from Queued to Streaming to Completed.',
      domain: 'Infrastructure',
      criticality: 'High',
      implementations: ['api/index.js:JOB_STATUS', 'api/index.js:storage', 'public/job.html']
    },
    {
      id: 'c_ai_reasoning',
      name: 'AI Reasoning & Prompting',
      description: 'The logic that structures how Claude analyzes images based on user questions.',
      domain: 'AI/LLM',
      criticality: 'Highest',
      implementations: ['api/index.js:buildAnalysisPrompt', 'api/index.js:getAnthropicClient']
    },
    {
      id: 'c_realtime_comm',
      name: 'Real-time Result Streaming',
      description: 'Using Server-Sent Events (SSE) to push AI tokens to the UI as they are generated.',
      domain: 'User Experience',
      criticality: 'Medium',
      implementations: ['api/index.js:/api/job/:jobId/stream', 'public/job.html:connectToStream']
    }
  ],
  rules: [
    {
      name: 'Size Limitation',
      description: 'Images must be under 5MB for Claude API compatibility.',
      target: 'api/index.js:MAX_IMAGE_SIZE'
    }
  ]
};

async function buildUnifiedGraph() {
  console.log('🧠 Building Knowledge Graph...');
  
  const files = [];
  function walk(dir, rel = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory() && !['node_modules', 'tools', '.git'].some(p => r.includes(p))) walk(path.join(dir, e.name), r);
      else if (e.isFile() && (r.endsWith('.js') || r.endsWith('.html'))) files.push(r);
    }
  }
  walk(sourceRoot);

  const techData = {
    files: [], functions: [], endpoints: [], ui: [], calls: [], similarities: []
  };

  files.forEach(file => {
    const content = fs.readFileSync(path.join(sourceRoot, file), 'utf-8');
    const ext = path.extname(file);
    techData.files.push({ path: file, loc: content.split('\n').length });

    if (ext === '.js') {
      const r = parseJavaScript(content, file);
      techData.functions.push(...r.functions);
      techData.endpoints.push(...r.endpoints);
      techData.calls.push(...r.calls);
    } else {
      const r = parseHTML(content, file);
      techData.ui.push(...r.uiComponents);
      techData.functions.push(...r.functions);
      techData.calls.push(...r.calls);
    }
  });

  techData.functions.forEach(f => {
    f.normalizedCode = f.code ? f.code.replace(/\s+/g, ' ') : '';
  });

  const similarities = detectSimilarities(techData.functions.map(f => ({
    hash: f.id, 
    functionId: f.id, 
    normalizedCode: f.normalizedCode, 
    lineCount: (f.endLine - f.startLine) || 1
  })));

  const finalGraph = {
    metadata: {
      generatedAt: new Date().toISOString(),
      project: 'thinx.fun'
    },
    knowledgeLayer: BUSINESS_KNOWLEDGE,
    technicalLayer: {
      ...techData,
      similarities
    }
  };

  fs.writeFileSync(path.join(__dirname, 'knowledge-graph.json'), JSON.stringify(finalGraph, null, 2));
  console.log('✅ Unified Knowledge Graph saved to knowledge-graph.json');
}

buildUnifiedGraph();
