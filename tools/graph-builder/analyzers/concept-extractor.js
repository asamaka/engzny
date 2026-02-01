/**
 * Concept Extractor
 * Uses Claude to identify business concepts and annotate functions with semantic meaning
 */

import Anthropic from '@anthropic-ai/sdk';

let anthropicClient = null;

function getClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

/**
 * Extract high-level concepts from the codebase
 * @param {Object} parseResult - Combined parsing results from all files
 * @returns {Promise<Object>} Concepts and annotations
 */
export async function extractConcepts(parseResult) {
  const client = getClient();
  
  // Build a summary of the codebase for Claude
  const codebaseSummary = buildCodebaseSummary(parseResult);
  
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `You are analyzing a codebase to extract high-level business concepts and domains.

Here's a summary of the codebase:

${codebaseSummary}

Please identify:

1. **Core Concepts/Domains**: The main business domains this code handles (e.g., "User Authentication", "Image Processing", "Job Queue Management")

2. **For each concept, provide**:
   - A clear name
   - A brief description
   - Category (one of: core-feature, infrastructure, integration, utility)
   - Which functions implement this concept (by function name)

3. **Data Flow Patterns**: How data moves through the system (e.g., "Image Upload → Compression → Storage → LLM Analysis → Streaming Response")

Respond in JSON format:
{
  "concepts": [
    {
      "name": "Concept Name",
      "description": "What this concept represents",
      "category": "core-feature|infrastructure|integration|utility",
      "implementedBy": ["functionName1", "functionName2"],
      "relatedEndpoints": ["/api/path"],
      "relatedFiles": ["path/to/file.js"]
    }
  ],
  "dataFlows": [
    {
      "name": "Flow Name",
      "description": "Description of data flow",
      "steps": ["step1", "step2", "step3"],
      "involvedFunctions": ["func1", "func2"]
    }
  ],
  "functionAnnotations": {
    "functionName": {
      "purpose": "What this function does",
      "concepts": ["Concept1", "Concept2"],
      "dependencies": ["what it depends on"],
      "sideEffects": ["what it affects"]
    }
  }
}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Parse JSON from response
  try {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const jsonStr = jsonMatch[1] || text;
    return JSON.parse(jsonStr.trim());
  } catch (error) {
    console.error('Failed to parse concept extraction response:', error.message);
    console.error('Raw response:', text);
    return {
      concepts: [],
      dataFlows: [],
      functionAnnotations: {},
    };
  }
}

/**
 * Annotate a specific function with its purpose and relationships
 */
export async function annotateFunction(func, context) {
  const client = getClient();
  
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Analyze this function and provide semantic annotations:

Function: ${func.name}
File: ${func.file}
Lines: ${func.startLine}-${func.endLine}
Parameters: ${func.params?.join(', ') || 'none'}
Async: ${func.async}

Code:
\`\`\`javascript
${func.code}
\`\`\`

Context (other functions in same file):
${context.otherFunctions?.map(f => `- ${f.name}`).join('\n') || 'none'}

Provide a JSON response:
{
  "purpose": "One sentence description of what this function does",
  "businessDomain": "The high-level domain this belongs to",
  "inputDescription": "What the inputs represent",
  "outputDescription": "What the function returns/produces",
  "sideEffects": ["List of side effects like DB writes, API calls, etc."],
  "errorHandling": "How errors are handled",
  "complexity": "low|medium|high",
  "suggestions": ["Optional improvement suggestions"]
}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const jsonStr = jsonMatch[1] || text;
    return JSON.parse(jsonStr.trim());
  } catch (error) {
    return {
      purpose: 'Failed to analyze',
      businessDomain: 'unknown',
      inputDescription: '',
      outputDescription: '',
      sideEffects: [],
      errorHandling: 'unknown',
      complexity: 'unknown',
    };
  }
}

/**
 * Build a summary of the codebase for concept extraction
 */
function buildCodebaseSummary(parseResult) {
  const { files, functions, endpoints, imports, variables } = parseResult;
  
  let summary = '';
  
  // File overview
  summary += '## Files\n';
  files.forEach((f) => {
    summary += `- ${f.path} (${f.language}, ${f.loc} lines)\n`;
  });
  
  // Endpoints
  summary += '\n## API Endpoints\n';
  endpoints.forEach((e) => {
    summary += `- ${e.method} ${e.path} → ${e.handler} (${e.file}:${e.line})\n`;
  });
  
  // Functions (grouped by file)
  summary += '\n## Functions\n';
  const functionsByFile = {};
  functions.forEach((f) => {
    if (!functionsByFile[f.file]) functionsByFile[f.file] = [];
    functionsByFile[f.file].push(f);
  });
  
  Object.entries(functionsByFile).forEach(([file, funcs]) => {
    summary += `\n### ${file}\n`;
    funcs.forEach((f) => {
      const params = f.params?.length > 0 ? `(${f.params.join(', ')})` : '()';
      summary += `- ${f.async ? 'async ' : ''}${f.name}${params} [lines ${f.startLine}-${f.endLine}]\n`;
    });
  });
  
  // Key variables/constants
  summary += '\n## Key Variables\n';
  variables.slice(0, 20).forEach((v) => {
    summary += `- ${v.name}: ${v.value} (${v.file}:${v.line})\n`;
  });
  
  // Dependencies
  summary += '\n## External Dependencies\n';
  const uniqueDeps = [...new Set(imports.filter(i => !i.source.startsWith('.')).map(i => i.source))];
  uniqueDeps.forEach((dep) => {
    summary += `- ${dep}\n`;
  });
  
  return summary;
}

/**
 * Batch annotate multiple functions (more efficient)
 */
export async function batchAnnotateFunctions(functions, batchSize = 5) {
  const annotations = {};
  
  for (let i = 0; i < functions.length; i += batchSize) {
    const batch = functions.slice(i, i + batchSize);
    
    // Process batch in parallel
    const results = await Promise.all(
      batch.map((func) => 
        annotateFunction(func, { 
          otherFunctions: functions.filter(f => f.file === func.file && f.name !== func.name)
        })
      )
    );
    
    batch.forEach((func, idx) => {
      annotations[func.id] = results[idx];
    });
    
    // Small delay to avoid rate limiting
    if (i + batchSize < functions.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return annotations;
}

export default { extractConcepts, annotateFunction, batchAnnotateFunctions };
