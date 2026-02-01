#!/usr/bin/env node

/**
 * Code Knowledge Graph Query Interface
 * Query your code graph using natural language or Cypher
 * 
 * Usage:
 *   node query.js "What happens when an image is uploaded?"
 *   node query.js "What would break if I changed the upload endpoint?"
 *   node query.js --cypher "MATCH (e:Endpoint) RETURN e.method, e.path"
 *   node query.js --interactive
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import chalk from 'chalk';
import Anthropic from '@anthropic-ai/sdk';
import neo4jLoader from './loaders/neo4j-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  },
};

// Cypher query templates for common questions
const QUERY_TEMPLATES = {
  // Find functions and their locations
  findFunction: (name) => `
    MATCH (fn:Function)
    WHERE fn.name CONTAINS '${name}'
    RETURN fn.name, fn.file, fn.startLine, fn.endLine, fn.purpose
    LIMIT 10
  `,

  // Find what calls a function
  findCallers: (name) => `
    MATCH (caller:Function)-[r:CALLS]->(fn:Function)
    WHERE fn.name CONTAINS '${name}'
    RETURN caller.name, caller.file, r.line, fn.name
  `,

  // Find what a function calls
  findCallees: (name) => `
    MATCH (fn:Function)-[r:CALLS]->(callee:Function)
    WHERE fn.name CONTAINS '${name}'
    RETURN fn.name, callee.name, callee.file, r.line
  `,

  // Find all endpoints
  allEndpoints: () => `
    MATCH (e:Endpoint)
    OPTIONAL MATCH (e)-[:ROUTES_TO]->(fn:Function)
    RETURN e.method, e.path, e.file, e.line, fn.name as handler
    ORDER BY e.path
  `,

  // Find endpoint and its dependencies
  endpointDependencies: (path) => `
    MATCH (e:Endpoint)-[:ROUTES_TO]->(fn:Function)
    WHERE e.path CONTAINS '${path}'
    OPTIONAL MATCH (fn)-[:CALLS*1..3]->(dep:Function)
    RETURN e.method, e.path, fn.name, collect(DISTINCT dep.name) as dependencies
  `,

  // Find UI to API connections
  uiToApi: () => `
    MATCH (ui:UIComponent)-[:READS_DATA]->(e:Endpoint)
    RETURN ui.name, ui.file, e.method, e.path
  `,

  // Find similar code
  similarCode: () => `
    MATCH (fn1:Function)-[r:SIMILAR_TO]-(fn2:Function)
    WHERE r.similarity >= 0.7
    RETURN fn1.name, fn1.file, fn2.name, fn2.file, r.similarity, r.type
    ORDER BY r.similarity DESC
    LIMIT 20
  `,

  // Find concepts and what implements them
  concepts: () => `
    MATCH (c:Concept)
    OPTIONAL MATCH (fn:Function)-[:IMPLEMENTS]->(c)
    RETURN c.name, c.description, c.category, collect(fn.name) as implementedBy
  `,

  // Find data flow for a concept
  dataFlow: (concept) => `
    MATCH (c:Concept {name: '${concept}'})
    MATCH (fn:Function)-[:IMPLEMENTS]->(c)
    OPTIONAL MATCH (fn)-[:CALLS]->(called:Function)
    RETURN c.name, fn.name, fn.file, collect(called.name) as calls
  `,

  // Impact analysis - what breaks if X changes
  impactAnalysis: (functionName) => `
    MATCH (fn:Function)
    WHERE fn.name CONTAINS '${functionName}'
    OPTIONAL MATCH (caller:Function)-[:CALLS]->(fn)
    OPTIONAL MATCH (ui:UIComponent)-[:READS_DATA]->(:Endpoint)-[:ROUTES_TO]->(fn)
    OPTIONAL MATCH (e:Endpoint)-[:ROUTES_TO]->(fn)
    RETURN fn.name, fn.file,
           collect(DISTINCT caller.name) as calledBy,
           collect(DISTINCT ui.name) as uiDependents,
           collect(DISTINCT e.path) as endpoints
  `,

  // Full graph overview
  overview: () => `
    MATCH (n)
    RETURN labels(n)[0] as type, count(*) as count
    ORDER BY count DESC
  `,
};

/**
 * Natural language query handler using Claude
 */
async function handleNaturalLanguageQuery(question) {
  // First, get graph context
  const context = await getGraphContext();
  
  const client = new Anthropic();
  
  const systemPrompt = `You are a code analysis assistant with access to a Neo4j knowledge graph of a codebase.

The graph contains:
- Files: Source code files
- Functions: With name, file, startLine, endLine, purpose
- Endpoints: API routes with method, path, handler
- UIComponents: Frontend sections
- Concepts: Business domains
- Relationships: CALLS, CONTAINS, IMPLEMENTS, SIMILAR_TO, READS_DATA, ROUTES_TO

Here's the current graph context:
${JSON.stringify(context, null, 2)}

When answering questions:
1. Reference specific files and line numbers when possible
2. Explain the relationships and data flow
3. If asked about changes/refactoring, list all affected components
4. Generate Cypher queries when more specific data is needed

Format line references as: \`filename:lineNumber\``;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Question about the codebase: ${question}

If you need to run a Cypher query to answer this, output it in a code block with \`\`\`cypher and I'll run it for you. Otherwise, answer directly based on the context provided.`,
      },
    ],
  });

  const answer = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Check if there's a Cypher query to run
  const cypherMatch = answer.match(/```cypher\n([\s\S]*?)\n```/);
  
  if (cypherMatch) {
    const cypherQuery = cypherMatch[1];
    console.log(chalk.dim('\nRunning generated Cypher query...'));
    
    try {
      const results = await neo4jLoader.runQuery(cypherQuery);
      
      // Get Claude to interpret the results
      const followUp = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: `Original question: ${question}

I ran this Cypher query:
\`\`\`cypher
${cypherQuery}
\`\`\`

Results:
${JSON.stringify(results, null, 2)}

Please provide a clear, helpful answer based on these results. Reference specific files and line numbers.`,
          },
        ],
      });

      return followUp.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    } catch (error) {
      return answer + `\n\n(Note: Failed to run query: ${error.message})`;
    }
  }

  return answer;
}

/**
 * Get general graph context for LLM
 */
async function getGraphContext() {
  const context = {};
  
  // Get overview
  try {
    context.overview = await neo4jLoader.runQuery(QUERY_TEMPLATES.overview());
  } catch (e) {
    context.overview = [];
  }
  
  // Get endpoints
  try {
    context.endpoints = await neo4jLoader.runQuery(QUERY_TEMPLATES.allEndpoints());
  } catch (e) {
    context.endpoints = [];
  }
  
  // Get concepts
  try {
    context.concepts = await neo4jLoader.runQuery(QUERY_TEMPLATES.concepts());
  } catch (e) {
    context.concepts = [];
  }
  
  // Get similarities
  try {
    context.similarities = await neo4jLoader.runQuery(QUERY_TEMPLATES.similarCode());
  } catch (e) {
    context.similarities = [];
  }
  
  // Get UI-API connections
  try {
    context.uiConnections = await neo4jLoader.runQuery(QUERY_TEMPLATES.uiToApi());
  } catch (e) {
    context.uiConnections = [];
  }
  
  return context;
}

/**
 * Run a Cypher query directly
 */
async function runCypherQuery(query) {
  const results = await neo4jLoader.runQuery(query);
  return results;
}

/**
 * Interactive mode
 */
async function interactiveMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.bold('\n🔍 Code Knowledge Graph - Interactive Mode'));
  console.log(chalk.dim('Ask questions about your codebase in natural language.'));
  console.log(chalk.dim('Use /cypher <query> for direct Cypher queries.'));
  console.log(chalk.dim('Type "exit" or Ctrl+C to quit.\n'));

  const prompt = () => {
    rl.question(chalk.cyan('> '), async (input) => {
      const trimmed = input.trim();
      
      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
        console.log(chalk.dim('\nGoodbye!'));
        rl.close();
        await neo4jLoader.closeNeo4j();
        process.exit(0);
      }

      try {
        let result;
        
        if (trimmed.startsWith('/cypher ')) {
          const query = trimmed.slice(8);
          console.log(chalk.dim('\nRunning Cypher query...'));
          result = await runCypherQuery(query);
          console.log(chalk.green('\nResults:'));
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.dim('\nThinking...'));
          result = await handleNaturalLanguageQuery(trimmed);
          console.log(chalk.green('\n' + result));
        }
      } catch (error) {
        console.log(chalk.red('\nError:'), error.message);
      }

      console.log('');
      prompt();
    });
  };

  prompt();
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
${chalk.bold('Code Knowledge Graph Query Tool')}

${chalk.yellow('Usage:')}
  node query.js <question>              Natural language query
  node query.js --cypher "<query>"      Run Cypher query directly
  node query.js --interactive           Interactive mode
  node query.js --help                  Show this help

${chalk.yellow('Examples:')}
  node query.js "What happens when an image is uploaded?"
  node query.js "What would break if I changed compressImageForAPI?"
  node query.js "Show me all duplicate code"
  node query.js "How does the frontend connect to the API?"
  
  node query.js --cypher "MATCH (e:Endpoint) RETURN e.method, e.path"
  node query.js --cypher "MATCH (fn:Function)-[:CALLS]->(other) RETURN fn.name, other.name LIMIT 20"

${chalk.yellow('Useful Cypher Queries:')}
  All endpoints:
    MATCH (e:Endpoint) RETURN e.method, e.path, e.file

  Function callers:
    MATCH (caller)-[:CALLS]->(fn:Function {name: 'functionName'}) RETURN caller

  Similar code:
    MATCH (a)-[r:SIMILAR_TO]-(b) WHERE r.similarity > 0.8 RETURN a, b, r.similarity

  UI-API connections:
    MATCH (ui:UIComponent)-[:READS_DATA]->(e:Endpoint) RETURN ui.name, e.path
`);
}

/**
 * Main
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Connect to Neo4j
  try {
    neo4jLoader.initNeo4j(
      CONFIG.neo4j.uri,
      CONFIG.neo4j.username,
      CONFIG.neo4j.password
    );
  } catch (error) {
    console.error(chalk.red('Failed to connect to Neo4j:'), error.message);
    console.log(chalk.dim('\nMake sure Neo4j is running and the connection details are correct.'));
    process.exit(1);
  }

  try {
    if (args.includes('--interactive') || args.includes('-i')) {
      await interactiveMode();
      return; // Interactive mode handles its own exit
    }

    if (args.includes('--cypher')) {
      const cypherIndex = args.indexOf('--cypher');
      const query = args[cypherIndex + 1];
      
      if (!query) {
        console.error(chalk.red('No Cypher query provided'));
        process.exit(1);
      }

      console.log(chalk.dim('Running Cypher query...\n'));
      const results = await runCypherQuery(query);
      
      if (results.length === 0) {
        console.log(chalk.yellow('No results found.'));
      } else {
        console.log(chalk.green('Results:'));
        console.table(results);
      }
    } else {
      // Natural language query
      const question = args.join(' ');
      
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error(chalk.red('ANTHROPIC_API_KEY required for natural language queries.'));
        console.log(chalk.dim('Set it in your environment or use --cypher for direct queries.'));
        process.exit(1);
      }

      console.log(chalk.dim('Analyzing your question...\n'));
      const answer = await handleNaturalLanguageQuery(question);
      console.log(answer);
    }
  } finally {
    await neo4jLoader.closeNeo4j();
  }
}

main().catch((error) => {
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
});
