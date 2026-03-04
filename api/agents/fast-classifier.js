/**
 * Fast Classifier Agent (v2 — Title + Layout Only)
 *
 * Uses Haiku to quickly:
 * 1. Identify content type from screenshot
 * 2. Pick the best layout
 * 3. Generate a short title + subtitle
 *
 * Target: classification in 1-2 seconds.
 * Does NOT populate cards — Sonnet does that progressively.
 *
 * After classification, buildSkeletonFromClassification() creates
 * a layout blueprint with skeleton cards based on the layout's
 * suggestedCards, plus a hero card pre-populated with the title.
 */

const { getVisionAdapter } = require('../llm');
const { LAYOUT_TYPES, getLayoutTypesSummaryForPrompt } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

const FAST_CLASSIFY_PROMPT = `Look at this screenshot. Classify it and return ONLY this JSON:
{
  "contentType": "breaking_news|news|social_media|product|food_delivery|messaging|settings|photo|dashboard|travel|emergency|tech|sports|entertainment|other",
  "platform": "Facebook|X|Instagram|WhatsApp|Telegram|TikTok|Reddit|YouTube|UberEats|Google|Apple|null",
  "title": "3-6 word headline",
  "subtitle": "one sentence summary",
  "emoji": "single emoji",
  "layoutType": "breaking_news|editorial|social_feed|simple|food_order|messaging|location_explorer|media_analysis|product_showcase|dashboard|encyclopedia|travel_planner"
}

LAYOUT GUIDE:
- breaking_news: unverified claims, developing stories, crisis events
- editorial: verified news articles, blog posts, reports
- social_feed: tweets, facebook/instagram posts, social media content
- simple: settings, menus, general screenshots
- food_order: delivery apps, restaurant orders, receipts
- messaging: WhatsApp, Telegram, SMS, chat conversations
- location_explorer: places, restaurants, hotels, maps
- media_analysis: photos, art, memes, infographics
- product_showcase: shopping, product pages, reviews
- dashboard: analytics, financial data, statistics
- encyclopedia: famous people, historical events, educational topics
- travel_planner: itineraries, flights, hotel bookings

RULES:
- title: SHORT headline, max 6 words. Not a sentence.
- subtitle: ONE sentence explaining what the screenshot shows
- If non-English: translate title and subtitle to English
- Return ONLY valid JSON, nothing else`;

/**
 * Fast classify a screenshot — returns title + layout choice only.
 * Target: 1-2 seconds with Haiku.
 */
async function fastClassify({ imageData, mediaType, question, adapterConfig = {} }) {
  const startTime = Date.now();

  const config = {
    ...adapterConfig,
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 512, // Much smaller — just need a few fields
  };

  const adapter = getVisionAdapter(config);
  const traceCollector = adapterConfig.traceCollector;

  let prompt = FAST_CLASSIFY_PROMPT;
  if (question) {
    prompt += `\n\nUser asks: "${question}"`;
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

    const classification = parseClassification(result.text);
    if (!classification) return null;

    // Build a full blueprint from the classification
    return buildSkeletonFromClassification(classification);
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

/**
 * Parse the classification JSON from Haiku's response
 */
function parseClassification(text) {
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
    logger.warn('FastClassifier', 'Failed to parse classification', { err: e.message });
    return null;
  }
}

/**
 * Build a full layout blueprint from a classification result.
 * No LLM needed — uses the layout's suggestedCards to create skeleton cards.
 * Hero card is pre-populated with the title from classification.
 */
function buildSkeletonFromClassification(classification) {
  const layoutType = classification.layoutType || 'simple';
  const layoutDef = LAYOUT_TYPES[layoutType] || LAYOUT_TYPES.simple;
  const suggestedCards = layoutDef.suggestedCards || ['hero_summary', 'info_list', 'action_card'];
  const columns = layoutDef.columns || 1;

  // Normalize content type
  const contentType = classification.contentType || 'general';
  const title = classification.title || 'Analyzing...';
  const subtitle = classification.subtitle || 'Processing screenshot...';
  const emoji = classification.emoji || '🔍';
  const platform = classification.platform || null;

  // Build cards from suggestedCards
  const cards = suggestedCards.map((cardType, i) => {
    const isHero = cardType === 'hero_summary';
    const isWide = ['hero_summary', 'verification_card', 'comparison_card', 'map_card', 'stats_grid_card', 'gallery_card', 'chat_card'].includes(cardType);

    const card = {
      id: `card-${i + 1}`,
      cardType,
      gridPosition: {
        row: Math.floor(i / columns) + 1,
        column: (i % columns) + 1,
        columnSpan: isWide ? Math.min(2, columns) : 1,
        rowSpan: 1,
      },
      researchBrief: `Populate this ${cardType} with relevant data from the screenshot`,
      populatedData: {},
      placeholderData: {},
      status: 'placeholder',
    };

    if (isHero) {
      card.populatedData = {
        title,
        subtitle,
        emoji,
        badge: humanizeContentType(contentType),
        investigationStatus: 'investigating',
      };
      card.placeholderData = card.populatedData;
      card.status = 'populated';
    }

    return card;
  });

  return {
    contentAnalysis: {
      contentType,
      platform,
      intent: subtitle,
      topQuestions: [],
      followUpQuestions: [],
    },
    layout: {
      type: layoutType,
      columns,
      reason: `${layoutType} layout for ${contentType} content`,
    },
    cards,
  };
}

/**
 * Human-readable content type label
 */
function humanizeContentType(ct) {
  const labels = {
    breaking_news: 'Breaking News',
    news: 'News',
    social_media: 'Social Media',
    product: 'Product',
    food_delivery: 'Food Delivery',
    messaging: 'Messaging',
    settings: 'Settings',
    photo: 'Photo',
    dashboard: 'Dashboard',
    travel: 'Travel',
    emergency: 'Emergency',
    tech: 'Tech',
    sports: 'Sports',
    entertainment: 'Entertainment',
    other: 'Screenshot',
    general: 'Screenshot',
  };
  return labels[ct] || ct.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { fastClassify, buildSkeletonFromClassification, humanizeContentType };
