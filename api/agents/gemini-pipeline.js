/**
 * Gemini Single-Call Pipeline
 *
 * Replaces the multi-phase pipeline (classify → enhance → research → merge)
 * with a single Gemini 2.5 Flash call using Google Search grounding.
 *
 * In one API call, Gemini:
 *   1. Sees the screenshot (vision)
 *   2. Classifies content type and picks a layout
 *   3. Searches the web for verification and context (grounding)
 *   4. Returns structured card data ready for the frontend
 *
 * Enable via PIPELINE_MODE=gemini env var (makes it the default pipeline).
 */

const { getAdapter } = require('../llm');
const { LAYOUT_TYPES } = require('../contracts/card-types');
const { logger } = require('../lib/logger');
const { TraceCollector } = require('../lib/llm-trace');

function currentDateAnchors() {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = now.getUTCFullYear();
  const isoDate = now.toISOString().slice(0, 10);
  return { month, year, isoDate };
}

function buildAnalysisPrompt() {
  const { month, year, isoDate } = currentDateAnchors();

  return `You are an expert screenshot intelligence analyst with Google Search access. Today is ${isoDate} (${month} ${year}).

Analyze this screenshot completely: identify what it shows, verify claims via web search, and return structured card data.

Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:

{
  "contentType": "breaking_news|news|social_media|product|food_delivery|messaging|settings|photo|dashboard|travel|sports|entertainment|other",
  "platform": "Facebook|X|Instagram|WhatsApp|Telegram|TikTok|Reddit|YouTube|other|null",
  "layoutType": "breaking_news|editorial|social_feed|simple|food_order|messaging|location_explorer|media_analysis|product_showcase|dashboard|encyclopedia|travel_planner",
  "cards": [
    {
      "cardType": "hero_summary",
      "data": {
        "title": "3-8 word headline",
        "subtitle": "One sentence context",
        "emoji": "single emoji",
        "badge": "Category label (e.g. Breaking News, Sports, Product)",
        "badgeColor": "#hex color for badge",
        "investigationStatus": "confirmed|unconfirmed|mixed",
        "takeaway": "Key insight in 1 sentence"
      }
    },
    ... more cards as appropriate
  ]
}

CARD TYPES YOU CAN USE (pick 5-8 appropriate ones):

hero_summary (ALWAYS first): title, subtitle, emoji, badge, badgeColor, investigationStatus [confirmed|unconfirmed|mixed], takeaway, url

verification_card (for news/claims): claim, status [verified|partially_verified|unconfirmed|denied|inconclusive|conflicting], sources (array of {name, status [confirmed|denied|inconclusive|not_yet_reported], snippet, url}), summary, lastChecked

source_card: name, type [news_agency|official|social_media|blog], credibility [high|medium|low|unknown], context, profileUrl

person_card (named individuals ONLY): name, role, emoji, context, notableInfo, details (array of strings)

location_card: name, emoji, context, details (array of strings), mapUrl

timeline_card: title, events (array of {date, event, highlight (bool)})

news_card: headline, source, date, summary, category, url, relatedContext

did_you_know_card: fact, emoji, category, sourceUrl

link_card: title, links (array of {label, url, description})

key_metric: value, label, emoji, trend [up|down|stable|none], context

info_list: title, items (array of {emoji, label, value, highlight})

fact_check: claim, verdict [verified|misleading|unverified|false|partially_true|needs_context], confidence [high|medium|low], explanation, sourceUrl

warning_card: level [critical|warning|info], title, details, advice

action_card: title, actions (array of {label, description, url, priority})

chat_card (for messaging screenshots): title, messages (array of {sender, text, time, isUser, translation})

order_card (for delivery/orders): title, items (array of {name, quantity, price}), total, status, emoji, deliveryTime

LAYOUT GUIDE:
- breaking_news: unverified claims, developing stories, crisis, military events
- editorial: verified news articles, blog posts, reports
- social_feed: tweets, facebook/instagram posts, social content
- simple: settings, menus, general screenshots
- food_order: delivery apps, restaurant orders, receipts
- messaging: WhatsApp, Telegram, SMS, chat conversations
- product_showcase: shopping, product pages, reviews
- dashboard: analytics, financial data, statistics

CRITICAL RULES:
1. Use Google Search for EVERY claim. Include real URLs from ${month} ${year} search results.
2. verification_card: search Reuters, AP, BBC, CNN, Al Jazeera. Report what each found. Include URLs.
3. timeline_card: use SPECIFIC dates from search results, not vague "Recently" or "Ongoing".
4. did_you_know_card: genuinely surprising fact the user wouldn't know. NOT a restatement of the headline.
5. If non-English screenshot: translate everything to English.
6. person_card: ONLY for named individual humans. Never for organizations or generic titles.
7. Return 5-8 cards total. hero_summary is always first.
8. For breaking news: a claim being unverified ≠ false. Only mark false with strong evidence.
9. NEVER fabricate URLs. Only include URLs actually found via search.`;
}

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
        placeholderData: { title: 'Analyzing screenshot...', subtitle: 'Searching and verifying...' },
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

function parseGeminiResponse(text) {
  if (!text) return null;
  try {
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) return null;
    return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    logger.warn('GeminiPipeline', 'JSON parse failed', { err: e.message });
    return null;
  }
}

function toBlueprintAndCards(analysis) {
  const layoutType = analysis.layoutType || 'simple';
  const layoutDef = LAYOUT_TYPES[layoutType] || LAYOUT_TYPES.simple;
  const columns = layoutDef.columns || 1;

  const cards = (analysis.cards || []).map((card, i) => {
    const isWide = ['hero_summary', 'verification_card', 'comparison_card', 'map_card', 'stats_grid_card', 'gallery_card', 'chat_card'].includes(card.cardType);
    const data = card.data || {};
    if (card.cardType === 'verification_card' && !data.lastChecked) {
      data.lastChecked = new Date().toISOString();
    }
    return {
      id: `card-${i + 1}`,
      cardType: card.cardType,
      gridPosition: {
        row: Math.floor(i / columns) + 1,
        column: (i % columns) + 1,
        columnSpan: isWide ? Math.min(2, columns) : 1,
        rowSpan: 1,
      },
      populatedData: data,
      data,
      status: 'populated',
    };
  });

  return {
    contentAnalysis: {
      contentType: analysis.contentType || 'general',
      platform: analysis.platform || null,
      intent: cards[0]?.data?.subtitle || 'Analysis complete',
      topQuestions: [],
    },
    layout: {
      type: layoutType,
      columns,
      reason: `${layoutType} layout selected by Gemini analysis`,
    },
    cards,
  };
}

/**
 * Run the Gemini single-call pipeline.
 * Same callback contract as orchestrator-v2 and orchestrator-v2-0.
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
  const traceCollector = new TraceCollector(adapterConfig.requestId || 'unknown');

  try {
    const skeleton = createSkeletonBlueprint();
    if (onBlueprint) onBlueprint(skeleton);

    if (onProgress) {
      onProgress({ phase: 'analyzing', progress: 5, message: 'Analyzing screenshot...' });
    }

    if (onPhase) {
      onPhase({ phase: 'analyzing', message: 'Analyzing with web search...' });
    }

    const model = process.env.GEMINI_ANALYSIS_MODEL || 'gemini-2.5-flash';

    logger.info('GeminiPipeline', 'Single-call analysis + web search', { model });

    const adapter = getAdapter('gemini', { model, maxTokens: 8192 });

    let prompt = buildAnalysisPrompt();
    if (question) {
      prompt += `\n\nUser question: "${question}"`;
    }

    const progressMessages = [
      'Reading screenshot...',
      'Searching news sources...',
      'Verifying claims...',
      'Cross-referencing sources...',
      'Building timeline...',
      'Analyzing context...',
      'Checking multiple outlets...',
      'Compiling verified findings...',
      'Almost there...',
    ];
    let msgIdx = 0;
    const heartbeat = setInterval(() => {
      if (onProgress) {
        msgIdx = Math.min(msgIdx + 1, progressMessages.length - 1);
        onProgress({
          phase: 'analyzing',
          progress: Math.min(10 + msgIdx * 10, 90),
          message: progressMessages[msgIdx],
        });
      }
    }, 3000);

    const result = await adapter.analyzeImageWithGrounding({
      imageData,
      mediaType,
      prompt,
      maxTokens: 8192,
    });

    clearInterval(heartbeat);

    const geminiDuration = Date.now() - startTime;

    traceCollector.record({
      phase: 'gemini_analyze',
      agent: 'GeminiPipeline',
      model: result.model || model,
      duration: geminiDuration,
      request: {
        userPrompt: prompt.slice(0, 500),
        hasImage: true,
        imageMediaType: mediaType,
        webSearchEnabled: true,
      },
      response: {
        text: result.text,
        usage: result.usage,
        citations: result.citations,
      },
    });

    const analysis = parseGeminiResponse(result.text);

    if (!analysis || !analysis.cards || analysis.cards.length === 0) {
      const err = new Error('Gemini analysis returned no usable data — please retry');
      err.code = 'GEMINI_EMPTY';
      logger.error('GeminiPipeline', 'Analysis returned empty', {
        dur: geminiDuration,
        textLen: result.text?.length,
      });
      if (onError) { onError(err); return null; }
      throw err;
    }

    const blueprint = toBlueprintAndCards(analysis);

    logger.info('GeminiPipeline', 'Analysis complete', {
      dur: geminiDuration,
      model: result.model,
      contentType: blueprint.contentAnalysis?.contentType,
      layoutType: blueprint.layout?.type,
      cardCount: blueprint.cards?.length,
      groundingSources: result.groundingMetadata?.groundingChunks?.length || 0,
    });

    if (onLayoutUpdate) onLayoutUpdate(blueprint);

    if (onProgress) {
      onProgress({ phase: 'populating', progress: 85, message: 'Rendering cards...' });
    }

    // Emit each card as populated
    for (let i = 0; i < blueprint.cards.length; i++) {
      const card = blueprint.cards[i];
      if (onCardPopulated) {
        onCardPopulated({
          cardId: card.id,
          cardType: card.cardType,
          data: card.populatedData || card.data,
          completedCount: i + 1,
          totalCount: blueprint.cards.length,
        });
      }
    }

    const totalDuration = Date.now() - startTime;

    const populatedLayout = {
      ...blueprint,
      _meta: {
        totalDuration,
        pipeline: 'gemini',
        model: result.model || model,
        groundingSources: result.groundingMetadata?.groundingChunks?.length || 0,
        citations: result.citations?.length || 0,
        geminiDuration,
        designDuration: geminiDuration,
      },
      _llmTraces: traceCollector.getTraces(),
      _llmTraceSummary: traceCollector.getSummary(),
    };

    if (onProgress) {
      onProgress({ phase: 'complete', progress: 100, message: 'All cards populated' });
    }

    if (onComplete) onComplete(populatedLayout);

    return populatedLayout;
  } catch (error) {
    logger.error('GeminiPipeline', 'Pipeline error', {
      err: error.message,
      dur: Date.now() - startTime,
    });
    if (onError) { onError(error); } else { throw error; }
  }
}

module.exports = { runGeminiPipeline };
