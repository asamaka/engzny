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
const { getCardTypeSummaryForPrompt, getCardTypeDetailedSchemaForPrompt, getLayoutTypesSummaryForPrompt } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

const FAST_POPULATE_PROMPT = `You are a fast screenshot analyzer building a rich dashboard of cards. Look at this screenshot and produce FULLY POPULATED cards with real data.

**Your job:**
1. IDENTIFY the content type and platform
2. PICK the best layout (always use columns: 2 for dashboard feel)
3. CREATE 4-7 DIVERSE cards with REAL DATA from the screenshot
4. POPULATE every required field + as many optional fields as possible

**Available Layouts:**
${getLayoutTypesSummaryForPrompt()}

**Card Type Library — Required & Optional Fields:**
${getCardTypeDetailedSchemaForPrompt()}

**Dashboard Design Rules:**
- FIRST card: hero_summary (FULL WIDTH, columnSpan: 2) with title, subtitle, and takeaway
- hero_summary: ALWAYS include a badge (content category), takeaway (key insight), and icon
- If you see an image URL in the screenshot, include it as imageUrl in hero_summary
- MIX card sizes: hero_summary spans full width, key_metric cards are compact (columnSpan: 1), info_list/timeline span 2 columns
- Use DIVERSE card types — don't repeat the same type. Pick from: key_metric, info_list, fact_check, person_card, product_card, timeline_card, quote_card, warning_card, action_card, text_extract, location_card, link_card
- For fact_check cards: include claim, verdict, and explanation with source info
- For warning_card: include level, title, and details with advice
- Fill ALL required fields with actual extracted content — never "N/A" or "Loading..."
- Include visible URLs, prices, handles, dates, names
- For product_card: features and warnings must be PLAIN STRINGS
- Set researchBrief for each card to guide deeper web research

**CRITICAL — Breaking News Rules:**
- For breaking news content: DO NOT label reports as "MISLEADING" or "MISINFORMATION" in hero_summary. Use neutral titles like "Breaking: [Topic]" and set badge to "Breaking News", not "MISINFORMATION"
- A news report from a credible news organization (Al Jazeera, BBC, Reuters, CNN, etc.) should be presented neutrally, not prejudged as false
- For fact_check cards on breaking news: use verdict "unverified" or "needs_context" with confidence "low" — NEVER "misleading" or "false" unless you have overwhelming contradicting evidence
- In the hero_summary takeaway, present what is being reported factually rather than asserting it is true or false
- For military/conflict breaking news: events happen simultaneously on multiple sides. Strikes AND retaliatory strikes can both be real. Do not dismiss one side's reports just because the other side also has news
- Set researchBrief to explicitly ask for multi-source verification and checking all sides of the story

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
    "columns": 2,
    "reason": "string (why this layout)"
  },
  "cards": [
    {
      "id": "card-1",
      "cardType": "hero_summary",
      "gridPosition": { "row": 1, "column": 1, "columnSpan": 2, "rowSpan": 1 },
      "researchBrief": "string (what to research deeper)",
      "populatedData": { "title": "...", "subtitle": "...", "badge": "...", "takeaway": "...", "icon": "..." }
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
