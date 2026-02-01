/**
 * Vision Analyzer
 * 
 * Analyzes screenshots to detect "Intent Hotspots" - regions of interest
 * that the user likely wants to explore or investigate.
 * 
 * Uses structured prompts to extract:
 * - Bounding boxes for key content areas
 * - Content classification (text, image, chart, etc.)
 * - Predicted user questions
 * - Noise regions to filter out (ads, navigation, etc.)
 */

const { getVisionAdapter } = require('../llm');

// Structured output schema for vision analysis
const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    viewport: {
      type: 'object',
      properties: {
        width: { type: 'number' },
        height: { type: 'number' },
      },
      description: 'Estimated dimensions of the screenshot',
    },
    dominantColors: {
      type: 'array',
      items: { type: 'string' },
      description: 'Primary colors in hex format for theme extraction',
    },
    hotspots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          bounds: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'Percentage from left (0-100)' },
              y: { type: 'number', description: 'Percentage from top (0-100)' },
              width: { type: 'number', description: 'Width as percentage (0-100)' },
              height: { type: 'number', description: 'Height as percentage (0-100)' },
            },
          },
          type: {
            type: 'string',
            enum: ['text_block', 'headline', 'image', 'chart', 'data_table', 'social_post', 'product', 'video', 'form', 'navigation', 'other'],
          },
          contentSummary: { type: 'string', description: 'Brief summary of the content' },
          extractedText: { type: 'string', description: 'Key text extracted from this region' },
          predictedQuestion: { type: 'string', description: 'What the user likely wants to know' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          investigatable: { type: 'boolean', description: 'Whether this can be fact-checked or researched' },
        },
      },
    },
    noiseRegions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          bounds: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          type: {
            type: 'string',
            enum: ['ad', 'navigation', 'sidebar', 'footer', 'cookie_banner', 'popup', 'other'],
          },
        },
      },
      description: 'Regions to filter out or de-emphasize',
    },
    layoutType: {
      type: 'string',
      enum: ['single_column', 'two_column', 'grid', 'feed', 'dashboard', 'article', 'product_page', 'social_feed', 'other'],
      description: 'Overall layout structure',
    },
    contentContext: {
      type: 'string',
      description: 'Brief description of what this screenshot appears to be (news article, social media, product page, etc.)',
    },
  },
};

// The vision analysis prompt
const VISION_ANALYSIS_PROMPT = `You are a UI analyst specializing in extracting actionable information from screenshots.

Analyze this screenshot and identify "Intent Hotspots" - regions where a user would likely want to:
1. Learn more about the content
2. Verify claims or facts
3. Explore related information
4. Take action

For each hotspot, provide:
- Precise bounding box as PERCENTAGES (0-100) relative to the image dimensions
- Content type classification
- Brief summary of the content
- The predicted question a user would ask about this region
- Whether it's investigatable (can be fact-checked, researched, or expanded)

Also identify "noise regions" - areas like ads, navigation bars, sidebars, or cookie banners that should be filtered out or de-emphasized.

Extract the dominant colors from the screenshot for theme generation (provide 3-5 hex colors).

IMPORTANT: 
- Use PERCENTAGE coordinates (0-100), not pixels
- Focus on the MAIN CONTENT, not decorative elements
- Prioritize content that can be investigated or expanded
- Be precise with bounding boxes - they should tightly wrap the content

Return your analysis as valid JSON matching the schema provided.`;

/**
 * Analyze a screenshot for intent hotspots
 * @param {Object} options
 * @param {string} options.imageData - Base64 encoded image
 * @param {string} options.mediaType - MIME type
 * @param {Object} options.adapterConfig - Optional LLM adapter config
 * @returns {Promise<Object>} Analysis result with hotspots, noise regions, etc.
 */
async function analyzeScreenshot({ imageData, mediaType, adapterConfig = {} }) {
  const adapter = getVisionAdapter(adapterConfig);
  
  const result = await adapter.analyzeImage({
    imageData,
    mediaType,
    prompt: VISION_ANALYSIS_PROMPT,
    responseFormat: ANALYSIS_SCHEMA,
  });
  
  // Validate and normalize the response
  const analysis = result.structured || parseAnalysisFromText(result.text);
  
  return normalizeAnalysis(analysis);
}

/**
 * Parse analysis from text if structured parsing failed
 * @param {string} text - Raw text response
 * @returns {Object}
 */
function parseAnalysisFromText(text) {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    
    // Try to parse the entire text as JSON
    return JSON.parse(text.trim());
  } catch (e) {
    console.error('Failed to parse analysis from text:', e.message);
    // Return a minimal valid structure
    return {
      viewport: { width: 1200, height: 800 },
      hotspots: [],
      noiseRegions: [],
      layoutType: 'other',
      contentContext: 'Unable to analyze',
      dominantColors: ['#111111', '#ffffff'],
    };
  }
}

/**
 * Normalize and validate analysis data
 * @param {Object} analysis - Raw analysis
 * @returns {Object} Normalized analysis
 */
function normalizeAnalysis(analysis) {
  const normalized = {
    viewport: analysis.viewport || { width: 1200, height: 800 },
    dominantColors: (analysis.dominantColors || ['#111111', '#ffffff']).slice(0, 5),
    hotspots: [],
    noiseRegions: [],
    layoutType: analysis.layoutType || 'other',
    contentContext: analysis.contentContext || '',
  };
  
  // Normalize hotspots
  if (Array.isArray(analysis.hotspots)) {
    normalized.hotspots = analysis.hotspots.map((hs, index) => ({
      id: hs.id || `hs-${index + 1}`,
      bounds: normalizeBounds(hs.bounds),
      type: hs.type || 'other',
      contentSummary: hs.contentSummary || hs.content_summary || '',
      extractedText: hs.extractedText || hs.extracted_text || '',
      predictedQuestion: hs.predictedQuestion || hs.predicted_question || '',
      priority: hs.priority || 'medium',
      investigatable: hs.investigatable !== false,
    }));
  }
  
  // Normalize noise regions
  if (Array.isArray(analysis.noiseRegions || analysis.noise_regions)) {
    const noiseArr = analysis.noiseRegions || analysis.noise_regions;
    normalized.noiseRegions = noiseArr.map((nr, index) => ({
      id: `noise-${index + 1}`,
      bounds: normalizeBounds(nr.bounds),
      type: nr.type || 'other',
    }));
  }
  
  // Sort hotspots by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  normalized.hotspots.sort((a, b) => 
    (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1)
  );
  
  return normalized;
}

/**
 * Normalize bounding box values to percentages
 * @param {Object} bounds - Raw bounds
 * @returns {Object} Normalized bounds (0-100 percentages)
 */
function normalizeBounds(bounds) {
  if (!bounds) {
    return { x: 0, y: 0, width: 100, height: 100 };
  }
  
  return {
    x: clamp(bounds.x || 0, 0, 100),
    y: clamp(bounds.y || 0, 0, 100),
    width: clamp(bounds.width || 10, 1, 100),
    height: clamp(bounds.height || 10, 1, 100),
  };
}

/**
 * Clamp a value between min and max
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Get investigatable hotspots only
 * @param {Object} analysis - Analysis result
 * @returns {Array} Hotspots that can be investigated
 */
function getInvestigatableHotspots(analysis) {
  return analysis.hotspots.filter(hs => hs.investigatable);
}

/**
 * Get high-priority hotspots
 * @param {Object} analysis - Analysis result
 * @param {number} limit - Maximum number to return
 * @returns {Array}
 */
function getTopHotspots(analysis, limit = 5) {
  return analysis.hotspots.slice(0, limit);
}

module.exports = {
  analyzeScreenshot,
  getInvestigatableHotspots,
  getTopHotspots,
  ANALYSIS_SCHEMA,
  VISION_ANALYSIS_PROMPT,
};
