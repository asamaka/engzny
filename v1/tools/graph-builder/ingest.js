#!/usr/bin/env node

/**
 * Code Knowledge Graph Ingestion CLI
 * Parses the codebase and loads it into Neo4j
 * 
 * Usage:
 *   node ingest.js                    # Full rebuild
 *   node ingest.js --skip-llm         # Skip LLM annotation (faster)
 *   node ingest.js --dry-run          # Parse only, don't load to Neo4j
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ora from 'ora';
import chalk from 'chalk';

import { parseJavaScript } from './parsers/js-parser.js';
import { parseHTML, extractFetchPatterns } from './parsers/html-parser.js';
import { extractConcepts, batchAnnotateFunctions } from './analyzers/concept-extractor.js';
import { detectSimilarities, detectPatterns, findRefactoringOpportunities } from './analyzers/similarity-detector.js';
import neo4jLoader from './loaders/neo4j-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  // Root directory to analyze (relative to this script)
  sourceRoot: path.resolve(__dirname, '../..'),
  
  // File patterns to include
  includePatterns: [
    'api/**/*.js',
    'public/**/*.html',
  ],
  
  // Patterns to exclude
  excludePatterns: [
    'node_modules',
    'tools/graph-builder',
    '.git',
    'test-images',
  ],
  
  // Neo4j connection (from env or defaults for local Docker)
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  },
};

// Parse command line args
const args = process.argv.slice(2);
const skipLLM = args.includes('--skip-llm');
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose') || args.includes('-v');

/**
 * Main ingestion pipeline
 */
async function main() {
  console.log(chalk.bold('\n🔍 Code Knowledge Graph Builder\n'));
  
  // Step 1: Discover files
  const spinner = ora('Discovering source files...').start();
  const files = discoverFiles(CONFIG.sourceRoot, CONFIG.includePatterns, CONFIG.excludePatterns);
  spinner.succeed(`Found ${files.length} files to analyze`);
  
  if (verbose) {
    files.forEach(f => console.log(chalk.dim(`  - ${f}`)));
  }

  // Step 2: Parse all files
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

  const parseSpinner = ora('Parsing source files...').start();
  
  for (const file of files) {
    const fullPath = path.join(CONFIG.sourceRoot, file);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const ext = path.extname(file);
    
    // Record file info
    parseResult.files.push({
      path: file,
      language: ext === '.html' ? 'html' : 'javascript',
      loc: content.split('\n').length,
      hash: simpleHash(content),
    });

    if (ext === '.js') {
      const jsResult = parseJavaScript(content, file);
      mergeResults(parseResult, jsResult);
    } else if (ext === '.html') {
      const htmlResult = parseHTML(content, file);
      mergeResults(parseResult, htmlResult);
      parseResult.uiComponents.push(...htmlResult.uiComponents);
      parseResult.apiCalls.push(...htmlResult.apiCalls);
      
      // Also extract fetch patterns from raw HTML for better API detection
      const fetchPatterns = extractFetchPatterns(content);
      parseResult.apiCalls.push(...fetchPatterns.map(p => ({
        ...p,
        file,
      })));
    }
  }

  parseSpinner.succeed(
    `Parsed: ${parseResult.functions.length} functions, ` +
    `${parseResult.endpoints.length} endpoints, ` +
    `${parseResult.uiComponents.length} UI components`
  );

  // Step 3: Detect similarities
  const simSpinner = ora('Detecting code similarities...').start();
  const similarities = detectSimilarities(parseResult.codeBlocks);
  const patterns = detectPatterns(parseResult.functions);
  const refactoringOps = findRefactoringOpportunities(similarities, patterns);
  simSpinner.succeed(
    `Found ${similarities.length} similar code blocks, ` +
    `${refactoringOps.length} refactoring opportunities`
  );

  // Report refactoring opportunities
  if (refactoringOps.length > 0) {
    console.log(chalk.yellow('\n📋 Refactoring Opportunities:'));
    refactoringOps.forEach((op, i) => {
      console.log(chalk.dim(`  ${i + 1}. [${op.priority}] ${op.description}`));
      console.log(chalk.dim(`     → ${op.suggestion}`));
    });
    console.log('');
  }

  // Step 4: LLM-based concept extraction (optional)
  let concepts = { concepts: [], dataFlows: [], functionAnnotations: {} };
  
  if (!skipLLM && process.env.ANTHROPIC_API_KEY) {
    const llmSpinner = ora('Extracting concepts with Claude...').start();
    try {
      concepts = await extractConcepts(parseResult);
      llmSpinner.succeed(
        `Extracted ${concepts.concepts?.length || 0} concepts, ` +
        `${concepts.dataFlows?.length || 0} data flows`
      );
      
      // Optionally annotate individual functions (slower but more detailed)
      if (!args.includes('--skip-annotations')) {
        const annotSpinner = ora('Annotating functions...').start();
        const significantFunctions = parseResult.functions.filter(
          f => f.endLine - f.startLine >= 5
        );
        const annotations = await batchAnnotateFunctions(
          significantFunctions.slice(0, 20) // Limit for speed
        );
        concepts.functionAnnotations = {
          ...concepts.functionAnnotations,
          ...annotations,
        };
        annotSpinner.succeed(`Annotated ${Object.keys(annotations).length} functions`);
      }
    } catch (error) {
      llmSpinner.fail(`LLM extraction failed: ${error.message}`);
    }
  } else if (skipLLM) {
    console.log(chalk.dim('  Skipping LLM extraction (--skip-llm flag)'));
  } else {
    console.log(chalk.dim('  Skipping LLM extraction (no ANTHROPIC_API_KEY)'));
  }

  // Step 5: Load into Neo4j (unless dry run)
  if (dryRun) {
    console.log(chalk.yellow('\n⚠️  Dry run - skipping Neo4j load'));
    printSummary(parseResult, similarities, concepts);
    return;
  }

  const dbSpinner = ora('Connecting to Neo4j...').start();
  try {
    neo4jLoader.initNeo4j(
      CONFIG.neo4j.uri,
      CONFIG.neo4j.username,
      CONFIG.neo4j.password
    );
    dbSpinner.succeed('Connected to Neo4j');

    // Clear and rebuild
    const clearSpinner = ora('Clearing existing data...').start();
    await neo4jLoader.clearDatabase();
    clearSpinner.succeed('Database cleared');

    // Setup schema
    const schemaSpinner = ora('Setting up schema...').start();
    const schemaCypher = fs.readFileSync(
      path.join(__dirname, 'schema.cypher'),
      'utf-8'
    );
    await neo4jLoader.setupSchema(schemaCypher);
    schemaSpinner.succeed('Schema configured');

    // Load all data
    const loadSpinner = ora('Loading data...').start();
    
    await neo4jLoader.loadFiles(parseResult.files);
    loadSpinner.text = 'Loading functions...';
    await neo4jLoader.loadFunctions(parseResult.functions);
    loadSpinner.text = 'Loading calls...';
    await neo4jLoader.loadCalls(parseResult.calls);
    loadSpinner.text = 'Loading endpoints...';
    await neo4jLoader.loadEndpoints(parseResult.endpoints);
    loadSpinner.text = 'Loading imports...';
    await neo4jLoader.loadImports(parseResult.imports);
    loadSpinner.text = 'Loading UI components...';
    await neo4jLoader.loadUIComponents(parseResult.uiComponents);
    loadSpinner.text = 'Loading similarities...';
    await neo4jLoader.loadSimilarities(similarities);
    loadSpinner.text = 'Loading API relationships...';
    await neo4jLoader.loadAPICallRelationships(parseResult.apiCalls, parseResult.uiComponents);
    
    if (concepts.concepts?.length > 0) {
      loadSpinner.text = 'Loading concepts...';
      await neo4jLoader.loadConcepts(concepts.concepts);
    }
    
    if (Object.keys(concepts.functionAnnotations || {}).length > 0) {
      loadSpinner.text = 'Loading annotations...';
      await neo4jLoader.loadFunctionAnnotations(concepts.functionAnnotations);
    }

    loadSpinner.succeed('All data loaded');

    await neo4jLoader.closeNeo4j();
    
    console.log(chalk.green('\n✅ Knowledge graph built successfully!\n'));
    printSummary(parseResult, similarities, concepts);
    
    console.log(chalk.bold('\n📊 Query your graph:'));
    console.log(chalk.dim('  node query.js "What happens when an image is uploaded?"'));
    console.log(chalk.dim('  node query.js --cypher "MATCH (e:Endpoint) RETURN e.method, e.path"'));
    console.log('');

  } catch (error) {
    dbSpinner.fail(`Neo4j error: ${error.message}`);
    console.log(chalk.dim('\nMake sure Neo4j is running. Quick start with Docker:'));
    console.log(chalk.dim('  docker run -d --name neo4j -p 7474:7474 -p 7687:7687 \\'));
    console.log(chalk.dim('    -e NEO4J_AUTH=neo4j/password neo4j:latest'));
    console.log('');
    process.exit(1);
  }
}

/**
 * Discover files matching patterns
 */
function discoverFiles(root, includePatterns, excludePatterns) {
  const files = [];
  
  function matchesPattern(filePath, pattern) {
    // Convert glob pattern to a simple matching logic
    // Pattern: "api/**/*.js" means: starts with "api/" and ends with ".js"
    // Pattern: "public/**/*.html" means: starts with "public/" and ends with ".html"
    
    const parts = pattern.split('/**/');
    if (parts.length === 2) {
      const [dirPrefix, fileSuffix] = parts;
      // dirPrefix = "api", fileSuffix = "*.js"
      const dirMatch = filePath.startsWith(dirPrefix + path.sep) || filePath.startsWith(dirPrefix + '/');
      const ext = fileSuffix.replace('*', ''); // "*.js" -> ".js"
      const extMatch = filePath.endsWith(ext);
      return dirMatch && extMatch;
    }
    
    // Simple pattern like "*.js"
    if (pattern.startsWith('*')) {
      return filePath.endsWith(pattern.slice(1));
    }
    
    return filePath.includes(pattern);
  }
  
  function walk(dir, relativePath = '') {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      console.warn(`Could not read directory: ${dir}`);
      return;
    }
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      
      // Check exclusions
      if (excludePatterns.some(p => relPath.includes(p))) {
        continue;
      }
      
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        // Check if matches any include pattern
        const matches = includePatterns.some(pattern => matchesPattern(relPath, pattern));
        
        if (matches) {
          files.push(relPath);
        }
      }
    }
  }
  
  walk(root);
  return files;
}

/**
 * Merge parse results
 */
function mergeResults(target, source) {
  ['functions', 'calls', 'imports', 'exports', 'variables', 'endpoints', 'codeBlocks'].forEach(key => {
    if (source[key]) {
      target[key].push(...source[key]);
    }
  });
}

/**
 * Simple hash for file content
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Print summary
 */
function printSummary(parseResult, similarities, concepts) {
  console.log(chalk.bold('📈 Graph Summary:'));
  console.log(chalk.dim(`  Files:          ${parseResult.files.length}`));
  console.log(chalk.dim(`  Functions:      ${parseResult.functions.length}`));
  console.log(chalk.dim(`  Endpoints:      ${parseResult.endpoints.length}`));
  console.log(chalk.dim(`  UI Components:  ${parseResult.uiComponents.length}`));
  console.log(chalk.dim(`  Imports:        ${parseResult.imports.length}`));
  console.log(chalk.dim(`  Similarities:   ${similarities.length}`));
  console.log(chalk.dim(`  Concepts:       ${concepts.concepts?.length || 0}`));
  console.log(chalk.dim(`  Data Flows:     ${concepts.dataFlows?.length || 0}`));
}

// Run
main().catch(error => {
  console.error(chalk.red('\n❌ Fatal error:'), error);
  process.exit(1);
});
