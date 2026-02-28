/**
 * Sonnet Enhancer Agent
 *
 * Uses Claude Sonnet with tool_use to progressively enhance the card layout.
 * Sonnet can see the screenshot + what Haiku has already rendered, then:
 * 1. Update existing cards with richer data
 * 2. Add new cards that Haiku missed
 * 3. Change the layout if a better one fits
 *
 * Triggered twice:
 * - After Haiku populates initial cards (enhancement pass)
 * - After Sonar returns deep research (review pass)
 */

const { getVisionAdapter } = require('../llm');
const { getCardTypeSummaryForPrompt, getLayoutTypesSummaryForPrompt, getCardSchema, validateCardData } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

const ENHANCER_TOOLS = [
  {
    name: 'update_card',
    description: 'Update an existing card with richer or corrected data. Use this to improve cards that Haiku populated with basic information.',
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
    description: 'Add a new card to the layout. Use this for information that Haiku missed or for deeper analysis cards.',
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

/**
 * Build the enhancement prompt for Sonnet.
 * Includes screenshot context + what Haiku has already rendered.
 */
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

  let prompt = `You are an expert analyst enhancing a screenshot analysis. A fast model has already analyzed this screenshot and created initial cards. Your job is to IMPROVE the analysis.

**Current state (from fast initial analysis):**
${currentState}

**Available Card Types:**
${getCardTypeSummaryForPrompt()}

**Available Layouts:**
${getLayoutTypesSummaryForPrompt()}

**Your tasks:**
1. REVIEW each existing card — are the facts correct? Is data missing?
2. UPDATE cards that need richer content, corrections, or additional fields
3. ADD new cards for important information the initial analysis missed
4. Consider adding fact_check, timeline_card, or comparison_card for richer analysis
5. Only UPDATE_LAYOUT if the current layout is clearly wrong for the content

**Rules:**
- Focus on QUALITY improvements, not just cosmetic changes
- Don't update a card unless you have genuinely better information
- Add cards only if they provide real value (don't pad with fluff)
- For product_card: features and warnings must be plain strings
- Keep card count reasonable (max 8 total)
- For fact_check cards: assess based on visible information
- Extract any URLs, prices, names, or dates you can see more clearly`;

  if (researchData) {
    prompt += `\n\n**Deep research findings (from web search):**
${JSON.stringify(researchData, null, 2)}

Use this research to:
- Verify or correct facts in existing cards
- Add source URLs and citations
- Create fact_check cards for claims that need verification
- Update timeline_card with accurate dates
- Enrich person_card or product_card with web-sourced details`;
  }

  return prompt;
}

/**
 * Run Sonnet enhancement pass.
 * Returns an array of actions (update_card, add_card, update_layout) via callbacks.
 */
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
