/**
 * Gemini Analyzer — Single-Call Screenshot Analysis
 *
 * Replaces the multi-phase pipeline (classify → enhance → research → merge)
 * with a single Gemini 2.5 Flash call that uses Google Search grounding.
 *
 * In one API call, Gemini:
 *   1. Sees the screenshot (vision)
 *   2. Classifies content type and picks a layout
 *   3. Searches the web for verification and context (grounding)
 *   4. Returns structured card data ready for the frontend
 *
 * Enable via PIPELINE_MODE=gemini env var.
 */

const { getAdapter, isGeminiAvailable } = require('../llm');
const { LAYOUT_TYPES } = require('../contracts/card-types');
const { logger } = require('../lib/logger');

function currentDateAnchors() {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = now.getUTCFullYear();
  const isoDate = now.toISOString().slice(0, 10);
  return { month, year, isoDate };
}

const GEMINI_ANALYSIS_PROMPT = `You are an expert screenshot intelligence analyst with Google Search access. Today is {isoDate} ({month} {year}).

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
    {
      "cardType": "verification_card",
      "data": {
        "claim": "The main factual claim (1 neutral sentence)",
        "status": "verified|partially_verified|unconfirmed|denied|inconclusive|conflicting",
        "sources": [
          {"name": "Source Name", "status": "confirmed|denied|inconclusive|not_yet_reported", "snippet": "What this source says (1 sentence)", "url": "actual URL from search"}
        ],
        "summary": "Verification assessment paragraph — what search results show",
        "lastChecked": "{isoDate}"
      }
    },
    ... more cards as appropriate for the content
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

chart_card: title, chartType [bar|pie|progress|comparison], data (array of {label, value, color}), unit, insight

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
1. Use Google Search for EVERY claim. Include real URLs from {month} {year} search results.
2. verification_card: search Reuters, AP, BBC, CNN, Al Jazeera. Report what each found. Include URLs.
3. timeline_card: use SPECIFIC dates from search results, not vague "Recently" or "Ongoing".
4. did_you_know_card: genuinely surprising fact the user wouldn't know. NOT a restatement of the headline.
5. If non-English screenshot: translate everything to English.
6. person_card: ONLY for named individual humans. Never for organizations or generic titles.
7. Return 5-8 cards total. hero_summary is always first.
8. For breaking news: a claim being unverified ≠ false. Only mark false with strong evidence.
9. NEVER fabricate URLs. Only include URLs actually found via search.`;

/**
 * Run single-call Gemini analysis on a screenshot.
 * Returns card data structured for the frontend.
 */
async function geminiAnalyze({
  imageData,
  mediaType,
  question,
  adapterConfig = {},
}) {
  const startTime = Date.now();
  const traceCollector = adapterConfig.traceCollector;
  const { month, year, isoDate } = currentDateAnchors();

  const model = process.env.GEMINI_ANALYSIS_MODEL || 'gemini-2.5-flash';

  logger.info('GeminiAnalyzer', 'Starting single-call analysis', { model });

  const adapter = getAdapter('gemini', {
    ...adapterConfig,
    model,
  });

  let prompt = GEMINI_ANALYSIS_PROMPT
    .replace(/\{isoDate\}/g, isoDate)
    .replace(/\{month\}/g, month)
    .replace(/\{year\}/g, String(year));

  if (question) {
    prompt += `\n\nUser question: "${question}"`;
  }

  try {
    const result = await adapter.analyzeImageWithGrounding({
      imageData,
      mediaType,
      prompt,
      maxTokens: 8192,
    });

    const duration = Date.now() - startTime;
    const parsed = parseGeminiResponse(result.text);

    if (!parsed) {
      logger.warn('GeminiAnalyzer', 'Failed to parse response', {
        dur: duration,
        textLen: result.text?.length,
      });
      return null;
    }

    logger.info('GeminiAnalyzer', 'Analysis complete', {
      dur: duration,
      model: result.model,
      contentType: parsed.contentType,
      layoutType: parsed.layoutType,
      cardCount: parsed.cards?.length,
      groundingSources: result.groundingMetadata?.groundingChunks?.length || 0,
      citations: result.citations?.length || 0,
    });

    if (traceCollector) {
      traceCollector.record({
        phase: 'gemini_analyze',
        agent: 'GeminiAnalyzer',
        model: result.model || model,
        duration,
        request: {
          userPrompt: prompt.slice(0, 500),
          hasImage: true,
          imageMediaType: mediaType,
          webSearchEnabled: true,
        },
        response: {
          text: result.text,
          structured: parsed,
          usage: result.usage,
          citations: result.citations,
        },
      });
    }

    return {
      analysis: parsed,
      citations: result.citations || [],
      groundingSources: result.groundingMetadata?.groundingChunks?.length || 0,
      duration,
      model: result.model || model,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('GeminiAnalyzer', 'Analysis failed', {
      err: error.message,
      dur: duration,
    });

    if (traceCollector) {
      traceCollector.record({
        phase: 'gemini_analyze',
        agent: 'GeminiAnalyzer',
        model,
        duration,
        request: { userPrompt: prompt.slice(0, 500), hasImage: true },
        response: {},
        error: error.message,
      });
    }

    return null;
  }
}

function parseGeminiResponse(text) {
  if (!text) return null;

  try {
    const clean = text
      .replace(/^```json\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) return null;

    return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    logger.warn('GeminiAnalyzer', 'JSON parse failed', { err: e.message });
    return null;
  }
}

/**
 * Convert Gemini analysis output into a pipeline-compatible blueprint + cards.
 * Maps Gemini's flat card array into the orchestrator's data structure.
 */
function toBlueprintAndCards(analysis) {
  const layoutType = analysis.layoutType || 'simple';
  const layoutDef = LAYOUT_TYPES[layoutType] || LAYOUT_TYPES.simple;

  const contentType = analysis.contentType || 'general';
  const platform = analysis.platform || null;

  const heroCard = analysis.cards?.find(c => c.cardType === 'hero_summary');
  const intent = heroCard?.data?.subtitle || 'Analysis complete';

  const cards = (analysis.cards || []).map((card, i) => {
    const isWide = ['hero_summary', 'verification_card', 'comparison_card', 'map_card', 'stats_grid_card', 'gallery_card', 'chat_card'].includes(card.cardType);
    const columns = layoutDef.columns || 1;

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

  const blueprint = {
    contentAnalysis: {
      contentType,
      platform,
      intent,
      topQuestions: [],
    },
    layout: {
      type: layoutType,
      columns: layoutDef.columns || 1,
      reason: `${layoutType} layout selected by Gemini analysis`,
    },
    cards,
  };

  return blueprint;
}

module.exports = { geminiAnalyze, toBlueprintAndCards, isGeminiAvailable };
