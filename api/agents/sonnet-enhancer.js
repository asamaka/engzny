/**
 * Sonnet Enhancer Agent
 *
 * Uses Claude Sonnet with tool_use + web_search to progressively enhance
 * the card layout. Sonnet can see the screenshot, search the web to validate
 * sources, and populate cards with real data:
 *   1. Update existing cards with richer data (fill optional fields)
 *   2. Add new cards that Haiku missed
 *   3. Validate claims by searching source domains from the screenshot
 *   4. Change the layout if a better one fits
 *
 * Triggered twice:
 * - After Haiku populates initial cards (enhancement + web search pass)
 * - After Sonar returns deep research (review pass — text only, no image)
 */

const { getVisionAdapter } = require('../llm');
const { getCardTypeDetailedSchemaForPrompt, getCardTypeSchemaForTypes, getLayoutTypesSummaryForPrompt, CARD_TYPES, LAYOUT_TYPES } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
};

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

function truncateStr(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + '...';
}

function buildEnhancerPrompt(currentCards, contentAnalysis, layout, researchData) {
  const existingTypes = currentCards.map(c => c.cardType);
  const layoutDef = LAYOUT_TYPES[layout?.type];
  const suggestedTypes = layoutDef ? layoutDef.suggestedCards : [];
  const relevantTypes = [...new Set([...existingTypes, ...suggestedTypes, 'did_you_know_card'])];

  const allTypeNames = Object.keys(CARD_TYPES);
  const otherTypes = allTypeNames.filter(t => !relevantTypes.includes(t));

  const currentState = JSON.stringify({
    contentAnalysis,
    layout: { type: layout.type, columns: layout.columns },
    cards: currentCards.map(c => ({
      id: c.id,
      cardType: c.cardType,
      data: c.populatedData || c.data || c.placeholderData,
      gridPosition: c.gridPosition,
    })),
  });

  let prompt = `You are populating a screenshot analysis hub. A fast classifier identified the content and chose a layout with skeleton cards. YOUR JOB: populate each card with REAL DATA from the screenshot, making the hub informative, visual, and concise.

**You have web search access.** Use it to validate claims from the screenshot — especially check the source domains visible in the screenshot (e.g., if you see a BBC article, search BBC.com). This makes the results trustworthy.

**The user already sees these cards as loading skeletons. Populate them in order of importance — each call you make instantly appears on screen.**

**Current state:**
${currentState}

**Card schemas:**
${getCardTypeSchemaForTypes(relevantTypes)}
${otherTypes.length > 0 ? `\nOther card types you may add: ${otherTypes.join(', ')}` : ''}

**Layout:** ${layout.type}${layoutDef ? ` — ${layoutDef.description}` : ''}

**YOUR TASKS (PRIORITY ORDER):**
1. POPULATE HERO: Update hero_summary with a proper takeaway and ensure title is under 6 words. Add badge and badgeColor. Keep investigationStatus as "investigating" — it will be resolved when all research completes.
2. POPULATE EACH CARD: For every skeleton card, call update_card with its required + optional fields. Extract data from the screenshot.
3. WEB VALIDATE: Search the web to validate key claims from the screenshot. Check the source domain(s) visible in the screenshot. If you see a news article from "BBC" or "Al Jazeera", search that domain specifically. Add real source URLs you find to cards.
4. VERIFICATION: If there's a verification_card, populate the claim and source NAMES. If you've already searched the web, set source statuses based on what you found ("confirmed"/"denied"/"checking"). Otherwise set to "checking".
5. ADD CONTEXT: Fill optional fields like emoji, context, notableInfo, details on every card.
6. ADD MISSING CARDS: If important information is visible but no card exists for it, use add_card. Always add did_you_know_card.

**DO NOT generate imageUrl or photoUrl from memory** — only use image URLs you find via web search results. If you don't find a relevant image, leave imageUrl empty.

**CRITICAL RULES:**
- POPULATE ALL CARDS — skeleton cards with no data look broken to the user
- Keep ALL text ultra-concise — no paragraphs. Titles: max 6 words. Values: max 10 words.
- For person_card: ALWAYS include name, role, and context even if sparse
- For location_card: ALWAYS include name, context, and a Google Maps URL in mapUrl
- Use web search to find REAL URLs for url fields — don't fabricate URLs
- Use emoji liberally for visual interest
- Total cards 4-7 — quality over quantity
- For product_card: features/warnings must be plain strings
- IMPORTANT: Call MULTIPLE tools in a SINGLE response — populate 3-5 cards at once, not one at a time

**Breaking news rules:**
- NEVER label news as "MISLEADING"/"MISINFORMATION" in hero_summary
- Present breaking news neutrally with short factual titles
- ALWAYS use verification_card (not fact_check) for breaking news`;

  if (researchData) {
    const compactResearch = {
      findings: (researchData.findings || []).slice(0, 8).map(f => ({
        topic: truncateStr(f.topic, 80),
        summary: truncateStr(f.summary, 200),
        confidence: f.confidence,
        sourceUrls: (f.sourceUrls || []).slice(0, 2),
        factCheck: f.factCheck ? {
          claim: truncateStr(f.factCheck.claim, 100),
          verdict: f.factCheck.verdict,
          explanation: truncateStr(f.factCheck.explanation, 150),
        } : undefined,
      })),
      overallContext: truncateStr(researchData.overallContext, 300),
    };
    prompt += `\n\n**Web research findings (REVIEW PASS — incorporate these into cards):**
${JSON.stringify(compactResearch)}

REVIEW PRIORITIES (act on ALL in a SINGLE batch of tool calls):
1. UPDATE verification_card sources with actual findings — #1 priority
2. Add source URLs and citations to relevant cards
3. Verify or correct facts using research data
4. Enrich cards with web data (dates, stats, context)
5. If research shows initial analysis was wrong, correct it
6. Call ALL update_card tools in ONE response — do NOT make one call at a time`;
  }

  return prompt;
}

function buildReviewPrompt(currentCards, contentAnalysis, researchData) {
  const researchFindings = (researchData && researchData.findings) || [];

  const unpopulatedCards = currentCards.filter(c => {
    const data = c.populatedData || c.data || {};
    return !data || Object.keys(data).length === 0;
  });

  const relevantCards = currentCards.filter(c => {
    if (c.cardType === 'verification_card') return true;
    const data = c.populatedData || c.data || {};
    if (!data || Object.keys(data).length === 0) return true;
    const cardText = `${data.title || ''} ${data.name || ''} ${data.claim || ''} ${data.label || ''}`.toLowerCase();
    return researchFindings.some(f => {
      const fText = `${f.topic || ''} ${f.summary || ''}`.toLowerCase();
      return fText.split(/\s+/).some(w => w.length > 3 && cardText.includes(w));
    });
  });

  const cardsToReview = relevantCards.length > 0 ? relevantCards : currentCards;
  const existingTypes = [...new Set(cardsToReview.map(c => c.cardType))];

  const compactCards = cardsToReview.map(c => {
    const data = c.populatedData || c.data || c.placeholderData || {};
    const isPopulated = data && Object.keys(data).length > 0;
    const summary = { id: c.id, cardType: c.cardType };
    if (!isPopulated) summary.NEEDS_POPULATION = true;
    if (data.title) summary.title = data.title;
    if (data.name) summary.name = data.name;
    if (data.claim) summary.claim = data.claim;
    if (data.sources) summary.sources = data.sources;
    if (data.status) summary.status = data.status;
    return summary;
  });

  const compactResearch = researchFindings.slice(0, 8).map(f => ({
    topic: truncateStr(f.topic, 80),
    summary: truncateStr(f.summary, 200),
    confidence: f.confidence,
    sourceUrls: (f.sourceUrls || []).slice(0, 2),
    factCheck: f.factCheck ? {
      claim: truncateStr(f.factCheck.claim, 100),
      verdict: f.factCheck.verdict,
      explanation: truncateStr(f.factCheck.explanation, 150),
    } : undefined,
  }));

  const hasUnpopulated = unpopulatedCards.length > 0;
  const populateInstructions = hasUnpopulated
    ? `\n0. **FIRST PRIORITY**: Cards marked NEEDS_POPULATION are EMPTY — the user sees a broken loading skeleton. You MUST call update_card for each with ALL required fields filled. Use content analysis + research to populate them.`
    : '';

  const contextLine = contentAnalysis
    ? `\nContent: ${contentAnalysis.contentType} — ${contentAnalysis.intent || ''}`
    : '';

  return `Review cards against research. Update with corrections, URLs, verified data. Call ALL update_card tools in ONE response.

Cards: ${JSON.stringify(compactCards)}

Schemas: ${getCardTypeSchemaForTypes(existingTypes)}
${researchFindings.length > 0 ? `\nResearch: ${JSON.stringify(compactResearch)}` : ''}
${researchData && researchData.overallContext ? `Context: ${truncateStr(researchData.overallContext, 300)}` : ''}${contextLine}

Tasks (ALL in ONE batch):${populateInstructions}
1. verification_card: update source statuses ONLY based on research evidence — set "confirmed" if research supports, "denied" if contradicts, "not_yet_reported" if no evidence
2. Add sourceUrls to cards with matching research
3. Correct facts research contradicts
4. Enrich with dates/stats/context
Rules: ultra-concise text, batch ALL tools in ONE response, skip accurate cards, NEVER guess verification statuses without research evidence`;
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
  const isReview = !!researchData;
  const config = {
    ...adapterConfig,
    model: adapterConfig.model || 'claude-haiku-4-5-20251001',
    maxTokens: 8192,
  };

    const adapter = getVisionAdapter(config);
    const traceCollector = adapterConfig.traceCollector;
    const prompt = isReview
      ? buildReviewPrompt(currentCards, contentAnalysis, researchData)
      : buildEnhancerPrompt(currentCards, contentAnalysis, layout, researchData);
    const phase = researchData ? 'review' : 'enhance';

    logger.info('SonnetEnhancer', `Starting ${phase} pass`, {
      configModel: config.model,
      adapterModel: adapter.model,
      cardCount: currentCards.length,
      hasResearch: !!researchData,
      maxIterations: adapterConfig.maxIterations || 8,
      promptLen: prompt.length,
    });

    const actions = [];
    let nextCardId = currentCards.length + 1;

    function processToolBlock(block) {
      if (block.type !== 'tool_use') return;
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

    try {
      const useLoop = typeof adapter.analyzeImageWithToolLoop === 'function';
      const useTextLoop = isReview && typeof adapter.textWithToolLoop === 'function';
      const maxIterations = adapterConfig.maxIterations || 8;
      const useWebSearch = adapterConfig.enableWebSearch && !isReview;
      const tools = useWebSearch ? [WEB_SEARCH_TOOL, ...ENHANCER_TOOLS] : ENHANCER_TOOLS;
      let response;

      if (useWebSearch) {
        logger.info('SonnetEnhancer', 'Web search enabled for enhance pass', { maxSearches: WEB_SEARCH_TOOL.max_uses });
      }

      if (useTextLoop) {
        response = await adapter.textWithToolLoop({
          prompt,
          tools,
          maxTokens: config.maxTokens,
          onToolUse: processToolBlock,
          maxIterations,
        });
      } else if (useLoop) {
        response = await adapter.analyzeImageWithToolLoop({
          imageData,
          mediaType,
          prompt,
          tools,
          maxTokens: config.maxTokens,
          onToolUse: processToolBlock,
          maxIterations,
        });
      } else {
        response = await adapter.analyzeImageWithTools({
          imageData,
          mediaType,
          prompt,
          tools,
          maxTokens: config.maxTokens,
        });
        for (const block of response.content) {
          processToolBlock(block);
        }
      }

    const duration = Date.now() - startTime;

    const webSearchResults = (response.content || []).filter(b => b.type === 'web_search_tool_result');
    logger.info('SonnetEnhancer', `${phase} pass complete`, {
      dur: duration,
      model: response.model,
      actions: actions.length,
      updates: actions.filter(a => a.type === 'update_card').length,
      adds: actions.filter(a => a.type === 'add_card').length,
      layoutChanges: actions.filter(a => a.type === 'update_layout').length,
      webSearches: webSearchResults.length,
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

module.exports = { enhance, ENHANCER_TOOLS, WEB_SEARCH_TOOL };
