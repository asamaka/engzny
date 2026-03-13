/**
 * Gemini Flash Sequential Pipeline
 *
 * A simpler alternative to the multi-agent orchestrator that sends
 * the screenshot image to Gemini 2.5 Flash for every step, sequentially.
 *
 * Flow:
 *   1. Classify — Gemini Flash sees the screenshot, returns content type +
 *      layout + card list with hero data. (~1-3s)
 *   2. Populate — For each non-hero card, Gemini Flash sees the screenshot
 *      again and populates that card's fields. Cards fire one at a time
 *      via SSE as each completes. (~2-4s per card, sequential)
 *
 * The screenshot is sent with EVERY call so Gemini can always reference
 * the original image when extracting data.
 */

const { getAdapter } = require('../llm');
const {
  getCardTypeSummaryForPrompt,
  getLayoutTypesSummaryForPrompt,
  getCardSchema,
  getCardTypeSchemaForTypes,
  LAYOUT_TYPES,
} = require('../contracts/card-types');
const { logger } = require('../lib/logger');
const { TraceCollector } = require('../lib/llm-trace');

// ─── Classify Prompt ────────────────────────────────────────────────

const CLASSIFY_PROMPT = `Look at this screenshot carefully. You must:
1. Identify the content type
2. Choose the best layout
3. Generate a short title + subtitle
4. Design 4-7 cards that would best present this content

Available Layout Types:
${getLayoutTypesSummaryForPrompt()}

Available Card Types:
${getCardTypeSummaryForPrompt()}

Return ONLY valid JSON matching this structure:
{
  "contentAnalysis": {
    "contentType": "string (news/product/social_media/data/general/breaking_news/tech/sports/etc.)",
    "platform": "string or null",
    "intent": "string (what the user likely wants to understand)",
    "topQuestions": ["3-5 questions users would ask"]
  },
  "layout": {
    "type": "string (one of the layout types)",
    "columns": number,
    "reason": "string"
  },
  "cards": [
    {
      "id": "card-1",
      "cardType": "hero_summary",
      "gridPosition": { "row": 1, "column": 1, "columnSpan": 2, "rowSpan": 1 },
      "researchBrief": "string (what to extract for this card)",
      "placeholderData": { "title": "short headline", "subtitle": "one sentence", "emoji": "📰" }
    }
  ]
}

Rules:
- title: SHORT headline, max 6 words
- subtitle: ONE sentence
- First card MUST be hero_summary
- Choose 4-7 cards total
- For breaking news, include a verification_card
- Always include a did_you_know_card
- contentType must be a simple label, not a sentence`;

// ─── Card Population Prompt ─────────────────────────────────────────

function buildCardPrompt(card, contentAnalysis) {
  const schema = getCardSchema(card.cardType);
  if (!schema) return null;

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

  return `Look at this screenshot. You are populating a "${card.cardType}" card for a ${contentAnalysis.contentType} screenshot analysis.

Context: ${contentAnalysis.intent}
Research brief: ${card.researchBrief}

Fields for this card type:
${fieldDescriptions}

Rules:
1. Extract ONLY information visible in the screenshot — never fabricate
2. OMIT unknown fields rather than writing "Not visible" or "N/A"
3. Keep text SHORT — titles max 8 words, descriptions max 1-2 sentences
4. For product_card: features/warnings must be plain strings
5. Do NOT fabricate URLs — leave url/imageUrl/photoUrl fields empty
6. Use emoji where the schema supports it
7. Focus on information the user likely DIDN'T know

Return ONLY valid JSON with the card data fields:`;
}

// ─── JSON Parsing ───────────────────────────────────────────────────

function parseJSON(text) {
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }

    return JSON.parse(text.trim());
  } catch (e) {
    logger.warn('GeminiPipeline', 'Failed to parse JSON', { err: e.message });
    return null;
  }
}

// ─── Skeleton Blueprint (instant, no LLM) ───────────────────────────

function createSkeletonBlueprint() {
  return {
    contentAnalysis: {
      contentType: 'analyzing',
      platform: null,
      intent: 'Analyzing screenshot...',
      topQuestions: [],
    },
    layout: { type: 'simple', columns: 1, reason: 'Skeleton layout while analyzing' },
    cards: [
      {
        id: 'skeleton-hero',
        cardType: 'hero_summary',
        gridPosition: { row: 1, column: 1, columnSpan: 1, rowSpan: 1 },
        researchBrief: '',
        placeholderData: { title: 'Analyzing screenshot...', subtitle: 'Using Gemini Flash' },
        status: 'placeholder',
      },
      {
        id: 'skeleton-2',
        cardType: 'info_list',
        gridPosition: { row: 2, column: 1, columnSpan: 1, rowSpan: 1 },
        researchBrief: '',
        placeholderData: {},
        status: 'placeholder',
      },
      {
        id: 'skeleton-3',
        cardType: 'info_list',
        gridPosition: { row: 3, column: 1, columnSpan: 1, rowSpan: 1 },
        researchBrief: '',
        placeholderData: {},
        status: 'placeholder',
      },
    ],
  };
}

// ─── Normalize Blueprint ────────────────────────────────────────────

function normalizeBlueprint(raw) {
  const blueprint = {
    contentAnalysis: {
      contentType: raw.contentAnalysis?.contentType || 'general',
      platform: raw.contentAnalysis?.platform || null,
      intent: raw.contentAnalysis?.intent || 'Understand what is shown in this screenshot',
      topQuestions: Array.isArray(raw.contentAnalysis?.topQuestions)
        ? raw.contentAnalysis.topQuestions.slice(0, 5)
        : ['What is this?'],
    },
    layout: {
      type: raw.layout?.type || 'simple',
      columns: raw.layout?.columns || 1,
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
      researchBrief: card.researchBrief || 'Extract relevant information from the screenshot',
      placeholderData: card.placeholderData || {},
      status: 'placeholder',
    }));
  }

  if (blueprint.cards.length === 0 || blueprint.cards[0].cardType !== 'hero_summary') {
    blueprint.cards.unshift({
      id: 'card-hero',
      cardType: 'hero_summary',
      gridPosition: { row: 0, column: 1, columnSpan: blueprint.layout.columns, rowSpan: 1 },
      researchBrief: 'Provide a clear summary of the screenshot content',
      placeholderData: { title: 'Analyzing...', subtitle: 'Determining content type' },
      status: 'placeholder',
    });
  }

  return blueprint;
}

function stripFabricatedImageUrls(data) {
  if (!data || typeof data !== 'object') return data;
  const cleaned = { ...data };
  delete cleaned.imageUrl;
  delete cleaned.photoUrl;
  return cleaned;
}

// ─── Main Pipeline ──────────────────────────────────────────────────

/**
 * Run the Gemini Flash sequential pipeline.
 *
 * Callback contract (all optional, same as orchestrator-v2):
 *   onBlueprint(blueprint)       — Instant skeleton
 *   onLayoutUpdate(blueprint)    — Layout from Gemini classification
 *   onCardPopulated(cardUpdate)  — A card has been populated
 *   onCardUpdate(cardUpdate)     — A card was updated
 *   onPhase(phase)               — Phase transition
 *   onComplete(result)           — Pipeline finished
 *   onError(error)               — Pipeline error
 *   onProgress(progress)         — Progress updates
 */
async function runGeminiPipeline({
  imageData,
  mediaType,
  question,
  onBlueprint,
  onLayoutUpdate,
  onLayoutPreview,
  onCardPopulated,
  onCardUpdate,
  onCardAdd,
  onPhase,
  onComplete,
  onError,
  onProgress,
  adapterConfig = {},
}) {
  const startTime = Date.now();
  const traceCollector = new TraceCollector(
    adapterConfig.requestId || 'unknown'
  );

  try {
    // ─── Phase 0: Instant skeleton ──────────────────────────
    const skeleton = createSkeletonBlueprint();
    if (onBlueprint) onBlueprint(skeleton);

    if (onProgress) {
      onProgress({ phase: 'classifying', progress: 5, message: 'Analyzing screenshot with Gemini Flash...' });
    }

    // ─── Phase 1: Classify + Design Layout (Gemini Flash) ───
    if (onPhase) {
      onPhase({ phase: 'gemini-classify', message: 'Gemini Flash classification...' });
    }

    const gemini = getAdapter('gemini', {
      model: adapterConfig.geminiModel || 'gemini-2.5-flash',
      maxTokens: 4096,
    });

    logger.info('GeminiPipeline', 'Phase 1: Gemini Flash Classification', {
      model: gemini.model,
    });

    let classifyPrompt = CLASSIFY_PROMPT;
    if (question) {
      classifyPrompt += `\n\nUser's specific question: "${question}"\nMake sure at least one card directly addresses this question.`;
    }

    const classifyResult = await gemini.analyzeImage({
      imageData,
      mediaType,
      prompt: classifyPrompt,
      maxTokens: 4096,
    });

    const classifyDuration = Date.now() - startTime;

    traceCollector.record({
      phase: 'classify',
      agent: 'GeminiPipeline',
      model: classifyResult.model,
      duration: classifyDuration,
      request: {
        userPrompt: classifyPrompt,
        hasImage: true,
        imageMediaType: mediaType,
        maxTokens: 4096,
      },
      response: {
        text: classifyResult.text,
        usage: classifyResult.usage,
        stopReason: classifyResult.stopReason,
      },
    });

    const rawBlueprint = parseJSON(classifyResult.text);
    if (!rawBlueprint) {
      throw new Error('Gemini Flash classification returned unparseable response');
    }

    const blueprint = normalizeBlueprint(rawBlueprint);

    logger.info('GeminiPipeline', 'Classification complete', {
      dur: classifyDuration,
      contentType: blueprint.contentAnalysis.contentType,
      layoutType: blueprint.layout.type,
      cardCount: blueprint.cards.length,
    });

    // Send layout update — hero card gets placeholder data from classification
    const heroCard = blueprint.cards.find(c => c.cardType === 'hero_summary');
    if (heroCard && heroCard.placeholderData) {
      heroCard.populatedData = stripFabricatedImageUrls(heroCard.placeholderData);
      heroCard.data = heroCard.populatedData;
      heroCard.status = 'populated';
    }

    if (onLayoutUpdate) onLayoutUpdate(blueprint);

    if (onProgress) {
      onProgress({
        phase: 'populating',
        progress: 20,
        message: `${blueprint.contentAnalysis.contentType} detected — populating cards...`,
      });
    }

    // Emit hero card as populated
    if (heroCard && heroCard.populatedData && onCardPopulated) {
      onCardPopulated({
        cardId: heroCard.id,
        cardType: heroCard.cardType,
        data: heroCard.populatedData,
        completedCount: 1,
        totalCount: blueprint.cards.length,
      });
    }

    // ─── Phase 2: Populate each card sequentially ───────────
    if (onPhase) {
      onPhase({ phase: 'populating', message: 'Populating cards with Gemini Flash...' });
    }

    logger.info('GeminiPipeline', 'Phase 2: Sequential Card Population', {
      cardsToPopulate: blueprint.cards.filter(c => c.cardType !== 'hero_summary').length,
    });

    const currentCards = new Map();
    for (const card of blueprint.cards) {
      currentCards.set(card.id, card);
    }

    const nonHeroCards = blueprint.cards.filter(c => c.cardType !== 'hero_summary');
    let completedCount = 1; // hero already counted

    for (const card of nonHeroCards) {
      const cardStartTime = Date.now();

      const prompt = buildCardPrompt(card, blueprint.contentAnalysis);
      if (!prompt) {
        logger.warn('GeminiPipeline', `No schema for ${card.cardType}, skipping`, { cardId: card.id });
        completedCount++;
        continue;
      }

      try {
        logger.info('GeminiPipeline', `Populating ${card.id}`, {
          cardType: card.cardType,
        });

        const cardResult = await gemini.analyzeImage({
          imageData,
          mediaType,
          prompt,
          maxTokens: 2048,
        });

        const cardDuration = Date.now() - cardStartTime;

        traceCollector.record({
          phase: 'populate',
          agent: 'GeminiPipeline',
          model: cardResult.model,
          duration: cardDuration,
          request: {
            userPrompt: prompt,
            hasImage: true,
            imageMediaType: mediaType,
            maxTokens: 2048,
          },
          response: {
            text: cardResult.text,
            usage: cardResult.usage,
            stopReason: cardResult.stopReason,
          },
          cardId: card.id,
          cardType: card.cardType,
        });

        const cardData = parseJSON(cardResult.text);
        if (cardData) {
          const safeData = stripFabricatedImageUrls(cardData);
          card.populatedData = safeData;
          card.data = safeData;
          card.status = 'populated';
          currentCards.set(card.id, card);

          completedCount++;

          if (onCardPopulated) {
            onCardPopulated({
              cardId: card.id,
              cardType: card.cardType,
              data: safeData,
              completedCount,
              totalCount: blueprint.cards.length,
            });
          }

          logger.info('GeminiPipeline', `${card.id} populated`, {
            dur: cardDuration,
            cardType: card.cardType,
          });
        } else {
          logger.warn('GeminiPipeline', `${card.id} returned unparseable data`, {
            cardType: card.cardType,
          });
          completedCount++;
        }
      } catch (cardError) {
        const cardDuration = Date.now() - cardStartTime;
        logger.warn('GeminiPipeline', `${card.id} failed`, {
          err: cardError.message,
          dur: cardDuration,
        });

        traceCollector.record({
          phase: 'populate',
          agent: 'GeminiPipeline',
          model: gemini.model,
          duration: cardDuration,
          request: { userPrompt: prompt, hasImage: true, imageMediaType: mediaType },
          response: {},
          cardId: card.id,
          cardType: card.cardType,
          error: cardError.message,
        });

        completedCount++;
      }

      // Progress update after each card
      const progressPercent = 20 + Math.round((completedCount / blueprint.cards.length) * 75);
      if (onProgress) {
        onProgress({
          phase: 'populating',
          progress: Math.min(progressPercent, 95),
          message: `Populated ${completedCount}/${blueprint.cards.length} cards...`,
        });
      }
    }

    // ─── Final: Assemble result ─────────────────────────────
    const totalDuration = Date.now() - startTime;
    logger.info('GeminiPipeline', 'Pipeline complete', { dur: totalDuration });

    const finalCards = Array.from(currentCards.values()).map(card => ({
      ...card,
      status: 'populated',
      data: card.populatedData || card.data || card.placeholderData,
    }));

    const populatedCount = finalCards.filter(card => {
      const data = card.populatedData || card.data || {};
      if (!data || Object.keys(data).length === 0) return false;
      if (data.title === 'Analyzing screenshot...' && Object.keys(data).length <= 3) return false;
      return true;
    }).length;

    if (populatedCount === 0) {
      const degradedError = new Error(
        'Analysis could not be completed — Gemini Flash service is temporarily unavailable. Please try again.'
      );
      degradedError.code = 'ZERO_CARDS_POPULATED';
      logger.error('GeminiPipeline', 'Pipeline degraded — zero cards populated', { dur: totalDuration });
      if (onError) {
        onError(degradedError);
      } else {
        throw degradedError;
      }
      return null;
    }

    const populatedLayout = {
      ...blueprint,
      cards: finalCards,
      _meta: {
        totalDuration,
        classifyDuration,
        designDuration: classifyDuration,
        pipeline: 'gemini-sequential',
        model: gemini.model,
        cardsPopulated: populatedCount,
        cardsTotal: finalCards.length,
      },
      _llmTraces: traceCollector.getTraces(),
      _llmTraceSummary: traceCollector.getSummary(),
    };

    if (onProgress) {
      onProgress({ phase: 'complete', progress: 100, message: 'All cards populated' });
    }

    if (onComplete) {
      onComplete(populatedLayout);
    }

    return populatedLayout;
  } catch (error) {
    logger.error('GeminiPipeline', 'Pipeline error', {
      err: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join(' | '),
    });
    if (onError) {
      onError(error);
    } else {
      throw error;
    }
  }
}

module.exports = { runGeminiPipeline };
