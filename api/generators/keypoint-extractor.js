/**
 * Keypoint Extractor
 *
 * Enhanced analysis system that extracts key information points from screenshots
 * and provides immediate answers to obvious questions users would ask.
 *
 * Use cases:
 * - Social media posts: "Who is this person?", "What's the context?"
 * - Shopping items: "What is this product?", "What's the price?"
 * - News articles: "What happened?", "When did this occur?"
 * - General screenshots: "What am I looking at?", "Why is this important?"
 *
 * Organizes keypoints into "trails" for deep-dive exploration:
 * - People trail: Names, roles, relationships
 * - Events trail: What happened, when, where
 * - Facts trail: Claims, data, statistics to verify
 * - Products trail: Items, prices, details
 * - Context trail: Background information, history
 */

const { getVisionAdapter } = require('../llm');

// Keypoint schema with enhanced structure for card-based navigation
const KEYPOINT_SCHEMA = {
  type: 'object',
  properties: {
    overview: {
      type: 'object',
      properties: {
        mainTopic: { type: 'string', description: 'What is this screenshot about in one sentence' },
        contentType: {
          type: 'string',
          enum: ['social_media', 'shopping', 'news', 'article', 'chat', 'email', 'document', 'video', 'other'],
          description: 'Type of content being analyzed'
        },
        platform: { type: 'string', description: 'Platform or app if identifiable (Twitter, Instagram, Amazon, etc.)' },
        immediateAnswer: { type: 'string', description: 'Quick answer to "What am I looking at?"' },
      },
    },
    keypoints: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier' },
          title: { type: 'string', description: 'Brief title for this keypoint (3-6 words)' },
          description: { type: 'string', description: 'What this keypoint contains (1-2 sentences)' },
          trail: {
            type: 'string',
            enum: ['people', 'events', 'facts', 'products', 'context', 'claims', 'dates', 'locations', 'general'],
            description: 'Which trail/category this belongs to'
          },
          priority: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low'],
            description: 'How important is this keypoint'
          },
          obviousQuestion: {
            type: 'string',
            description: 'The most obvious question a user would ask (e.g., "Who is this person?", "What is this product?")'
          },
          quickAnswer: {
            type: 'string',
            description: 'Immediate answer to the obvious question based on visible information'
          },
          extractedText: {
            type: 'string',
            description: 'Relevant text extracted from this region'
          },
          bounds: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X position as percentage (0-100)' },
              y: { type: 'number', description: 'Y position as percentage (0-100)' },
              width: { type: 'number', description: 'Width as percentage (0-100)' },
              height: { type: 'number', description: 'Height as percentage (0-100)' },
            },
            description: 'Bounding box for visual highlighting'
          },
          needsVerification: {
            type: 'boolean',
            description: 'Whether this claim/info should be fact-checked'
          },
          relatedKeypoints: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of related keypoints for trail navigation'
          },
          deepDivePrompts: {
            type: 'array',
            items: { type: 'string' },
            description: 'Follow-up questions for deeper exploration (3-5 questions)'
          },
        },
        required: ['id', 'title', 'description', 'trail', 'obviousQuestion', 'quickAnswer']
      },
    },
    trails: {
      type: 'object',
      properties: {
        people: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            keypointIds: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string', description: 'Brief summary of people mentioned' },
          },
        },
        events: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            keypointIds: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
        },
        facts: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            keypointIds: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
        },
        products: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            keypointIds: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
        },
        context: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            keypointIds: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
        },
      },
    },
  },
  required: ['overview', 'keypoints', 'trails']
};

// Enhanced prompt for keypoint extraction
const KEYPOINT_PROMPT = `You are an intelligent screenshot analyzer that helps users quickly understand what they're looking at and answers their most obvious questions.

Analyze this screenshot as if a user just uploaded it and wants to know:
1. **"What am I looking at?"** - Give a clear, immediate answer
2. **"What are the key things here?"** - Extract 3-7 main keypoints
3. **For each keypoint, answer the obvious question:**
   - If it's a person: "Who is this person?" (name, role, context from visible info)
   - If it's an event: "What's going on?" or "What happened?"
   - If it's a product: "What is this?" (product name, price if visible)
   - If it's a claim/fact: "Is this true?" (note what should be verified)
   - If it's a date/time: "When did this happen?"
   - If it's a location: "Where is this?"

**Trail Organization:**
Organize keypoints into trails so users can dive deep into specific aspects:
- **People trail**: Names, profiles, @handles, authors, speakers
- **Events trail**: What happened, incidents, announcements, updates
- **Facts trail**: Statistics, data, claims that need verification
- **Products trail**: Items for sale, features, prices, specs
- **Context trail**: Background info, historical context, explanations
- **Claims trail**: Statements that should be fact-checked
- **Dates trail**: When things happened or will happen
- **Locations trail**: Where events occurred or places mentioned

**Examples:**

For a Twitter screenshot showing a viral tweet:
- Keypoint 1 (People trail): "Who is @username?" → Answer: "This appears to be [name if visible], they tweeted about [topic]"
- Keypoint 2 (Events trail): "What are they talking about?" → Answer: "They're discussing [topic] which happened on [date if visible]"
- Keypoint 3 (Claims trail): "Is this claim true?" → Answer: "They claim [X], this needs verification" (needsVerification: true)

For an Amazon product page:
- Keypoint 1 (Products trail): "What is this product?" → Answer: "[Product name], priced at [price if visible]"
- Keypoint 2 (Facts trail): "What are the ratings?" → Answer: "[X] stars with [Y] reviews"
- Keypoint 3 (Products trail): "What are the main features?" → Answer: "[list key features visible]"

For a news article screenshot:
- Keypoint 1 (Events trail): "What happened?" → Answer: "[Brief description of the event]"
- Keypoint 2 (Dates trail): "When did this happen?" → Answer: "[Date/time if visible]"
- Keypoint 3 (People trail): "Who's involved?" → Answer: "[Names of key people mentioned]"
- Keypoint 4 (Locations trail): "Where did this happen?" → Answer: "[Location if mentioned]"

**Important Guidelines:**
1. Use ONLY information visible in the screenshot - don't make up facts
2. If you can't determine something, say "Not visible in screenshot"
3. For obvious questions, provide the clearest answer possible from visible content
4. Mark claims as needsVerification: true if they should be fact-checked
5. Provide 3-5 deep dive prompts for each keypoint to encourage exploration
6. Use precise bounding boxes (percentages 0-100) for visual highlighting
7. Limit to 7 keypoints max - focus on the most important/obvious ones
8. For related keypoints, link them together (e.g., person → their tweet → event they're discussing)

Return your analysis as valid JSON matching the schema.`;

/**
 * Extract keypoints from a screenshot
 * @param {Object} options
 * @param {string} options.imageData - Base64 encoded image
 * @param {string} options.mediaType - MIME type
 * @param {Object} options.adapterConfig - Optional LLM adapter config
 * @returns {Promise<Object>} Keypoint extraction result
 */
async function extractKeypoints({ imageData, mediaType, adapterConfig = {} }) {
  const adapter = getVisionAdapter(adapterConfig);

  const result = await adapter.analyzeImage({
    imageData,
    mediaType,
    prompt: KEYPOINT_PROMPT,
    responseFormat: KEYPOINT_SCHEMA,
  });

  // Parse structured response or fallback to text parsing
  const analysis = result.structured || parseKeypointsFromText(result.text);

  return normalizeKeypoints(analysis);
}

/**
 * Parse keypoints from text if structured parsing failed
 * @param {string} text - Raw text response
 * @returns {Object}
 */
function parseKeypointsFromText(text) {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }

    // Try to parse the entire text as JSON
    return JSON.parse(text.trim());
  } catch (e) {
    console.error('Failed to parse keypoints from text:', e.message);
    // Return minimal valid structure
    return {
      overview: {
        mainTopic: 'Unable to analyze screenshot',
        contentType: 'other',
        platform: 'Unknown',
        immediateAnswer: 'Analysis failed. Please try again.',
      },
      keypoints: [],
      trails: {
        people: { count: 0, keypointIds: [], summary: '' },
        events: { count: 0, keypointIds: [], summary: '' },
        facts: { count: 0, keypointIds: [], summary: '' },
        products: { count: 0, keypointIds: [], summary: '' },
        context: { count: 0, keypointIds: [], summary: '' },
      },
    };
  }
}

/**
 * Normalize and validate keypoint data
 * @param {Object} analysis - Raw keypoint analysis
 * @returns {Object} Normalized analysis
 */
function normalizeKeypoints(analysis) {
  const normalized = {
    overview: {
      mainTopic: analysis.overview?.mainTopic || 'Screenshot analysis',
      contentType: analysis.overview?.contentType || 'other',
      platform: analysis.overview?.platform || 'Unknown',
      immediateAnswer: analysis.overview?.immediateAnswer || 'Unable to determine',
    },
    keypoints: [],
    trails: {
      people: { count: 0, keypointIds: [], summary: '' },
      events: { count: 0, keypointIds: [], summary: '' },
      facts: { count: 0, keypointIds: [], summary: '' },
      products: { count: 0, keypointIds: [], summary: '' },
      context: { count: 0, keypointIds: [], summary: '' },
      claims: { count: 0, keypointIds: [], summary: '' },
      dates: { count: 0, keypointIds: [], summary: '' },
      locations: { count: 0, keypointIds: [], summary: '' },
      general: { count: 0, keypointIds: [], summary: '' },
    },
  };

  // Normalize keypoints
  if (Array.isArray(analysis.keypoints)) {
    normalized.keypoints = analysis.keypoints.map((kp, index) => {
      const normalizedKp = {
        id: kp.id || `kp-${index + 1}`,
        title: kp.title || 'Untitled',
        description: kp.description || '',
        trail: kp.trail || 'general',
        priority: kp.priority || 'medium',
        obviousQuestion: kp.obviousQuestion || kp.obvious_question || 'What is this?',
        quickAnswer: kp.quickAnswer || kp.quick_answer || 'Information not available',
        extractedText: kp.extractedText || kp.extracted_text || '',
        bounds: normalizeBounds(kp.bounds),
        needsVerification: kp.needsVerification ?? kp.needs_verification ?? false,
        relatedKeypoints: Array.isArray(kp.relatedKeypoints || kp.related_keypoints)
          ? (kp.relatedKeypoints || kp.related_keypoints)
          : [],
        deepDivePrompts: Array.isArray(kp.deepDivePrompts || kp.deep_dive_prompts)
          ? (kp.deepDivePrompts || kp.deep_dive_prompts).slice(0, 5)
          : [],
      };

      // Add to appropriate trail
      const trail = normalizedKp.trail;
      if (normalized.trails[trail]) {
        normalized.trails[trail].count++;
        normalized.trails[trail].keypointIds.push(normalizedKp.id);
      }

      return normalizedKp;
    });
  }

  // Normalize trail summaries
  if (analysis.trails) {
    Object.keys(analysis.trails).forEach(trailName => {
      if (normalized.trails[trailName] && analysis.trails[trailName]) {
        normalized.trails[trailName].summary = analysis.trails[trailName].summary || '';
      }
    });
  }

  return normalized;
}

/**
 * Normalize bounding box coordinates
 * @param {Object} bounds - Raw bounds
 * @returns {Object} Normalized bounds
 */
function normalizeBounds(bounds) {
  if (!bounds) {
    return { x: 0, y: 0, width: 100, height: 100 };
  }

  return {
    x: clamp(bounds.x || 0, 0, 100),
    y: clamp(bounds.y || 0, 0, 100),
    width: clamp(bounds.width || 100, 0, 100),
    height: clamp(bounds.height || 100, 0, 100),
  };
}

/**
 * Clamp a value between min and max
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  extractKeypoints,
  KEYPOINT_SCHEMA,
  KEYPOINT_PROMPT,
};
