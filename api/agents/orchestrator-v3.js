/**
 * Orchestrator V3 — Tool-Calling Pipeline
 *
 * Single Opus 4.6 model analyzes the screenshot and progressively builds the UI
 * through rapid tool calls. Each tool call triggers an immediate SSE event to the
 * client, so the user sees updates every 2-3 seconds instead of waiting 15-20s.
 *
 * Flow:
 *   Opus sees screenshot → classify() → buildLayout() → addContent() × N
 *   Each tool call = instant UI update
 *
 * Tools:
 *   classify    — Set content type, language, summary (renders header immediately)
 *   buildLayout — Define card grid (renders skeleton cards immediately)
 *   addContent  — Populate a specific card (renders card content immediately)
 */

const { CARD_TYPES, LAYOUT_TYPES, getCardTypeSummaryForPrompt, getLayoutTypesSummaryForPrompt } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

const TOOL_DEFINITIONS = [
  {
    name: 'classify',
    description: 'Classify the screenshot content. Call this FIRST and FAST — the user is waiting. Provide a quick summary so the UI can show something immediately.',
    input_schema: {
      type: 'object',
      properties: {
        contentType: {
          type: 'string',
          enum: ['news', 'social_media', 'product', 'settings', 'chat', 'article', 'dashboard', 'search_results', 'map', 'error_screen', 'other'],
          description: 'What type of content is in this screenshot',
        },
        language: { type: 'string', description: 'Primary language (ISO 639-1 code, e.g. "en", "ar", "es")' },
        summary: { type: 'string', description: 'One sentence summary of what the screenshot shows (translate to English if needed)' },
        topQuestions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Top 2-3 things a user would want to know about this screenshot',
        },
      },
      required: ['contentType', 'summary'],
    },
  },
  {
    name: 'buildLayout',
    description: `Define the card layout grid. Call this SECOND. Choose a layout type and define cards. Each card gets a position on a 12-column CSS grid. Keep it focused: 3-6 cards maximum.

Layout types:
${getLayoutTypesSummaryForPrompt()}

Card types:
${getCardTypeSummaryForPrompt()}`,
    input_schema: {
      type: 'object',
      properties: {
        layoutType: {
          type: 'string',
          enum: Object.keys(LAYOUT_TYPES),
          description: 'Layout template to use',
        },
        cards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique card ID (e.g. "hero", "metric-1", "details")' },
              cardType: { type: 'string', enum: Object.keys(CARD_TYPES), description: 'Card type from the list above' },
              title: { type: 'string', description: 'Card title to show while loading' },
              gridColumn: { type: 'string', description: 'CSS grid-column value (e.g. "1 / -1" for full width, "1 / 7" for half)' },
              gridRow: { type: 'string', description: 'CSS grid-row value (e.g. "1", "2 / 4" for spanning)' },
            },
            required: ['id', 'cardType', 'title'],
          },
          description: 'Cards to display, ordered by importance',
        },
      },
      required: ['layoutType', 'cards'],
    },
  },
  {
    name: 'addContent',
    description: `Populate a card with content. Call this for EACH card after buildLayout. Call with the card's ID and provide the data matching the card type schema. Make each call quickly with the most important information first — you can call addContent on the same card again later to enrich it.`,
    input_schema: {
      type: 'object',
      properties: {
        cardId: { type: 'string', description: 'ID of the card to populate (must match an ID from buildLayout)' },
        data: {
          type: 'object',
          description: 'Card content matching the card type schema. Include all available fields.',
        },
      },
      required: ['cardId', 'data'],
    },
  },
];

const SYSTEM_PROMPT = `You are a screenshot intelligence agent. You analyze screenshots and build an interactive card-based UI to help users understand what they see.

You have 3 tools. Call them in this order, QUICKLY:

1. **classify** — Call IMMEDIATELY. Just tell me what this is. The user is staring at a loading screen.
2. **buildLayout** — Call within a second of classify. Pick a layout and define 3-6 cards.
3. **addContent** — Call once per card. Start with the most important card (usually hero_summary). Each call renders that card instantly for the user.

RULES:
- Be FAST. Make each tool call with SHORT, focused inputs.
- Do NOT write long text blocks between tool calls — just call the next tool.
- For addContent, extract VISIBLE information from the screenshot. Don't fabricate.
- If the screenshot contains non-English text, translate key information to English.
- Every URL visible in the screenshot should be included in the relevant card.
- For news/social media: always check claims and add a fact_check or warning_card if needed.
- Make ALL your tool calls in a single response turn. Don't wait for results.`;

/**
 * Run the v3 tool-calling pipeline.
 *
 * @param {Object} opts
 * @param {string} opts.imageData - base64 image data
 * @param {string} opts.mediaType - image MIME type
 * @param {string} [opts.question] - optional user question
 * @param {Function} opts.onClassify - called when classify tool fires
 * @param {Function} opts.onLayout - called when buildLayout tool fires
 * @param {Function} opts.onCardContent - called when addContent tool fires
 * @param {Function} opts.onComplete - called when all tool calls are done
 * @param {Function} opts.onError - called on error
 */
async function runPipelineV3(opts) {
  const {
    imageData, mediaType, question,
    onClassify, onLayout, onCardContent, onComplete, onError,
  } = opts;

  const Anthropic = require('@anthropic-ai/sdk').default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userContent = [
    {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageData },
    },
    {
      type: 'text',
      text: question
        ? `Analyze this screenshot. The user asks: "${question}"\n\nCall your tools now.`
        : 'Analyze this screenshot. Call your tools now.',
    },
  ];

  let classification = null;
  let layout = null;
  const cardContents = new Map();
  const toolCallOrder = [];

  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userContent }],
    });

    // Use 'contentBlock' event — fires for each completed content block
    // (text or tool_use). This is the correct event name in the Anthropic SDK.
    stream.on('contentBlock', (block) => {
      if (block?.type !== 'tool_use') return;

      const toolName = block.name;
      const input = block.input;
      if (!toolName || !input) return;

      toolCallOrder.push(toolName);
      logger.info('PipelineV3', `Tool call: ${toolName}`, { requestId: opts._requestId });

      try {
        if (toolName === 'classify') {
          classification = input;
          onClassify(input);
        } else if (toolName === 'buildLayout') {
          layout = input;
          onLayout(input);
        } else if (toolName === 'addContent') {
          const { cardId, data } = input;
          if (cardId && data) {
            const existing = cardContents.get(cardId);
            const merged = existing ? { ...existing, ...data } : data;
            cardContents.set(cardId, merged);
            onCardContent({ cardId, data: merged });
          }
        }
      } catch (e) {
        logger.error('PipelineV3', `Callback error for ${toolName}`, { err: e.message });
      }
    });

    await stream.finalMessage();

    const result = {
      classification,
      layout,
      cards: layout?.cards?.map(c => ({
        ...c,
        data: cardContents.get(c.id) || null,
      })) || [],
      toolCallOrder,
      _meta: { toolCalls: toolCallOrder.length },
    };

    try { onComplete(result); } catch (e) { logger.error('PipelineV3', 'onComplete error', { err: e.message }); }

  } catch (err) {
    logger.error('PipelineV3', 'Pipeline failed', { err: err.message });
    try { onError(err); } catch (e) { /* ignore */ }
  }
}

module.exports = { runPipelineV3, TOOL_DEFINITIONS };
