/**
 * JavaScript AST Parser
 * Extracts functions, calls, imports, variables, and Express routes from JS code
 */

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import crypto from 'crypto';

// Handle both ESM default export patterns
const traverse = _traverse.default || _traverse;

/**
 * Parse JavaScript code and extract structured information
 * @param {string} code - JavaScript source code
 * @param {string} filePath - Path to the file (for context)
 * @returns {Object} Extracted code information
 */
export function parseJavaScript(code, filePath) {
  const result = {
    functions: [],
    calls: [],
    imports: [],
    exports: [],
    variables: [],
    endpoints: [],
    dataStructures: [],
    codeBlocks: [],
  };

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx'],
      errorRecovery: true,
    });
  } catch (error) {
    console.error(`Failed to parse ${filePath}:`, error.message);
    return result;
  }

  // Track current function scope for nested calls
  const functionStack = [];

  traverse(ast, {
    // ============================================
    // FUNCTION DECLARATIONS
    // ============================================
    FunctionDeclaration: {
      enter(path) {
        const func = extractFunction(path.node, filePath, code);
        if (func) {
          result.functions.push(func);
          functionStack.push(func);
        }
      },
      exit() {
        functionStack.pop();
      },
    },

    // Arrow functions and function expressions assigned to variables
    VariableDeclarator(path) {
      const { node } = path;
      
      // Check if it's a function assignment
      if (
        node.init &&
        (node.init.type === 'ArrowFunctionExpression' ||
          node.init.type === 'FunctionExpression')
      ) {
        const name = node.id?.name;
        if (name) {
          const func = {
            id: `${filePath}:${name}:${node.loc?.start?.line || 0}`,
            name,
            file: filePath,
            startLine: node.loc?.start?.line || 0,
            endLine: node.loc?.end?.line || 0,
            async: node.init.async || false,
            params: extractParams(node.init.params),
            exported: isExported(path),
            code: extractCodeBlock(code, node.loc),
          };
          result.functions.push(func);
        }
      }

      // Also capture important constants/variables
      if (node.id?.name && node.init) {
        const varInfo = {
          id: `${filePath}:${node.id.name}:${node.loc?.start?.line || 0}`,
          name: node.id.name,
          file: filePath,
          line: node.loc?.start?.line || 0,
          kind: path.parent?.kind || 'const',
          value: extractValue(node.init),
        };
        
        // Only track meaningful variables (objects, arrays, important literals)
        if (shouldTrackVariable(node.init)) {
          result.variables.push(varInfo);
        }
      }
    },

    // Object methods
    ObjectMethod(path) {
      const func = extractFunction(path.node, filePath, code);
      if (func) {
        // Try to get containing object name
        const parent = path.parent;
        if (parent?.type === 'ObjectExpression') {
          const grandParent = path.parentPath?.parent;
          if (grandParent?.type === 'VariableDeclarator' && grandParent.id?.name) {
            func.name = `${grandParent.id.name}.${func.name}`;
            func.id = `${filePath}:${func.name}:${func.startLine}`;
          }
        }
        result.functions.push(func);
      }
    },

    // ============================================
    // FUNCTION CALLS
    // ============================================
    CallExpression(path) {
      const { node } = path;
      
      // Extract function call info
      const call = extractCall(node, filePath, functionStack);
      if (call) {
        result.calls.push(call);
      }

      // Detect Express routes
      const endpoint = extractEndpoint(node, filePath);
      if (endpoint) {
        result.endpoints.push(endpoint);
      }
      
      // CommonJS require
      if (
        node.callee.name === 'require' &&
        node.arguments[0]?.type === 'StringLiteral'
      ) {
        const importInfo = {
          source: node.arguments[0].value,
          file: filePath,
          line: node.loc?.start?.line || 0,
          specifiers: [],
          isRequire: true,
        };

        // Try to get what it's assigned to
        if (path.parent?.type === 'VariableDeclarator') {
          if (path.parent.id?.type === 'Identifier') {
            importInfo.specifiers.push({
              local: path.parent.id.name,
              imported: 'default',
              type: 'ImportDefaultSpecifier',
            });
          } else if (path.parent.id?.type === 'ObjectPattern') {
            path.parent.id.properties.forEach((prop) => {
              importInfo.specifiers.push({
                local: prop.value?.name || prop.key?.name,
                imported: prop.key?.name,
                type: 'ImportSpecifier',
              });
            });
          }
        }

        result.imports.push(importInfo);
      }
    },

    // ============================================
    // IMPORTS
    // ============================================
    ImportDeclaration(path) {
      const { node } = path;
      const importInfo = {
        source: node.source.value,
        file: filePath,
        line: node.loc?.start?.line || 0,
        specifiers: node.specifiers.map((s) => ({
          local: s.local?.name,
          imported: s.imported?.name || s.local?.name,
          type: s.type,
        })),
      };
      result.imports.push(importInfo);
    },

    // ============================================
    // EXPORTS
    // ============================================
    ExportNamedDeclaration(path) {
      const { node } = path;
      if (node.declaration) {
        if (node.declaration.type === 'FunctionDeclaration') {
          result.exports.push({
            name: node.declaration.id?.name,
            type: 'function',
            file: filePath,
            line: node.loc?.start?.line || 0,
          });
        } else if (node.declaration.type === 'VariableDeclaration') {
          node.declaration.declarations.forEach((d) => {
            result.exports.push({
              name: d.id?.name,
              type: 'variable',
              file: filePath,
              line: node.loc?.start?.line || 0,
            });
          });
        }
      }
    },

    ExportDefaultDeclaration(path) {
      const { node } = path;
      result.exports.push({
        name: 'default',
        type: node.declaration?.type || 'unknown',
        file: filePath,
        line: node.loc?.start?.line || 0,
      });
    },

    // CommonJS exports
    AssignmentExpression(path) {
      const { node } = path;
      if (
        node.left?.type === 'MemberExpression' &&
        node.left.object?.name === 'module' &&
        node.left.property?.name === 'exports'
      ) {
        result.exports.push({
          name: 'default',
          type: 'module.exports',
          file: filePath,
          line: node.loc?.start?.line || 0,
        });
      }
    },
  });

  // Extract code blocks for similarity detection
  result.codeBlocks = extractCodeBlocks(result.functions, code);

  return result;
}

/**
 * Extract function information from AST node
 */
function extractFunction(node, filePath, code) {
  const name = node.id?.name || node.key?.name || 'anonymous';
  if (name === 'anonymous') return null;

  return {
    id: `${filePath}:${name}:${node.loc?.start?.line || 0}`,
    name,
    file: filePath,
    startLine: node.loc?.start?.line || 0,
    endLine: node.loc?.end?.line || 0,
    async: node.async || false,
    generator: node.generator || false,
    params: extractParams(node.params),
    code: extractCodeBlock(code, node.loc),
  };
}

/**
 * Extract function parameters
 */
function extractParams(params) {
  if (!params) return [];
  return params.map((p) => {
    if (p.type === 'Identifier') return p.name;
    if (p.type === 'AssignmentPattern') return `${p.left?.name}=default`;
    if (p.type === 'RestElement') return `...${p.argument?.name}`;
    if (p.type === 'ObjectPattern') return '{...}';
    if (p.type === 'ArrayPattern') return '[...]';
    return 'unknown';
  });
}

/**
 * Extract function call information
 */
function extractCall(node, filePath, functionStack) {
  let calleeName = '';

  if (node.callee.type === 'Identifier') {
    calleeName = node.callee.name;
  } else if (node.callee.type === 'MemberExpression') {
    const obj = node.callee.object;
    const prop = node.callee.property;
    
    if (obj.type === 'Identifier' && prop.type === 'Identifier') {
      calleeName = `${obj.name}.${prop.name}`;
    } else if (obj.type === 'MemberExpression' && prop.type === 'Identifier') {
      // Handle chained calls like a.b.c()
      if (obj.object?.name && obj.property?.name) {
        calleeName = `${obj.object.name}.${obj.property.name}.${prop.name}`;
      }
    } else if (obj.type === 'ThisExpression' && prop.type === 'Identifier') {
      calleeName = `this.${prop.name}`;
    }
  }

  if (!calleeName) return null;

  // Get the calling function context
  const caller = functionStack.length > 0 
    ? functionStack[functionStack.length - 1] 
    : null;

  return {
    callee: calleeName,
    file: filePath,
    line: node.loc?.start?.line || 0,
    caller: caller?.name || null,
    callerFile: caller?.file || filePath,
    arguments: node.arguments.length,
  };
}

/**
 * Extract Express endpoint from app.get/post/etc calls
 */
function extractEndpoint(node, filePath) {
  if (node.callee.type !== 'MemberExpression') return null;
  
  const obj = node.callee.object;
  const method = node.callee.property?.name;
  
  // Check for app.get, app.post, router.get, etc.
  const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all', 'use'];
  
  if (
    obj.type === 'Identifier' &&
    (obj.name === 'app' || obj.name === 'router') &&
    httpMethods.includes(method)
  ) {
    const args = node.arguments;
    if (args.length >= 1) {
      let path = '';
      
      // First argument should be the path
      if (args[0].type === 'StringLiteral') {
        path = args[0].value;
      } else if (args[0].type === 'TemplateLiteral') {
        path = args[0].quasis.map(q => q.value.raw).join('*');
      } else if (args[0].type === 'Identifier') {
        path = `[${args[0].name}]`;
      } else if (args[0].regex) {
        path = `[regex]`;
      }

      // Find the handler function name
      let handler = 'anonymous';
      const lastArg = args[args.length - 1];
      if (lastArg.type === 'Identifier') {
        handler = lastArg.name;
      } else if (lastArg.type === 'ArrowFunctionExpression' || lastArg.type === 'FunctionExpression') {
        handler = `inline@${node.loc?.start?.line || 0}`;
      }

      return {
        id: `${method.toUpperCase()}:${path}`,
        method: method.toUpperCase(),
        path,
        handler,
        file: filePath,
        line: node.loc?.start?.line || 0,
        middleware: args.slice(1, -1).map(a => a.name || 'anonymous'),
      };
    }
  }

  return null;
}

/**
 * Check if a variable declaration is exported
 */
function isExported(path) {
  let current = path;
  while (current) {
    if (
      current.node?.type === 'ExportNamedDeclaration' ||
      current.node?.type === 'ExportDefaultDeclaration'
    ) {
      return true;
    }
    current = current.parentPath;
  }
  return false;
}

/**
 * Determine if a variable is worth tracking
 */
function shouldTrackVariable(init) {
  if (!init) return false;
  
  // Track objects (likely configs or data structures)
  if (init.type === 'ObjectExpression') return true;
  
  // Track arrays
  if (init.type === 'ArrayExpression') return true;
  
  // Track certain literals that look like config
  if (init.type === 'NumericLiteral' || init.type === 'StringLiteral') {
    return false; // Too many of these, skip unless in object
  }
  
  // Track Maps, Sets, etc.
  if (init.type === 'NewExpression') return true;
  
  return false;
}

/**
 * Extract a simple string representation of a value
 */
function extractValue(node) {
  if (!node) return null;
  
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'NumericLiteral') return node.value;
  if (node.type === 'BooleanLiteral') return node.value;
  if (node.type === 'NullLiteral') return null;
  if (node.type === 'ArrayExpression') return `[${node.elements.length} items]`;
  if (node.type === 'ObjectExpression') return `{${node.properties.length} props}`;
  if (node.type === 'NewExpression') {
    return `new ${node.callee?.name || 'Unknown'}()`;
  }
  
  return `[${node.type}]`;
}

/**
 * Extract code block text from source
 */
function extractCodeBlock(code, loc) {
  if (!loc) return '';
  
  const lines = code.split('\n');
  const start = Math.max(0, loc.start.line - 1);
  const end = Math.min(lines.length, loc.end.line);
  
  return lines.slice(start, end).join('\n');
}

/**
 * Extract code blocks for similarity detection
 */
function extractCodeBlocks(functions, code) {
  return functions.map((func) => {
    const normalizedCode = normalizeCode(func.code);
    const hash = crypto
      .createHash('sha256')
      .update(normalizedCode)
      .digest('hex')
      .substring(0, 16);

    return {
      hash,
      functionId: func.id,
      functionName: func.name,
      file: func.file,
      startLine: func.startLine,
      endLine: func.endLine,
      normalizedCode,
      lineCount: func.endLine - func.startLine + 1,
    };
  });
}

/**
 * Normalize code for similarity comparison
 * - Remove comments
 * - Normalize whitespace
 * - Replace variable names with placeholders
 */
function normalizeCode(code) {
  if (!code) return '';
  
  return code
    // Remove single-line comments
    .replace(/\/\/.*$/gm, '')
    // Remove multi-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove string contents (replace with placeholder)
    .replace(/'[^']*'/g, "'STR'")
    .replace(/"[^"]*"/g, '"STR"')
    .replace(/`[^`]*`/g, '`STR`')
    // Trim
    .trim();
}

export default { parseJavaScript };
