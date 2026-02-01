/**
 * HTML Parser
 * Extracts UI components, embedded JavaScript, and API call references from HTML files
 */

import * as cheerio from 'cheerio';
import { parseJavaScript } from './js-parser.js';

/**
 * Parse HTML file and extract structured information
 * @param {string} html - HTML source code
 * @param {string} filePath - Path to the file
 * @returns {Object} Extracted HTML information
 */
export function parseHTML(html, filePath) {
  const $ = cheerio.load(html);
  
  const result = {
    uiComponents: [],
    embeddedScripts: [],
    apiCalls: [],
    eventHandlers: [],
    forms: [],
    // Aggregated from embedded JS
    functions: [],
    calls: [],
    imports: [],
    variables: [],
    codeBlocks: [],
  };

  // ============================================
  // EXTRACT UI COMPONENTS
  // ============================================
  
  // Find major sections and semantic elements
  const componentSelectors = [
    { selector: 'section', type: 'section' },
    { selector: 'header', type: 'header' },
    { selector: 'footer', type: 'footer' },
    { selector: 'main', type: 'main' },
    { selector: 'nav', type: 'nav' },
    { selector: 'article', type: 'article' },
    { selector: 'aside', type: 'aside' },
    { selector: 'form', type: 'form' },
    { selector: '[class*="state"]', type: 'state' },
    { selector: '[class*="container"]', type: 'container' },
    { selector: '[class*="section"]', type: 'section' },
  ];

  componentSelectors.forEach(({ selector, type }) => {
    $(selector).each((i, el) => {
      const $el = $(el);
      const id = $el.attr('id');
      const className = $el.attr('class');
      
      // Skip if no identifier
      if (!id && !className) return;
      
      const component = {
        id: `${filePath}:${id || className}:${type}:${i}`,
        name: id || className?.split(' ')[0] || `${type}-${i}`,
        type,
        file: filePath,
        htmlId: id || null,
        className: className || null,
        // Approximate line numbers from character position
        // (cheerio doesn't track line numbers, so we estimate)
        innerText: $el.text().trim().substring(0, 100),
      };
      
      result.uiComponents.push(component);
    });
  });

  // ============================================
  // EXTRACT EMBEDDED SCRIPTS
  // ============================================
  
  $('script').each((i, el) => {
    const $el = $(el);
    const src = $el.attr('src');
    
    if (src) {
      // External script reference
      result.embeddedScripts.push({
        type: 'external',
        src,
        file: filePath,
      });
    } else {
      // Inline script
      const scriptContent = $el.html();
      if (scriptContent && scriptContent.trim().length > 0) {
        const scriptPath = `${filePath}:script:${i}`;
        
        result.embeddedScripts.push({
          type: 'inline',
          file: filePath,
          index: i,
          length: scriptContent.length,
        });

        // Parse the embedded JavaScript
        try {
          const jsResult = parseJavaScript(scriptContent, scriptPath);
          
          // Merge results
          result.functions.push(...jsResult.functions);
          result.calls.push(...jsResult.calls);
          result.imports.push(...jsResult.imports);
          result.variables.push(...jsResult.variables);
          result.codeBlocks.push(...jsResult.codeBlocks);
          
          // Extract API calls from the parsed calls
          extractAPICallsFromJS(jsResult.calls, result.apiCalls, filePath);
        } catch (error) {
          console.error(`Failed to parse embedded script in ${filePath}:`, error.message);
        }
      }
    }
  });

  // ============================================
  // EXTRACT FORMS AND THEIR TARGETS
  // ============================================
  
  $('form').each((i, el) => {
    const $el = $(el);
    const form = {
      id: `${filePath}:form:${i}`,
      file: filePath,
      formId: $el.attr('id') || null,
      action: $el.attr('action') || null,
      method: ($el.attr('method') || 'GET').toUpperCase(),
      inputs: [],
    };

    // Collect form inputs
    $el.find('input, select, textarea').each((j, input) => {
      const $input = $(input);
      form.inputs.push({
        name: $input.attr('name'),
        type: $input.attr('type') || 'text',
        id: $input.attr('id'),
      });
    });

    result.forms.push(form);
  });

  // ============================================
  // EXTRACT INLINE EVENT HANDLERS
  // ============================================
  
  const eventAttributes = [
    'onclick', 'onsubmit', 'onchange', 'oninput', 'onload',
    'onfocus', 'onblur', 'onkeyup', 'onkeydown', 'onmouseover',
  ];

  $('*').each((i, el) => {
    const $el = $(el);
    
    eventAttributes.forEach((attr) => {
      const handler = $el.attr(attr);
      if (handler) {
        result.eventHandlers.push({
          element: el.tagName.toLowerCase(),
          elementId: $el.attr('id') || null,
          event: attr.replace('on', ''),
          handler: handler.substring(0, 100),
          file: filePath,
        });
      }
    });
  });

  // ============================================
  // EXTRACT API REFERENCES FROM HTML ATTRIBUTES
  // ============================================
  
  // Look for data attributes that might contain API paths
  $('[data-api], [data-endpoint], [data-url]').each((i, el) => {
    const $el = $(el);
    const apiPath = $el.attr('data-api') || $el.attr('data-endpoint') || $el.attr('data-url');
    if (apiPath) {
      result.apiCalls.push({
        type: 'data-attribute',
        path: apiPath,
        file: filePath,
        elementId: $el.attr('id'),
      });
    }
  });

  // Look for links to API endpoints
  $('a[href^="/api"]').each((i, el) => {
    const $el = $(el);
    result.apiCalls.push({
      type: 'link',
      path: $el.attr('href'),
      file: filePath,
      method: 'GET',
    });
  });

  return result;
}

/**
 * Extract API calls from parsed JavaScript function calls
 */
function extractAPICallsFromJS(calls, apiCalls, filePath) {
  calls.forEach((call) => {
    // Look for fetch() calls
    if (call.callee === 'fetch') {
      apiCalls.push({
        type: 'fetch',
        file: filePath,
        line: call.line,
        caller: call.caller,
      });
    }

    // Look for XMLHttpRequest
    if (call.callee === 'XMLHttpRequest' || call.callee.includes('.open')) {
      apiCalls.push({
        type: 'xhr',
        file: filePath,
        line: call.line,
        caller: call.caller,
      });
    }

    // Look for EventSource (SSE)
    if (call.callee === 'EventSource') {
      apiCalls.push({
        type: 'sse',
        file: filePath,
        line: call.line,
        caller: call.caller,
      });
    }
  });
}

/**
 * Extract fetch/API call patterns from code text (for additional analysis)
 */
export function extractFetchPatterns(code) {
  const patterns = [];
  
  // Match fetch('...') or fetch(`...`)
  const fetchRegex = /fetch\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match;
  
  while ((match = fetchRegex.exec(code)) !== null) {
    patterns.push({
      type: 'fetch',
      path: match[1],
      position: match.index,
    });
  }

  // Match new EventSource('...')
  const sseRegex = /new\s+EventSource\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((match = sseRegex.exec(code)) !== null) {
    patterns.push({
      type: 'sse',
      path: match[1],
      position: match.index,
    });
  }

  // Match template literals with API paths
  const templateRegex = /fetch\s*\(\s*`([^`]+)`/g;
  while ((match = templateRegex.exec(code)) !== null) {
    patterns.push({
      type: 'fetch-template',
      path: match[1].replace(/\$\{[^}]+\}/g, '*'),
      position: match.index,
    });
  }

  return patterns;
}

export default { parseHTML, extractFetchPatterns };
