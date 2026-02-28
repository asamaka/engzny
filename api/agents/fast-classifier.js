/**
 * Fast Classifier + Card Populator Agent
 *
 * Uses Haiku to quickly:
 * 1. Identify content type from screenshot
 * 2. Pick the right layout
 * 3. Populate cards with ONLY required fields from visible text
 *
 * Target: real populated cards in < 3 seconds from upload.
 * Sonnet later enriches with optional fields and web research.
 */

const { getVisionAdapter } = require('../llm');
const { getCardTypeSummaryForPrompt, getLayoutTypesSummaryForPrompt } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

const FAST_POPULATE_PROMPT = `Analyze this screenshot. Return a JSON card layout with REAL DATA from the visible text. Be fast — only fill required fields.

LAYOUTS: ${getLayoutTypesSummaryForPrompt()}

CARD TYPES (fill ONLY required fields, but include imageUrl/photoUrl when visible):
- hero_summary: title*, subtitle*, emoji* (single emoji for content type). Include imageUrl if any image is visible.
- key_metric: value*, label* (big numbers/stats visible)
- info_list: title*, items*[{label*, value*}] (key-value pairs visible)
- fact_check: claim*, verdict* [verified|misleading|unverified|false|partially_true|needs_context]
- person_card: name*. Add photoUrl if a person's photo is visible in the screenshot.
- product_card: name*. Add imageUrl if product image is visible.
- timeline_card: title*, events*[{date*, event*}]
- quote_card: quote*
- comparison_card: title*, columns*[{header*, values*}]
- warning_card: level* [critical|warning|info], title*
- action_card: title*, actions*[{label*}]
- text_extract: title*, text*
- location_card: name*
- link_card: title*, links*[{label*, url*}]
- news_card: headline*, source*. Add imageUrl if news image visible. Use for news/article content.
- chart_card: title*, chartType* [bar|pie|progress|comparison], data*[{label*, value*}]. Use when numbers can be visualized.
- did_you_know_card: fact*, emoji*. A surprising fact about the content the user likely didn't know.

RULES:
- 4-6 cards max. First card MUST be hero_summary (columnSpan:2)
- Use ONLY text visible in the screenshot
- Keep text SHORT — titles under 8 words, values concise
- Pick DIVERSE card types that match the content — prefer VISUAL cards (news_card, chart_card, person_card with photos)
- ALWAYS include a did_you_know_card with something surprising/new about the content
- For news screenshots: prefer news_card over generic info_list
- For data/numbers: prefer chart_card over text listings
- For breaking news: use neutral hero title, NOT "misleading" or "misinformation"
- For fact_check on breaking news: verdict "unverified" or "needs_context", never "false"
- Include followUpQuestions: 3-5 questions the user would want to ask, with brief pre-populated answers

Return ONLY JSON:
{"contentAnalysis":{"contentType":"...","platform":"...or null","intent":"...","topQuestions":["..."],"followUpQuestions":[{"question":"...","answer":"Brief 1-2 sentence answer"}]},"layout":{"type":"...","columns":2,"reason":"..."},"cards":[{"id":"card-1","cardType":"hero_summary","gridPosition":{"row":1,"column":1,"columnSpan":2,"rowSpan":1},"researchBrief":"...","populatedData":{...}}]}`;

async function fastClassify({ imageData, mediaType, question, adapterConfig = {} }) {
  const startTime = Date.now();

  const config = {
    ...adapterConfig,
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2048,
  };

  const adapter = getVisionAdapter(config);
  const traceCollector = adapterConfig.traceCollector;

  let prompt = FAST_POPULATE_PROMPT;
  if (question) {
    prompt += `\n\nUser question: "${question}" — address it in one card.`;
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
      followUpQuestions: Array.isArray(raw.contentAnalysis?.followUpQuestions)
        ? raw.contentAnalysis.followUpQuestions.slice(0, 5)
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
      populatedData: { title: 'Analyzing...', subtitle: 'Detecting content type...', emoji: '🔍' },
      placeholderData: { title: 'Analyzing...', subtitle: 'Detecting content type...', emoji: '🔍' },
      status: 'placeholder',
    });
  }

  return blueprint;
}

module.exports = { fastClassify };
