// ============================================
// Neo4j Schema for Code Knowledge Graph
// Run this once to set up constraints and indexes
// ============================================

// ============================================
// CONSTRAINTS (ensure uniqueness)
// ============================================

// Files must have unique paths
CREATE CONSTRAINT file_path IF NOT EXISTS
FOR (f:File) REQUIRE f.path IS UNIQUE;

// Functions identified by file + name + line (to handle same-name functions)
CREATE CONSTRAINT function_id IF NOT EXISTS
FOR (fn:Function) REQUIRE fn.id IS UNIQUE;

// Endpoints identified by method + path
CREATE CONSTRAINT endpoint_id IF NOT EXISTS
FOR (e:Endpoint) REQUIRE e.id IS UNIQUE;

// Concepts by name
CREATE CONSTRAINT concept_name IF NOT EXISTS
FOR (c:Concept) REQUIRE c.name IS UNIQUE;

// External dependencies by name
CREATE CONSTRAINT external_dep_name IF NOT EXISTS
FOR (d:ExternalDep) REQUIRE d.name IS UNIQUE;

// Data structures by id
CREATE CONSTRAINT data_structure_id IF NOT EXISTS
FOR (ds:DataStructure) REQUIRE ds.id IS UNIQUE;

// UI Components by id
CREATE CONSTRAINT ui_component_id IF NOT EXISTS
FOR (ui:UIComponent) REQUIRE ui.id IS UNIQUE;

// Code blocks by hash
CREATE CONSTRAINT code_block_hash IF NOT EXISTS
FOR (cb:CodeBlock) REQUIRE cb.hash IS UNIQUE;

// Variables by id
CREATE CONSTRAINT variable_id IF NOT EXISTS
FOR (v:Variable) REQUIRE v.id IS UNIQUE;

// ============================================
// INDEXES (for query performance)
// ============================================

// Index on function names for quick lookup
CREATE INDEX function_name IF NOT EXISTS
FOR (fn:Function) ON (fn.name);

// Index on file language
CREATE INDEX file_language IF NOT EXISTS
FOR (f:File) ON (f.language);

// Index on endpoint method
CREATE INDEX endpoint_method IF NOT EXISTS
FOR (e:Endpoint) ON (e.method);

// Index on endpoint path
CREATE INDEX endpoint_path IF NOT EXISTS
FOR (e:Endpoint) ON (e.path);

// Index on concept category
CREATE INDEX concept_category IF NOT EXISTS
FOR (c:Concept) ON (c.category);

// Full-text search on function names and descriptions
CREATE FULLTEXT INDEX function_search IF NOT EXISTS
FOR (fn:Function) ON EACH [fn.name, fn.description];

// Full-text search on concepts
CREATE FULLTEXT INDEX concept_search IF NOT EXISTS
FOR (c:Concept) ON EACH [c.name, c.description];

// ============================================
// EXAMPLE QUERIES FOR REFERENCE
// ============================================

// Find all functions in a file:
// MATCH (f:File {path: 'api/index.js'})-[:CONTAINS]->(fn:Function)
// RETURN fn.name, fn.startLine, fn.endLine

// Find what calls a specific function:
// MATCH (caller:Function)-[r:CALLS]->(fn:Function {name: 'compressImageForAPI'})
// RETURN caller.name, r.line

// Find all endpoints and their handlers:
// MATCH (e:Endpoint)-[:ROUTES_TO]->(fn:Function)
// RETURN e.method, e.path, fn.name

// Find impact of changing a function (what depends on it):
// MATCH (fn:Function {name: 'storage'})-[:DEPENDS_ON*1..3]-(dependent)
// RETURN DISTINCT dependent

// Find similar code blocks:
// MATCH (cb1:CodeBlock)-[r:SIMILAR_TO]->(cb2:CodeBlock)
// WHERE r.similarity > 0.8
// RETURN cb1, cb2, r.similarity

// Find all functions that implement a concept:
// MATCH (fn:Function)-[:IMPLEMENTS]->(c:Concept {name: 'Job Management'})
// RETURN fn.name, fn.file, fn.startLine

// Find frontend-to-backend data flow:
// MATCH (ui:UIComponent)-[:READS_DATA]->(e:Endpoint)-[:ROUTES_TO]->(fn:Function)
// RETURN ui.name, e.path, fn.name
