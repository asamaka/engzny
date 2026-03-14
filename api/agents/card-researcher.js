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

const { getVisionAdapter, getDefaultAdapter, getResearchAdapter, isPerplexityAvailable } = require('../llm');
const { getCardSchema, validateCardData } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

const WEB_RESEARCH_CARD_TYPES = new Set([
  'fact_check',
  'timeline_card',
  'person_card',
  'product_card',
  'comparison_card',
  'location_card',
  'news_card',
  'did_you_know_card',
  'verification_card',
]);

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

  const needsWebResearch = WEB_RESEARCH_CARD_TYPES.has(card.cardType);
  const webSearchInstructions = needsWebResearch
    ? `\n8. You have web search access — use it to verify facts, find current prices, check recent events, or look up people/products visible in the screenshot
9. When web search provides information, prefer it over guessing from the screenshot alone
10. Include source URLs in the sourceUrl field when available from search results`
    : '';

  const photoInstructions = ['person_card', 'location_card', 'news_card', 'did_you_know_card'].includes(card.cardType)
    ? `\n\nIMPORTANT — FIND REAL IMAGES:
- For person_card: Search for "${card.placeholderData?.name || 'the person'}" and find their Wikipedia/official photo URL. Set it in photoUrl.
- For location_card: Search for a photo of "${card.placeholderData?.name || 'the location'}" and set it in imageUrl.
- For news_card: Find the article's featured image URL. Set it in imageUrl.
- For did_you_know_card: Find a related image URL. Set it in imageUrl.
- Real photos make cards dramatically more engaging and useful.`
    : '';

  const verificationInstructions = card.cardType === 'verification_card'
    ? `\n\nVERIFICATION CARD — CRITICAL INSTRUCTIONS:
- This card tracks live verification of a breaking news claim.
- You MUST search the web for this claim RIGHT NOW.
- Check major news sources: Reuters, AP News, BBC, CNN, Al Jazeera, etc.
- For EACH source, report what you find:
  - "confirmed" = source explicitly reports this event
  - "denied" = source explicitly denies this event
  - "not_yet_reported" = source exists but hasn't covered this yet
  - "no_info" = couldn't find relevant info from this source
- Set status to "searching" if still looking, "partially_verified" if some sources confirm, "verified" if major sources confirm, "denied" if major sources deny, "unconfirmed" if no sources report it.
- Include source URLs for every source you check.
- Be HONEST about what you find. If nothing confirms it, say so clearly.`
    : '';

  return `You are a research specialist populating a card with accurate, concise data${needsWebResearch ? ' using web search' : ' from a screenshot'}.

Context: ${contentAnalysis.contentType}${contentAnalysis.platform ? ` on ${contentAnalysis.platform}` : ''} — ${contentAnalysis.intent}

Card: ${card.cardType} — ${card.researchBrief}

Fields:
${fieldDescriptions}

Rules:
1. Use ONLY visible information — never fabricate text data
2. OMIT unknown fields rather than writing "Not visible" or "N/A"
3. Keep text SHORT — titles max 8 words, explanations max 1-2 sentences
4. For product_card: features/warnings must be plain strings
5. Include visible URLs in url/sourceUrl/mapUrl fields
6. For fact_check: verdict and confidence MUST be coherent — "verified" requires confidence "high" or "medium", "unverified"/"needs_context" requires confidence "low". Never use "misleading" or "false" without strong evidence from web search
7. Add emoji field where schema supports it for visual richness
8. Focus on information the user likely DIDN'T know — surprising context, background, connections${webSearchInstructions}${photoInstructions}${verificationInstructions}

Return ONLY valid JSON:`;
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
  const needsWebResearch = WEB_RESEARCH_CARD_TYPES.has(card.cardType);
  const usePerplexity = needsWebResearch && isPerplexityAvailable();

  logger.info('CardResearcher', `Starting ${card.id}`, {
    cardType: card.cardType,
    webSearch: needsWebResearch,
    perplexity: usePerplexity,
  });

  const traceCollector = adapterConfig.traceCollector;

  try {
    const prompt = buildResearchPrompt(card, contentAnalysis);
    let result;
    let perplexityResult = null;

    if (usePerplexity) {
      const [visionResult, pplxResult] = await Promise.allSettled([
        getVisionAdapter(adapterConfig).analyzeImage({ imageData, mediaType, prompt }),
        researchWithPerplexity(card, contentAnalysis, adapterConfig),
      ]);

      result = visionResult.status === 'fulfilled' ? visionResult.value : null;
      perplexityResult = pplxResult.status === 'fulfilled' ? pplxResult.value : null;

      if (!result && !perplexityResult) {
        throw visionResult.reason || new Error('Both vision and Perplexity research failed');
      }

      if (perplexityResult) {
        logger.info('CardResearcher', `${card.id} Perplexity enrichment available`, {
          citations: perplexityResult.citations?.length || 0,
        });
      }
    } else if (needsWebResearch) {
      const adapter = getVisionAdapter(adapterConfig);
      if (typeof adapter.analyzeImageWithWebSearch === 'function') {
        result = await adapter.analyzeImageWithWebSearch({
          imageData,
          mediaType,
          prompt,
          maxSearches: 3,
        });
        if (result.webSearchUsed) {
          logger.info('CardResearcher', `${card.id} used Claude web search`, {
            searchCount: result.searchResults?.length || 0,
          });
        }
      } else {
        result = await adapter.analyzeImage({ imageData, mediaType, prompt });
      }
    } else {
      const adapter = getVisionAdapter(adapterConfig);
      result = await adapter.analyzeImage({ imageData, mediaType, prompt });
    }

    let data = result ? parseCardData(result.text) : {};

    if (perplexityResult) {
      const pplxData = parseCardData(perplexityResult.text);
      data = mergeResearchData(data, pplxData, perplexityResult.citations);
    }

    const duration = Date.now() - startTime;
    const modelUsed = result?.model || adapterConfig.model || 'claude-sonnet-4-20250514';

    logger.info('CardResearcher', `${card.id} complete`, {
      dur: duration,
      model: modelUsed,
      webSearch: result?.webSearchUsed || false,
      perplexity: !!perplexityResult,
    });

    if (traceCollector) {
      traceCollector.record({
        phase: 'research',
        agent: 'CardResearcher',
        model: modelUsed,
        duration,
        request: {
          userPrompt: prompt,
          hasImage: true,
          imageMediaType: mediaType,
          maxTokens: adapterConfig.maxTokens || 4096,
          webSearchEnabled: needsWebResearch,
          perplexityUsed: !!perplexityResult,
        },
        response: {
          text: result?.text || '',
          structured: data,
          usage: result?.usage,
          stopReason: result?.stopReason,
          webSearchUsed: result?.webSearchUsed || false,
          citations: [
            ...(result?.citations || []),
            ...(perplexityResult?.citations || []),
          ],
        },
        cardId: card.id,
        cardType: card.cardType,
      });
    }

    const validation = validateCardData(card.cardType, data);
    if (!validation.valid) {
      logger.warn('CardResearcher', `${card.id} validation issues`, { errors: validation.errors });
      return {
        ...card.placeholderData,
        ...data,
        _researchMeta: {
          duration,
          model: modelUsed,
          validationErrors: validation.errors,
          webSearch: result?.webSearchUsed || false,
          perplexity: !!perplexityResult,
        },
      };
    }

    return {
      ...data,
      _researchMeta: {
        duration,
        model: modelUsed,
        webSearch: result?.webSearchUsed || false,
        perplexity: !!perplexityResult,
        citations: [
          ...(result?.citations || []),
          ...(perplexityResult?.citations || []),
        ],
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('CardResearcher', `Failed ${card.id}`, { err: error.message, cardType: card.cardType });

    if (traceCollector) {
      traceCollector.record({
        phase: 'research',
        agent: 'CardResearcher',
        model: adapterConfig.model || 'claude-sonnet-4-20250514',
        duration,
        request: {
          userPrompt: buildResearchPrompt(card, contentAnalysis),
          hasImage: true,
          imageMediaType: mediaType,
          maxTokens: adapterConfig.maxTokens || 4096,
        },
        response: {},
        cardId: card.id,
        cardType: card.cardType,
        error: error.message,
      });
    }

    return {
      ...card.placeholderData,
      _researchMeta: {
        duration,
        error: error.message,
      },
    };
  }
}

/**
 * Use Perplexity Sonar to research a card topic with live web data
 */
async function researchWithPerplexity(card, contentAnalysis, adapterConfig) {
  const adapter = getResearchAdapter({
    ...adapterConfig,
    model: 'sonar',
  });

  const schema = getCardSchema(card.cardType);
  const fieldNames = schema ? Object.keys(schema.schema).join(', ') : '';

  const query = `Research the following based on a ${contentAnalysis.contentType} screenshot${contentAnalysis.platform ? ` from ${contentAnalysis.platform}` : ''}.

Card type: ${card.cardType}
Research brief: ${card.researchBrief}
Required fields: ${fieldNames}

${card.placeholderData ? `Visible context: ${JSON.stringify(card.placeholderData)}` : ''}

Return ONLY valid JSON with the card data fields. Include sourceUrl if you find relevant URLs.`;

  return adapter.generateText({
    prompt: query,
    systemPrompt: `You are a research specialist. Return ONLY valid JSON with factual, verified information. No markdown, no explanation.`,
  });
}

/**
 * Merge vision-based data with Perplexity web research data.
 * Vision data takes priority for visual fields; Perplexity enriches factual fields.
 */
function mergeResearchData(visionData, pplxData, citations = []) {
  if (!pplxData || Object.keys(pplxData).length === 0) return visionData;
  if (!visionData || Object.keys(visionData).length === 0) return { ...pplxData, _webCitations: citations };

  const merged = { ...visionData };

  for (const [key, value] of Object.entries(pplxData)) {
    if (value === null || value === undefined) continue;
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
      merged[key] = value;
    }
    if (key === 'sourceUrl' && value && !merged.sourceUrl) {
      merged.sourceUrl = value;
    }
  }

  if (citations.length > 0) {
    merged._webCitations = citations;
  }

  return merged;
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
