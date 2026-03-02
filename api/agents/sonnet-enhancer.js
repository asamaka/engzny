/**
 * Sonnet Enhancer Agent
 *
 * Uses Claude Sonnet with tool_use to progressively enhance the card layout.
 * Sonnet can see the screenshot + what Haiku has already rendered, then:
 * 1. Update existing cards with richer data (fill optional fields)
 * 2. Add new cards that Haiku missed
 * 3. Change the layout if a better one fits
 *
 * Triggered twice:
 * - After Haiku populates initial cards (enhancement pass)
 * - After Sonar returns deep research (review pass)
 */

const { getVisionAdapter } = require('../llm');
const { getCardTypeDetailedSchemaForPrompt, getLayoutTypesSummaryForPrompt } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

const ENHANCER_TOOLS = [
  {
    name: 'update_card',
    description: 'Update an existing card — fill optional fields, correct data, enrich content. Keep text concise.',
    input_schema: {
      type: 'object',
      properties: {
        cardId: {
          type: 'string',
          description: 'ID of the card to update (e.g. "card-1")',
        },
        cardType: {
          type: 'string',
          description: 'The card type (must match existing card type)',
        },
        data: {
          type: 'object',
          description: 'Updated card data fields. Only include fields you want to change or add.',
        },
        reason: {
          type: 'string',
          description: 'Brief reason for the update',
        },
      },
      required: ['cardId', 'cardType', 'data'],
    },
  },
  {
    name: 'add_card',
    description: 'Add a new card. Fill ALL required fields and as many optional fields as possible. Keep text concise.',
    input_schema: {
      type: 'object',
      properties: {
        cardType: {
          type: 'string',
          description: 'Type of card to add',
        },
        data: {
          type: 'object',
          description: 'Fully populated card data with all required fields',
        },
        position: {
          type: 'object',
          description: 'Grid position for the new card',
          properties: {
            row: { type: 'number' },
            column: { type: 'number' },
            columnSpan: { type: 'number' },
            rowSpan: { type: 'number' },
          },
        },
        reason: {
          type: 'string',
          description: 'Why this card should be added',
        },
      },
      required: ['cardType', 'data'],
    },
  },
  {
    name: 'update_layout',
    description: 'Change the layout type if a better layout fits the content. Use sparingly.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'New layout type',
        },
        columns: {
          type: 'number',
          description: 'Number of columns (1-3)',
        },
        reason: {
          type: 'string',
          description: 'Why this layout is better',
        },
      },
      required: ['type'],
    },
  },
];

function buildEnhancerPrompt(currentCards, contentAnalysis, layout, researchData) {
  const currentState = JSON.stringify({
    contentAnalysis,
    layout,
    cards: currentCards.map(c => ({
      id: c.id,
      cardType: c.cardType,
      data: c.populatedData || c.data || c.placeholderData,
      gridPosition: c.gridPosition,
    })),
  }, null, 2);

  let prompt = `You are populating a screenshot analysis hub. A fast classifier identified the content and chose a layout with skeleton cards. YOUR JOB: populate each card with REAL DATA from the screenshot, making the hub informative, visual, and concise.

**The user already sees these cards as loading skeletons. Populate them in order of importance — each call you make instantly appears on screen.**

**Current state:**
${currentState}

**Card schemas:**
${getCardTypeDetailedSchemaForPrompt()}

**Available layouts:**
${getLayoutTypesSummaryForPrompt()}

**YOUR TASKS (PRIORITY ORDER):**
1. POPULATE HERO: Update hero_summary with a proper takeaway, imageUrl if relevant, and ensure title is under 6 words. Add badge and badgeColor.
2. POPULATE EACH CARD: For every skeleton card, call update_card with its required + optional fields. Extract data from the screenshot.
3. VERIFICATION: If there's a verification_card, set each source status to confirmed/denied/not_yet_reported. Include snippets and URLs.
4. ADD IMAGES: person_card needs photoUrl, location_card needs imageUrl, news_card needs imageUrl.
5. ADD CONTEXT: Fill optional fields like emoji, context, notableInfo, details on every card.
6. ADD MISSING CARDS: If important information is visible but no card exists for it, use add_card. Always add did_you_know_card.
7. REMOVE UNNECESSARY: If a skeleton card type doesn't fit the content, replace it with something better via add_card.

**CRITICAL RULES:**
- POPULATE ALL CARDS — skeleton cards with no data look broken to the user
- Keep ALL text ultra-concise — no paragraphs. Titles: max 6 words. Values: max 10 words.
- For person_card: ALWAYS include name, role, and context even if sparse
- For location_card: ALWAYS include name, context, and a Google Maps URL in mapUrl
- For verification_card: set sources to "not_yet_reported" if you can't verify (NEVER leave as "checking")
- Use emoji liberally for visual interest
- Total cards 4-7 — quality over quantity
- For product_card: features/warnings must be plain strings

**Breaking news rules:**
- NEVER label news as "MISLEADING"/"MISINFORMATION" in hero_summary
- Present breaking news neutrally with short factual titles
- ALWAYS use verification_card (not fact_check) for breaking news`;

  if (researchData) {
    prompt += `\n\n**Web research findings:**
${JSON.stringify(researchData, null, 2)}

Use research to:
- UPDATE verification_card sources with actual findings — this is the #1 priority
- Add source URLs and citations to all cards
- Verify or correct facts
- Enrich cards with web data
- If research shows initial analysis was wrong, correct it
- Remove any filler/boring cards that research makes redundant`;
  }

  return prompt;
}

async function enhance({
  imageData,
  mediaType,
  currentCards,
  contentAnalysis,
  layout,
  researchData,
  onCardUpdate,
  onCardAdd,
  onLayoutUpdate,
  adapterConfig = {},
}) {
  const startTime = Date.now();
  const config = {
    ...adapterConfig,
    model: adapterConfig.model || 'claude-sonnet-4-20250514',
    maxTokens: 4096,
  };

    const adapter = getVisionAdapter(config);
    const traceCollector = adapterConfig.traceCollector;
    const prompt = buildEnhancerPrompt(currentCards, contentAnalysis, layout, researchData);
    const phase = researchData ? 'review' : 'enhance';

    logger.info('SonnetEnhancer', `Starting ${phase} pass`, {
      model: config.model,
      cardCount: currentCards.length,
      hasResearch: !!researchData,
    });

    try {
      const response = await adapter.analyzeImageWithTools({
        imageData,
        mediaType,
        prompt,
        tools: ENHANCER_TOOLS,
        maxTokens: config.maxTokens,
      });

    const duration = Date.now() - startTime;
    const actions = [];
    let nextCardId = currentCards.length + 1;

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const { name, input } = block;

        if (name === 'update_card' && input.cardId && input.data) {
          const action = {
            type: 'update_card',
            cardId: input.cardId,
            cardType: input.cardType,
            data: input.data,
            reason: input.reason,
          };
          actions.push(action);
          if (onCardUpdate) onCardUpdate(action);
        }

        if (name === 'add_card' && input.cardType && input.data) {
          const cardId = `card-${nextCardId++}`;
          const action = {
            type: 'add_card',
            cardId,
            cardType: input.cardType,
            data: input.data,
            gridPosition: input.position || {
              row: nextCardId,
              column: 1,
              columnSpan: 1,
              rowSpan: 1,
            },
            reason: input.reason,
          };
          actions.push(action);
          if (onCardAdd) onCardAdd(action);
        }

        if (name === 'update_layout' && input.type) {
          const action = {
            type: 'update_layout',
            layoutType: input.type,
            columns: input.columns,
            reason: input.reason,
          };
          actions.push(action);
          if (onLayoutUpdate) onLayoutUpdate(action);
        }
      }
    }

    logger.info('SonnetEnhancer', `${phase} pass complete`, {
      dur: duration,
      model: response.model,
      actions: actions.length,
      updates: actions.filter(a => a.type === 'update_card').length,
      adds: actions.filter(a => a.type === 'add_card').length,
      layoutChanges: actions.filter(a => a.type === 'update_layout').length,
      usage: response.usage,
    });

    if (traceCollector) {
      traceCollector.record({
        phase,
        agent: 'SonnetEnhancer',
        model: response.model || config.model,
        duration,
        request: {
          userPrompt: prompt,
          hasImage: true,
          imageMediaType: mediaType,
          maxTokens: config.maxTokens,
          tools: ENHANCER_TOOLS.map(t => t.name),
        },
        response: {
          actions,
          usage: response.usage,
          stopReason: response.stopReason,
        },
      });
    }

    return { actions, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('SonnetEnhancer', `${phase} pass failed`, {
      err: error.message,
      dur: duration,
    });

    if (traceCollector) {
      traceCollector.record({
        phase,
        agent: 'SonnetEnhancer',
        model: config.model,
        duration,
        request: { userPrompt: prompt, hasImage: true },
        response: {},
        error: error.message,
      });
    }

    return { actions: [], duration, error: error.message };
  }
}

module.exports = { enhance, ENHANCER_TOOLS };
