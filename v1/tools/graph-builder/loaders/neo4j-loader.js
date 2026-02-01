/**
 * Neo4j Loader
 * Handles all database operations for the code knowledge graph
 */

import neo4j from 'neo4j-driver';

let driver = null;

/**
 * Initialize Neo4j connection
 */
export function initNeo4j(uri, username, password) {
  driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  return driver;
}

/**
 * Close Neo4j connection
 */
export async function closeNeo4j() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

/**
 * Get or create session
 */
function getSession() {
  if (!driver) {
    throw new Error('Neo4j not initialized. Call initNeo4j first.');
  }
  return driver.session();
}

/**
 * Clear all data (for rebuild)
 */
export async function clearDatabase() {
  const session = getSession();
  try {
    await session.run('MATCH (n) DETACH DELETE n');
  } finally {
    await session.close();
  }
}

/**
 * Run schema setup
 */
export async function setupSchema(schemaCypher) {
  const session = getSession();
  try {
    // Split by semicolons and run each statement
    const statements = schemaCypher
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('//'));
    
    for (const statement of statements) {
      try {
        await session.run(statement);
      } catch (error) {
        // Ignore "already exists" errors for constraints/indexes
        if (!error.message.includes('already exists')) {
          console.warn('Schema statement warning:', error.message);
        }
      }
    }
  } finally {
    await session.close();
  }
}

/**
 * Load files into Neo4j
 */
export async function loadFiles(files) {
  const session = getSession();
  try {
    for (const file of files) {
      await session.run(
        `MERGE (f:File {path: $path})
         SET f.language = $language,
             f.loc = $loc,
             f.hash = $hash`,
        {
          path: file.path,
          language: file.language,
          loc: file.loc,
          hash: file.hash || '',
        }
      );
    }
  } finally {
    await session.close();
  }
}

/**
 * Load functions into Neo4j
 */
export async function loadFunctions(functions) {
  const session = getSession();
  try {
    for (const func of functions) {
      await session.run(
        `MERGE (fn:Function {id: $id})
         SET fn.name = $name,
             fn.file = $file,
             fn.startLine = $startLine,
             fn.endLine = $endLine,
             fn.async = $async,
             fn.params = $params,
             fn.exported = $exported,
             fn.description = $description
         WITH fn
         MATCH (f:File {path: $file})
         MERGE (f)-[:CONTAINS]->(fn)`,
        {
          id: func.id,
          name: func.name,
          file: func.file,
          startLine: func.startLine,
          endLine: func.endLine,
          async: func.async || false,
          params: func.params || [],
          exported: func.exported || false,
          description: func.description || '',
        }
      );
    }
  } finally {
    await session.close();
  }
}

/**
 * Load function calls into Neo4j
 */
export async function loadCalls(calls) {
  const session = getSession();
  try {
    for (const call of calls) {
      // Try to find the caller function
      if (call.caller) {
        await session.run(
          `MATCH (caller:Function)
           WHERE caller.name = $callerName AND caller.file = $callerFile
           MATCH (callee:Function {name: $calleeName})
           MERGE (caller)-[r:CALLS]->(callee)
           SET r.line = $line,
               r.file = $file`,
          {
            callerName: call.caller,
            callerFile: call.callerFile,
            calleeName: call.callee.split('.').pop(), // Get last part of dotted name
            line: call.line,
            file: call.file,
          }
        );
      }
    }
  } finally {
    await session.close();
  }
}

/**
 * Load endpoints into Neo4j
 */
export async function loadEndpoints(endpoints) {
  const session = getSession();
  try {
    for (const endpoint of endpoints) {
      await session.run(
        `MERGE (e:Endpoint {id: $id})
         SET e.method = $method,
             e.path = $path,
             e.handler = $handler,
             e.file = $file,
             e.line = $line,
             e.middleware = $middleware
         WITH e
         MATCH (f:File {path: $file})
         MERGE (f)-[:DEFINES]->(e)`,
        {
          id: endpoint.id,
          method: endpoint.method,
          path: endpoint.path,
          handler: endpoint.handler,
          file: endpoint.file,
          line: endpoint.line,
          middleware: endpoint.middleware || [],
        }
      );

      // Link endpoint to handler function if it exists
      if (endpoint.handler && !endpoint.handler.startsWith('inline@')) {
        await session.run(
          `MATCH (e:Endpoint {id: $endpointId})
           MATCH (fn:Function {name: $handler})
           MERGE (e)-[:ROUTES_TO]->(fn)`,
          {
            endpointId: endpoint.id,
            handler: endpoint.handler,
          }
        );
      }
    }
  } finally {
    await session.close();
  }
}

/**
 * Load imports/dependencies into Neo4j
 */
export async function loadImports(imports) {
  const session = getSession();
  try {
    for (const imp of imports) {
      // Check if it's an external dependency
      if (!imp.source.startsWith('.') && !imp.source.startsWith('/')) {
        // External package
        await session.run(
          `MERGE (d:ExternalDep {name: $name})
           WITH d
           MATCH (f:File {path: $file})
           MERGE (f)-[r:IMPORTS]->(d)
           SET r.line = $line,
               r.specifiers = $specifiers`,
          {
            name: imp.source,
            file: imp.file,
            line: imp.line,
            specifiers: imp.specifiers.map(s => s.local).filter(Boolean),
          }
        );
      } else {
        // Internal import - link files
        // Resolve relative path (simplified)
        const sourcePath = resolveImportPath(imp.file, imp.source);
        await session.run(
          `MATCH (f1:File {path: $file})
           MATCH (f2:File) WHERE f2.path CONTAINS $sourcePath
           MERGE (f1)-[r:IMPORTS]->(f2)
           SET r.line = $line,
               r.specifiers = $specifiers`,
          {
            file: imp.file,
            sourcePath: imp.source.replace(/^\.\//, '').replace(/^\.\.\//, ''),
            line: imp.line,
            specifiers: imp.specifiers.map(s => s.local).filter(Boolean),
          }
        );
      }
    }
  } finally {
    await session.close();
  }
}

/**
 * Load concepts into Neo4j
 */
export async function loadConcepts(concepts) {
  const session = getSession();
  try {
    for (const concept of concepts) {
      await session.run(
        `MERGE (c:Concept {name: $name})
         SET c.description = $description,
             c.category = $category`,
        {
          name: concept.name,
          description: concept.description,
          category: concept.category,
        }
      );

      // Link functions to concepts
      for (const funcName of concept.implementedBy || []) {
        await session.run(
          `MATCH (c:Concept {name: $conceptName})
           MATCH (fn:Function) WHERE fn.name CONTAINS $funcName
           MERGE (fn)-[:IMPLEMENTS]->(c)`,
          {
            conceptName: concept.name,
            funcName,
          }
        );
      }

      // Link endpoints to concepts
      for (const path of concept.relatedEndpoints || []) {
        await session.run(
          `MATCH (c:Concept {name: $conceptName})
           MATCH (e:Endpoint) WHERE e.path CONTAINS $path
           MERGE (e)-[:IMPLEMENTS]->(c)`,
          {
            conceptName: concept.name,
            path,
          }
        );
      }
    }
  } finally {
    await session.close();
  }
}

/**
 * Load UI components into Neo4j
 */
export async function loadUIComponents(components) {
  const session = getSession();
  try {
    for (const comp of components) {
      await session.run(
        `MERGE (ui:UIComponent {id: $id})
         SET ui.name = $name,
             ui.type = $type,
             ui.file = $file,
             ui.htmlId = $htmlId,
             ui.className = $className
         WITH ui
         MATCH (f:File {path: $file})
         MERGE (f)-[:CONTAINS]->(ui)`,
        {
          id: comp.id,
          name: comp.name,
          type: comp.type,
          file: comp.file,
          htmlId: comp.htmlId || '',
          className: comp.className || '',
        }
      );
    }
  } finally {
    await session.close();
  }
}

/**
 * Load similarities into Neo4j
 */
export async function loadSimilarities(similarities) {
  const session = getSession();
  try {
    for (const sim of similarities) {
      await session.run(
        `MATCH (fn1:Function {id: $func1Id})
         MATCH (fn2:Function {id: $func2Id})
         MERGE (fn1)-[r:SIMILAR_TO]-(fn2)
         SET r.similarity = $similarity,
             r.type = $type`,
        {
          func1Id: sim.block1.functionId,
          func2Id: sim.block2.functionId,
          similarity: sim.similarity,
          type: sim.type,
        }
      );
    }
  } finally {
    await session.close();
  }
}

/**
 * Load API call relationships (UI -> Endpoint)
 */
export async function loadAPICallRelationships(apiCalls, uiComponents) {
  const session = getSession();
  try {
    // For each fetch/SSE call, try to match with an endpoint
    for (const call of apiCalls) {
      if (call.path) {
        // Normalize path for matching
        const normalizedPath = call.path.replace(/\$\{[^}]+\}/g, '*');
        
        await session.run(
          `MATCH (ui:UIComponent {file: $file})
           MATCH (e:Endpoint) 
           WHERE e.path CONTAINS $pathPart OR $pathPart CONTAINS e.path
           MERGE (ui)-[r:READS_DATA]->(e)
           SET r.method = $method,
               r.line = $line,
               r.type = $type`,
          {
            file: call.file,
            pathPart: normalizedPath.split('/').filter(p => p && p !== '*')[0] || '',
            method: call.method || 'GET',
            line: call.line || 0,
            type: call.type,
          }
        );
      }
    }
  } finally {
    await session.close();
  }
}

/**
 * Load function annotations (from LLM)
 */
export async function loadFunctionAnnotations(annotations) {
  const session = getSession();
  try {
    for (const [funcId, annotation] of Object.entries(annotations)) {
      await session.run(
        `MATCH (fn:Function {id: $funcId})
         SET fn.purpose = $purpose,
             fn.businessDomain = $businessDomain,
             fn.inputDescription = $inputDescription,
             fn.outputDescription = $outputDescription,
             fn.complexity = $complexity,
             fn.sideEffects = $sideEffects`,
        {
          funcId,
          purpose: annotation.purpose || '',
          businessDomain: annotation.businessDomain || '',
          inputDescription: annotation.inputDescription || '',
          outputDescription: annotation.outputDescription || '',
          complexity: annotation.complexity || '',
          sideEffects: annotation.sideEffects || [],
        }
      );
    }
  } finally {
    await session.close();
  }
}

/**
 * Helper to resolve import paths
 */
function resolveImportPath(fromFile, importPath) {
  // Simple resolution - just get the filename part
  const parts = importPath.split('/');
  return parts[parts.length - 1].replace(/\.(js|ts|jsx|tsx)$/, '');
}

/**
 * Run a custom Cypher query
 */
export async function runQuery(cypher, params = {}) {
  const session = getSession();
  try {
    const result = await session.run(cypher, params);
    return result.records.map(record => {
      const obj = {};
      record.keys.forEach(key => {
        obj[key] = record.get(key);
      });
      return obj;
    });
  } finally {
    await session.close();
  }
}

export default {
  initNeo4j,
  closeNeo4j,
  clearDatabase,
  setupSchema,
  loadFiles,
  loadFunctions,
  loadCalls,
  loadEndpoints,
  loadImports,
  loadConcepts,
  loadUIComponents,
  loadSimilarities,
  loadAPICallRelationships,
  loadFunctionAnnotations,
  runQuery,
};
