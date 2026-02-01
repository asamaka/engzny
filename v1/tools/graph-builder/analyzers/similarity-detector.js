/**
 * Similarity Detector
 * Detects similar and duplicate code blocks across the codebase
 */

import crypto from 'crypto';

/**
 * Detect similar code blocks
 * @param {Array} codeBlocks - Code blocks with normalized code
 * @returns {Array} Similarity relationships
 */
export function detectSimilarities(codeBlocks) {
  const similarities = [];
  
  // First pass: exact duplicates (same hash)
  const hashGroups = {};
  codeBlocks.forEach((block) => {
    if (!hashGroups[block.hash]) {
      hashGroups[block.hash] = [];
    }
    hashGroups[block.hash].push(block);
  });

  // Mark exact duplicates
  Object.values(hashGroups).forEach((group) => {
    if (group.length > 1) {
      // Create relationships between all pairs
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          similarities.push({
            block1: group[i],
            block2: group[j],
            similarity: 1.0,
            type: 'exact-duplicate',
          });
        }
      }
    }
  });

  // Second pass: fuzzy similarity using n-grams
  const uniqueBlocks = Object.values(hashGroups).map(g => g[0]);
  
  for (let i = 0; i < uniqueBlocks.length; i++) {
    for (let j = i + 1; j < uniqueBlocks.length; j++) {
      const block1 = uniqueBlocks[i];
      const block2 = uniqueBlocks[j];
      
      // Skip very small blocks
      if (block1.lineCount < 5 || block2.lineCount < 5) continue;
      
      // Skip if sizes are too different
      const sizeRatio = Math.min(block1.lineCount, block2.lineCount) / 
                       Math.max(block1.lineCount, block2.lineCount);
      if (sizeRatio < 0.5) continue;
      
      const similarity = calculateSimilarity(
        block1.normalizedCode,
        block2.normalizedCode
      );
      
      if (similarity >= 0.7) {
        similarities.push({
          block1,
          block2,
          similarity,
          type: similarity >= 0.95 ? 'near-duplicate' : 'similar-pattern',
        });
      }
    }
  }

  return similarities;
}

/**
 * Calculate similarity between two code strings using n-gram comparison
 */
function calculateSimilarity(code1, code2) {
  const ngrams1 = getNGrams(code1, 3);
  const ngrams2 = getNGrams(code2, 3);
  
  if (ngrams1.size === 0 || ngrams2.size === 0) return 0;
  
  // Jaccard similarity
  const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
  const union = new Set([...ngrams1, ...ngrams2]);
  
  return intersection.size / union.size;
}

/**
 * Generate n-grams from text
 */
function getNGrams(text, n) {
  const ngrams = new Set();
  const tokens = text.split(/\s+/);
  
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.add(tokens.slice(i, i + n).join(' '));
  }
  
  return ngrams;
}

/**
 * Detect structural patterns across functions
 * @param {Array} functions - Parsed functions
 * @returns {Array} Pattern groups
 */
export function detectPatterns(functions) {
  const patterns = [];
  
  // Group by signature pattern (params count + async + has return)
  const signatureGroups = {};
  
  functions.forEach((func) => {
    const signature = `${func.params?.length || 0}:${func.async}`;
    if (!signatureGroups[signature]) {
      signatureGroups[signature] = [];
    }
    signatureGroups[signature].push(func);
  });

  // Analyze each group for common patterns
  Object.entries(signatureGroups).forEach(([signature, funcs]) => {
    if (funcs.length < 2) return;
    
    // Look for common code structures
    const structureGroups = groupByStructure(funcs);
    
    structureGroups.forEach((group, index) => {
      if (group.length > 1) {
        patterns.push({
          id: `pattern:${signature}:${index}`,
          type: 'structural-similarity',
          signature,
          functions: group.map(f => f.id),
          count: group.length,
          description: describePattern(group),
        });
      }
    });
  });

  return patterns;
}

/**
 * Group functions by structural similarity
 */
function groupByStructure(functions) {
  const groups = [];
  const assigned = new Set();

  functions.forEach((func) => {
    if (assigned.has(func.id)) return;
    
    const group = [func];
    assigned.add(func.id);
    
    functions.forEach((other) => {
      if (assigned.has(other.id)) return;
      if (func.id === other.id) return;
      
      if (hasStructuralSimilarity(func, other)) {
        group.push(other);
        assigned.add(other.id);
      }
    });
    
    groups.push(group);
  });

  return groups;
}

/**
 * Check if two functions have structural similarity
 */
function hasStructuralSimilarity(func1, func2) {
  // Extract structural features
  const features1 = extractStructuralFeatures(func1.code);
  const features2 = extractStructuralFeatures(func2.code);
  
  // Compare features
  let matches = 0;
  let total = 0;
  
  Object.keys(features1).forEach((key) => {
    total++;
    if (features1[key] === features2[key]) matches++;
  });
  
  return total > 0 && matches / total >= 0.7;
}

/**
 * Extract structural features from code
 */
function extractStructuralFeatures(code) {
  if (!code) return {};
  
  return {
    hasAwait: code.includes('await'),
    hasTryCatch: code.includes('try') && code.includes('catch'),
    hasIf: code.includes('if (') || code.includes('if('),
    hasLoop: code.includes('for ') || code.includes('while ') || code.includes('.forEach') || code.includes('.map'),
    hasReturn: code.includes('return '),
    hasThrow: code.includes('throw '),
    usesRes: code.includes('res.') || code.includes('res,'),
    usesReq: code.includes('req.') || code.includes('req,'),
    isFetch: code.includes('fetch('),
    isEventHandler: code.includes('addEventListener') || code.includes('.on('),
    hasCallback: (code.match(/=>\s*{/g) || []).length,
    lineCount: (code.match(/\n/g) || []).length + 1,
  };
}

/**
 * Describe a pattern group
 */
function describePattern(group) {
  if (group.length === 0) return 'Empty pattern';
  
  const features = extractStructuralFeatures(group[0].code);
  const parts = [];
  
  if (features.hasAwait) parts.push('async');
  if (features.hasTryCatch) parts.push('with error handling');
  if (features.usesRes && features.usesReq) parts.push('HTTP handler');
  if (features.isFetch) parts.push('API client');
  if (features.isEventHandler) parts.push('event handler');
  
  return parts.length > 0 
    ? `${parts.join(', ')} pattern` 
    : 'Generic function pattern';
}

/**
 * Find potential refactoring opportunities
 */
export function findRefactoringOpportunities(similarities, patterns) {
  const opportunities = [];

  // Exact duplicates are prime candidates
  const exactDuplicates = similarities.filter(s => s.type === 'exact-duplicate');
  if (exactDuplicates.length > 0) {
    const files = new Set();
    exactDuplicates.forEach(s => {
      files.add(s.block1.file);
      files.add(s.block2.file);
    });
    
    opportunities.push({
      type: 'extract-shared-function',
      priority: 'high',
      description: `Found ${exactDuplicates.length} exact duplicate code blocks across ${files.size} files`,
      blocks: exactDuplicates.map(s => [s.block1.functionId, s.block2.functionId]),
      suggestion: 'Extract these into a shared utility function',
    });
  }

  // Near duplicates suggest DRY violations
  const nearDuplicates = similarities.filter(s => s.type === 'near-duplicate');
  if (nearDuplicates.length > 0) {
    opportunities.push({
      type: 'parameterize-function',
      priority: 'medium',
      description: `Found ${nearDuplicates.length} near-duplicate code blocks`,
      blocks: nearDuplicates.map(s => ({
        functions: [s.block1.functionId, s.block2.functionId],
        similarity: s.similarity,
      })),
      suggestion: 'Consider parameterizing these similar functions',
    });
  }

  // Large pattern groups suggest potential abstraction
  const largePatterns = patterns.filter(p => p.count >= 3);
  if (largePatterns.length > 0) {
    opportunities.push({
      type: 'create-abstraction',
      priority: 'low',
      description: `Found ${largePatterns.length} repeated structural patterns`,
      patterns: largePatterns.map(p => ({
        description: p.description,
        count: p.count,
        functions: p.functions,
      })),
      suggestion: 'Consider creating a higher-order function or class to handle this pattern',
    });
  }

  return opportunities;
}

export default { 
  detectSimilarities, 
  detectPatterns, 
  findRefactoringOpportunities 
};
