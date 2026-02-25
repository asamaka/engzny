/**
 * Card Researcher Agent
 *
 * Individual research LLM that populates a single card based on:
 * 1. The card type contract (what fields are needed)
 * 2. The research brief from the layout designer
 * 3. The original screenshot for context
 *
 * Multiple instances run in parallel - one per card.
 */

const { getVisionAdapter, getDefaultAdapter } = require('../llm');
const { getCardSchema, validateCardData } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

/**
 * Build the research prompt for a specific card
 */
function buildResearchPrompt(card, contentAnalysis) {
  const schema = getCardSchema(card.cardType);
  if (!schema) {
    throw new Error(`Unknown card type: ${card.cardType}`);
  }

  const fieldDescriptions = Object.entries(schema.schema)
    .map(([field, def]) => {
      const req = def.required ? ' (REQUIRED)' : '';
      const enumStr = def.enum ? ` [one of: ${def.enum.join(', ')}]` : '';
      if (def.type === 'array' && def.items) {
        const itemFields = typeof def.items === 'object' && !Array.isArray(def.items)
          ? Object.entries(def.items).map(([k, v]) => `${k}: ${v.type || 'string'}${v.required ? ' (required)' : ''}`).join(', ')
          : 'string';
        return `  - ${field}: array of { ${itemFields} }${req}`;
      }
      return `  - ${field}: ${def.type || 'string'}${enumStr}${req} — ${def.description || ''}`;
    })
    .join('\n');

  return `You are a research specialist. Your task is to populate a single card with accurate information extracted from a screenshot.

**Content Context:** ${contentAnalysis.contentType} ${contentAnalysis.platform ? `on ${contentAnalysis.platform}` : ''}
**Intent:** ${contentAnalysis.intent}

**Your Card Assignment:**
- Card Type: ${card.cardType}
- Research Brief: ${card.researchBrief}

**Required Output Fields:**
${fieldDescriptions}

**Rules:**
1. ONLY use information visible in the screenshot - do not fabricate
2. If a field cannot be determined, OMIT it rather than using "Not visible"
3. Be concise - this is a card, not an essay
4. For fact_check cards: assess based on visible information, mark confidence as "low" if you cannot verify
5. For product_card: features and warnings MUST be arrays of plain strings, NOT objects
6. Include any visible URLs in url/imageUrl/sourceUrl/mapUrl fields
7. Return ONLY valid JSON with the card data fields - no markdown, no explanation

Return JSON:`;
}

/**
 * Research and populate a single card
 * @param {Object} options
 * @param {Object} options.card - Card blueprint from layout designer
 * @param {Object} options.contentAnalysis - Content analysis from layout designer
 * @param {string} options.imageData - Base64 encoded image
 * @param {string} options.mediaType - MIME type
 * @param {Object} options.adapterConfig - Optional adapter config
 * @returns {Promise<Object>} Populated card data
 */
async function researchCard({ card, contentAnalysis, imageData, mediaType, adapterConfig = {} }) {
  const startTime = Date.now();
  logger.info('CardResearcher', `Starting ${card.id}`, { cardType: card.cardType });

  try {
    const adapter = getVisionAdapter(adapterConfig);
    const prompt = buildResearchPrompt(card, contentAnalysis);

    const result = await adapter.analyzeImage({
      imageData,
      mediaType,
      prompt,
    });

    const data = parseCardData(result.text);
    const duration = Date.now() - startTime;
    logger.info('CardResearcher', `${card.id} complete`, { dur: duration, model: result.model });

    // Validate against schema
    const validation = validateCardData(card.cardType, data);
    if (!validation.valid) {
      logger.warn('CardResearcher', `${card.id} validation issues`, { errors: validation.errors });
      // Merge with placeholder data for missing required fields
      return {
        ...card.placeholderData,
        ...data,
        _researchMeta: {
          duration,
          model: result.model,
          validationErrors: validation.errors,
        },
      };
    }

    return {
      ...data,
      _researchMeta: {
        duration,
        model: result.model,
      },
    };
  } catch (error) {
    logger.error('CardResearcher', `Failed ${card.id}`, { err: error.message, cardType: card.cardType });
    // Return placeholder data on failure
    return {
      ...card.placeholderData,
      _researchMeta: {
        duration: Date.now() - startTime,
        error: error.message,
      },
    };
  }
}

/**
 * Research multiple cards in parallel
 * @param {Object} options
 * @param {Array} options.cards - Array of card blueprints
 * @param {Object} options.contentAnalysis - Content analysis
 * @param {string} options.imageData - Base64 image
 * @param {string} options.mediaType - MIME type
 * @param {Function} options.onCardComplete - Callback when a card finishes
 * @param {Object} options.adapterConfig - Optional adapter config
 * @returns {Promise<Map>} Map of cardId -> populated data
 */
async function researchCardsInParallel({
  cards,
  contentAnalysis,
  imageData,
  mediaType,
  onCardComplete,
  adapterConfig = {},
}) {
  logger.info('CardResearcher', `Parallel research starting`, { cardCount: cards.length });
  const startTime = Date.now();
  const results = new Map();

  // Launch all research tasks in parallel
  const promises = cards.map(async (card) => {
    const data = await researchCard({
      card,
      contentAnalysis,
      imageData,
      mediaType,
      adapterConfig,
    });

    results.set(card.id, data);

    // Notify caller that this card is ready
    if (onCardComplete) {
      onCardComplete({
        cardId: card.id,
        cardType: card.cardType,
        data,
        completedCount: results.size,
        totalCount: cards.length,
      });
    }

    return { cardId: card.id, data };
  });

  // Wait for all to complete (each one fires onCardComplete independently)
  await Promise.allSettled(promises);

  const totalDuration = Date.now() - startTime;
  logger.info('CardResearcher', `All cards complete`, { cardCount: cards.length, dur: totalDuration });

  return results;
}

/**
 * Parse card data from LLM response
 */
function parseCardData(text) {
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }

    return JSON.parse(text.trim());
  } catch (e) {
    logger.warn('CardResearcher', 'Failed to parse card data', { err: e.message });
    return {};
  }
}

module.exports = {
  researchCard,
  researchCardsInParallel,
};
