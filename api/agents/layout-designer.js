/**
 * Layout Designer Agent
 *
 * The central orchestration LLM that:
 * 1. Analyzes the screenshot (vision)
 * 2. Identifies content intent and top user questions
 * 3. Chooses the most appropriate layout type
 * 4. Creates a blueprint of placeholder cards with research assignments
 *
 * This agent does NOT do deep research - it creates the structure and
 * delegates research to parallel card-researcher agents.
 */

const { getVisionAdapter } = require('../llm');
const { getCardTypeSummaryForPrompt, getLayoutTypesSummaryForPrompt } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

const LAYOUT_DESIGNER_PROMPT = `You are a layout designer for a screenshot intelligence app. Your job is to analyze a screenshot and design the most VISUAL, image-rich card layout possible.

**Your Role:**
1. LOOK at the screenshot carefully
2. IDENTIFY what kind of content this is (news, product, social media, data, etc.)
3. DECIDE the best layout type — prefer visual layouts
4. CREATE a blueprint of cards — prioritize cards with IMAGES and CHARTS over text-heavy ones
5. ASSIGN research briefs — tell each card what to investigate AND what images/photos to find

**Design Philosophy:**
- IMAGES FIRST: Every card that can show an image should. Person cards need real photos. Location cards need photos. News needs article images.
- LESS TEXT: Keep all text ultra-concise. No paragraphs. Short labels and values only.
- WHAT'S NEW: Focus on information the user likely DIDN'T know. Surprising facts, background context.
- VISUAL DATA: When numbers exist, use chart_card instead of listing them as text.
- ALWAYS include a did_you_know_card with a surprising/interesting fact related to the content.
- NO FILLER: Never create cards for social media engagement metrics (likes, shares, comments), post stats, or other boring metadata. Every card must add real informational value.
- BREAKING NEWS: For unverified/breaking news, ALWAYS include a verification_card (full width) that tracks source checking. Start with major sources (Reuters, BBC, AP News, CNN, etc.) all in "checking" status.

**Available Layout Types:**
${getLayoutTypesSummaryForPrompt()}

**Available Card Types:**
${getCardTypeSummaryForPrompt()}

**Output Rules:**
- Choose 4-7 cards total
- contentType MUST be a simple label (e.g. "breaking_news", "product", "social_media"). NOT a sentence or snake_case description.
- intent MUST be a natural language sentence describing what the user wants to understand
- The FIRST card should always be a hero_summary. Title MUST be under 6 words. Subtitle is ONE sentence max.
- For BREAKING NEWS: MUST include a verification_card (columnSpan:2) as the second card with sources in "checking" state
- For person_card: research brief MUST say "Find a real photo URL of this person"
- For location_card: research brief MUST say "Find a photo URL of this location"
- For news_card: research brief MUST say "Find the article image URL"
- Use chart_card when numbers/percentages/stats are visible
- ALWAYS include at least one did_you_know_card
- NEVER include cards for social media engagement stats (likes/shares/comments)
- Include a "placeholderData" with best-guess content from what you can directly see
- For product_card: features and warnings arrays must contain PLAIN STRINGS, not objects
- Assign a grid position (row, column, span) for each card based on the layout
- Include followUpQuestions with pre-populated brief answers

Return ONLY valid JSON matching this structure:
{
  "contentAnalysis": {
    "contentType": "string (news/product/social/data/general/etc.)",
    "platform": "string (Twitter, Amazon, Reddit, etc. or null)",
    "intent": "string (what the user likely wants to understand)",
    "topQuestions": ["string (3-5 questions users would ask)"],
    "followUpQuestions": [{"question": "string", "answer": "string (1-2 sentence answer)"}]
  },
  "layout": {
    "type": "string (one of the layout types above)",
    "columns": number,
    "reason": "string (why this layout fits this content)"
  },
  "cards": [
    {
      "id": "string (unique identifier like card-1)",
      "cardType": "string (one of the card types above)",
      "gridPosition": {
        "row": number,
        "column": number,
        "columnSpan": number (1, 2, or 3),
        "rowSpan": number (1 or 2)
      },
      "researchBrief": "string (instructions for the research LLM - what to extract, verify, investigate, AND what images/photos to find via web search)",
      "placeholderData": { ... card-type-specific fields with best-guess data from visible content }
    }
  ]
}`;

/**
 * Design a layout for a screenshot
 * @param {Object} options
 * @param {string} options.imageData - Base64 encoded image
 * @param {string} options.mediaType - MIME type
 * @param {string} options.question - Optional user question
 * @param {Object} options.adapterConfig - Optional LLM adapter config
 * @returns {Promise<Object>} Layout blueprint
 */
async function designLayout({ imageData, mediaType, question, adapterConfig = {} }) {
  const startTime = Date.now();
  const adapter = getVisionAdapter(adapterConfig);
  const traceCollector = adapterConfig.traceCollector;

  let prompt = LAYOUT_DESIGNER_PROMPT;
  if (question) {
    prompt += `\n\n**User's specific question:** "${question}"\nMake sure at least one card directly addresses this question.`;
  }

  logger.info('LayoutDesigner', 'Starting vision analysis', { model: adapterConfig.model || 'default' });

  try {
    const result = await adapter.analyzeImage({
      imageData,
      mediaType,
      prompt,
    });

    const duration = Date.now() - startTime;
    logger.info('LayoutDesigner', 'Vision analysis complete', {
      dur: duration,
      model: result.model,
      usage: result.usage,
    });

    if (traceCollector) {
      traceCollector.record({
        phase: 'design',
        agent: 'LayoutDesigner',
        model: result.model || adapterConfig.model || 'claude-sonnet-4-20250514',
        duration,
        request: {
          userPrompt: prompt,
          hasImage: true,
          imageMediaType: mediaType,
          maxTokens: adapterConfig.maxTokens || 4096,
        },
        response: {
          text: result.text,
          usage: result.usage,
          stopReason: result.stopReason,
        },
      });
    }

    const blueprint = parseBlueprint(result.text);
    return normalizeBlueprint(blueprint);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (traceCollector) {
      traceCollector.record({
        phase: 'design',
        agent: 'LayoutDesigner',
        model: adapterConfig.model || 'claude-sonnet-4-20250514',
        duration,
        request: {
          userPrompt: prompt,
          hasImage: true,
          imageMediaType: mediaType,
          maxTokens: adapterConfig.maxTokens || 4096,
        },
        response: {},
        error: error.message,
      });
    }

    throw error;
  }
}

/**
 * Parse the blueprint from LLM response
 */
function parseBlueprint(text) {
  try {
    // Try extracting JSON from code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }

    // Try parsing the whole thing
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }

    return JSON.parse(text.trim());
  } catch (e) {
    logger.error('LayoutDesigner', 'Failed to parse blueprint', { err: e.message });
    return createFallbackBlueprint();
  }
}

/**
 * Normalize and validate the blueprint
 */
function normalizeBlueprint(raw) {
  const blueprint = {
    contentAnalysis: {
      contentType: raw.contentAnalysis?.contentType || 'general',
      platform: raw.contentAnalysis?.platform || null,
      intent: raw.contentAnalysis?.intent || 'Understand what is shown in this screenshot',
      topQuestions: Array.isArray(raw.contentAnalysis?.topQuestions)
        ? raw.contentAnalysis.topQuestions.slice(0, 5)
        : ['What is this?'],
      followUpQuestions: Array.isArray(raw.contentAnalysis?.followUpQuestions)
        ? raw.contentAnalysis.followUpQuestions.slice(0, 5)
        : [],
    },
    layout: {
      type: raw.layout?.type || 'simple',
      columns: raw.layout?.columns || 1,
      reason: raw.layout?.reason || '',
    },
    cards: [],
  };

  if (Array.isArray(raw.cards)) {
    blueprint.cards = raw.cards.map((card, index) => ({
      id: card.id || `card-${index + 1}`,
      cardType: card.cardType || 'info_list',
      gridPosition: {
        row: card.gridPosition?.row || index + 1,
        column: card.gridPosition?.column || 1,
        columnSpan: Math.min(card.gridPosition?.columnSpan || 1, blueprint.layout.columns),
        rowSpan: card.gridPosition?.rowSpan || 1,
      },
      researchBrief: card.researchBrief || 'Extract relevant information from the screenshot',
      placeholderData: card.placeholderData || {},
      status: 'placeholder', // Will transition to 'researching' then 'populated'
    }));
  }

  // Ensure there's at least a hero card
  if (blueprint.cards.length === 0 || blueprint.cards[0].cardType !== 'hero_summary') {
    blueprint.cards.unshift({
      id: 'card-hero',
      cardType: 'hero_summary',
      gridPosition: { row: 0, column: 1, columnSpan: blueprint.layout.columns, rowSpan: 1 },
      researchBrief: 'Provide a clear summary of the screenshot content',
      placeholderData: { title: 'Analyzing...', subtitle: 'Determining content type' },
      status: 'placeholder',
    });
  }

  return blueprint;
}

/**
 * Create a fallback blueprint when parsing fails
 */
function createFallbackBlueprint() {
  return {
    contentAnalysis: {
      contentType: 'general',
      platform: null,
      intent: 'Understand the screenshot content',
      topQuestions: ['What is this?'],
    },
    layout: { type: 'simple', columns: 1, reason: 'Fallback layout' },
    cards: [
      {
        id: 'card-hero',
        cardType: 'hero_summary',
        gridPosition: { row: 1, column: 1, columnSpan: 1, rowSpan: 1 },
        researchBrief: 'Summarize what is visible in the screenshot',
        placeholderData: { title: 'Screenshot Analysis', subtitle: 'Processing...' },
      },
      {
        id: 'card-details',
        cardType: 'info_list',
        gridPosition: { row: 2, column: 1, columnSpan: 1, rowSpan: 1 },
        researchBrief: 'Extract key information visible in the screenshot',
        placeholderData: { title: 'Key Details', items: [] },
      },
    ],
  };
}

module.exports = {
  designLayout,
  LAYOUT_DESIGNER_PROMPT,
};
