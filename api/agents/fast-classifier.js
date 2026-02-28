/**
 * Fast Classifier + Card Populator Agent
 *
 * Uses Haiku to quickly:
 * 1. Identify content type from screenshot
 * 2. Pick the right layout
 * 3. Fully POPULATE cards with real data from the screenshot
 *
 * This is the primary card source — users see real content in ~3-5s.
 * Sonnet later enhances/adds cards, but Haiku's output is the baseline.
 */

const { getVisionAdapter } = require('../llm');
const { getCardTypeSummaryForPrompt, getLayoutTypesSummaryForPrompt } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

const FAST_POPULATE_PROMPT = `You are a fast screenshot analyzer. Look at this screenshot and produce FULLY POPULATED cards with real data.

**Your job:**
1. IDENTIFY the content type and platform
2. PICK the best layout
3. CREATE 3-6 cards with REAL DATA extracted from the screenshot
4. POPULATE every card field with actual content you can see — not placeholders

**Available Layouts:**
${getLayoutTypesSummaryForPrompt()}

**Available Card Types:**
${getCardTypeSummaryForPrompt()}

**Critical Rules:**
- Extract REAL text, numbers, names, dates from the screenshot
- The first card MUST be hero_summary with a real title and subtitle
- Fill ALL required fields with actual content
- For info_list: include real items with real labels and values
- For key_metric: include the actual number/value you see
- For person_card: include the actual name and role
- For product_card: features and warnings arrays must be PLAIN STRINGS
- Include any visible URLs, prices, handles, or links
- Don't say "Analyzing..." or "Loading..." — use real content
- Be concise but accurate — this is what users see first
- Set researchBrief for each card to guide deeper research later

Return ONLY valid JSON:
{
  "contentAnalysis": {
    "contentType": "string (news/product/social/data/general/etc.)",
    "platform": "string or null (Twitter, Amazon, Reddit, etc.)",
    "intent": "string (what the user likely wants to understand)",
    "topQuestions": ["3-5 questions users would ask about this"]
  },
  "layout": {
    "type": "string (one of the layout types)",
    "columns": number (1-3),
    "reason": "string (why this layout)"
  },
  "cards": [
    {
      "id": "card-1",
      "cardType": "hero_summary",
      "gridPosition": { "row": 1, "column": 1, "columnSpan": 2, "rowSpan": 1 },
      "researchBrief": "string (what to research deeper for enhancement)",
      "populatedData": { ... REAL card data with all required fields filled }
    }
  ]
}`;

/**
 * Fast-classify AND populate cards using Haiku.
 * Returns fully populated cards ready for immediate display.
 */
async function fastClassify({ imageData, mediaType, question, adapterConfig = {} }) {
  const startTime = Date.now();

  const config = {
    ...adapterConfig,
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 4096,
  };

  const adapter = getVisionAdapter(config);
  const traceCollector = adapterConfig.traceCollector;

  let prompt = FAST_POPULATE_PROMPT;
  if (question) {
    prompt += `\n\n**User's question:** "${question}"\nMake sure at least one card directly addresses this question with real data.`;
  }

  logger.info('FastClassifier', 'Starting quick classification + population', { model: config.model });

  try {
    const result = await adapter.analyzeImage({
      imageData,
      mediaType,
      prompt,
    });

    const duration = Date.now() - startTime;
    logger.info('FastClassifier', 'Classification + population complete', {
      dur: duration,
      model: result.model,
      usage: result.usage,
    });

    if (traceCollector) {
      traceCollector.record({
        phase: 'classify',
        agent: 'FastClassifier',
        model: result.model || config.model,
        duration,
        request: {
          userPrompt: prompt,
          hasImage: true,
          imageMediaType: mediaType,
          maxTokens: config.maxTokens,
        },
        response: {
          text: result.text,
          usage: result.usage,
          stopReason: result.stopReason,
        },
      });
    }

    const blueprint = parseQuickBlueprint(result.text);
    return normalizeQuickBlueprint(blueprint);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.warn('FastClassifier', 'Classification failed, using fallback', { err: error.message });

    if (traceCollector) {
      traceCollector.record({
        phase: 'classify',
        agent: 'FastClassifier',
        model: config.model,
        duration,
        request: {
          userPrompt: prompt,
          hasImage: true,
          imageMediaType: mediaType,
          maxTokens: config.maxTokens,
        },
        response: {},
        error: error.message,
      });
    }

    return null;
  }
}

function parseQuickBlueprint(text) {
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
    logger.warn('FastClassifier', 'Failed to parse response', { err: e.message });
    return null;
  }
}

function normalizeQuickBlueprint(raw) {
  if (!raw) return null;

  const blueprint = {
    contentAnalysis: {
      contentType: raw.contentAnalysis?.contentType || 'general',
      platform: raw.contentAnalysis?.platform || null,
      intent: raw.contentAnalysis?.intent || 'Analyzing screenshot...',
      topQuestions: Array.isArray(raw.contentAnalysis?.topQuestions)
        ? raw.contentAnalysis.topQuestions.slice(0, 5)
        : [],
    },
    layout: {
      type: raw.layout?.type || 'simple',
      columns: Math.min(raw.layout?.columns || 1, 3),
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
      researchBrief: card.researchBrief || 'Extract relevant information',
      populatedData: card.populatedData || card.placeholderData || {},
      placeholderData: card.populatedData || card.placeholderData || {},
      status: card.populatedData ? 'populated' : 'placeholder',
    }));
  }

  if (blueprint.cards.length === 0 || blueprint.cards[0].cardType !== 'hero_summary') {
    blueprint.cards.unshift({
      id: 'card-hero',
      cardType: 'hero_summary',
      gridPosition: { row: 0, column: 1, columnSpan: blueprint.layout.columns, rowSpan: 1 },
      researchBrief: 'Summarize the screenshot content',
      populatedData: { title: 'Analyzing...', subtitle: 'Detecting content type...' },
      placeholderData: { title: 'Analyzing...', subtitle: 'Detecting content type...' },
      status: 'placeholder',
    });
  }

  return blueprint;
}

module.exports = { fastClassify };
