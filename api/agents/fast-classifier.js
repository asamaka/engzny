/**
 * Fast Classifier Agent
 *
 * Uses a cheap, fast model (Haiku) to quickly:
 * 1. Identify content type from screenshot
 * 2. Pick the right layout (dashboard, editorial, etc.)
 * 3. Generate a contextual card blueprint with filler data
 *
 * This runs in 2-4s vs 10-20s for the full layout designer,
 * giving users an instant contextual skeleton while the real
 * designer + researchers work in the background.
 */

const { getVisionAdapter } = require('../llm');
const { getCardTypeSummaryForPrompt, getLayoutTypesSummaryForPrompt } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

const FAST_CLASSIFIER_PROMPT = `You are a fast image classifier. Look at this screenshot and QUICKLY determine:

1. What TYPE of content this is
2. The best LAYOUT for displaying analysis cards
3. Which CARDS to show (with approximate placeholder data from what you can see)

**Available Layouts:**
${getLayoutTypesSummaryForPrompt()}

**Available Card Types:**
${getCardTypeSummaryForPrompt()}

**Rules:**
- Be FAST - extract what's immediately visible, don't over-analyze
- Choose 3-6 cards that match the content
- First card MUST be hero_summary
- Fill placeholderData with best-guess content from what you can directly SEE
- For product content: include product_card, key_metric for price/specs
- For news/articles: include fact_check, quote_card, timeline_card
- For social media: include person_card, quote_card
- For data/dashboards: include key_metric cards, comparison_card
- Include any visible URLs, links, or prices in placeholder data
- Set gridPosition with proper columnSpan for the layout

Return ONLY valid JSON:
{
  "contentAnalysis": {
    "contentType": "string",
    "platform": "string or null",
    "intent": "string (what user wants to know)",
    "topQuestions": ["3-5 questions"]
  },
  "layout": {
    "type": "string (layout type)",
    "columns": number (1-3),
    "reason": "string"
  },
  "cards": [
    {
      "id": "card-1",
      "cardType": "hero_summary",
      "gridPosition": { "row": 1, "column": 1, "columnSpan": 2, "rowSpan": 1 },
      "researchBrief": "string (what to research deeper)",
      "placeholderData": { ... visible content as placeholder }
    }
  ]
}`;

/**
 * Fast-classify a screenshot using Haiku
 * @returns {Promise<Object>} Quick layout blueprint
 */
async function fastClassify({ imageData, mediaType, question, adapterConfig = {} }) {
  const startTime = Date.now();

  const config = {
    ...adapterConfig,
    model: 'claude-haiku-4-5-latest',
    maxTokens: 2048,
  };

  const adapter = getVisionAdapter(config);
  const traceCollector = adapterConfig.traceCollector;

  let prompt = FAST_CLASSIFIER_PROMPT;
  if (question) {
    prompt += `\n\n**User's question:** "${question}"\nInclude a card that addresses this.`;
  }

  logger.info('FastClassifier', 'Starting quick classification', { model: config.model });

  try {
    const result = await adapter.analyzeImage({
      imageData,
      mediaType,
      prompt,
    });

    const duration = Date.now() - startTime;
    logger.info('FastClassifier', 'Classification complete', {
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
      placeholderData: card.placeholderData || {},
      status: 'placeholder',
    }));
  }

  if (blueprint.cards.length === 0 || blueprint.cards[0].cardType !== 'hero_summary') {
    blueprint.cards.unshift({
      id: 'card-hero',
      cardType: 'hero_summary',
      gridPosition: { row: 0, column: 1, columnSpan: blueprint.layout.columns, rowSpan: 1 },
      researchBrief: 'Summarize the screenshot content',
      placeholderData: { title: 'Analyzing...', subtitle: 'Detecting content type...' },
      status: 'placeholder',
    });
  }

  return blueprint;
}

module.exports = { fastClassify };
