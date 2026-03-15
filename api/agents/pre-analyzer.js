const { getVisionAdapter } = require('../llm');
const { logger } = require('../lib/logger');

const PRE_ANALYZER_PROMPT = `Look carefully at this screenshot and return ONLY valid JSON with a conservative pre-analysis.

Goals:
1. Detect the primary visible language
2. Extract the main visible claim or headline as literally as possible
3. Identify the visible source/account/outlet if present
4. Detect named people vs named organizations separately
5. Detect whether the screenshot appears to contain multiple distinct content items
6. Note any visible date/time context

Rules:
- Be literal and conservative. Do NOT paraphrase aggressively.
- If text is non-English, preserve the meaning of key terms exactly.
- A "named person" must be a specific individual human being, not a title or organization.
- A "content item" is a distinct story/post/banner/panel visible in the screenshot.
- If uncertain, use lower confidence and shorter notes.

Return exactly this shape:
{
  "language": "en|ar|he|es|fr|de|other",
  "visibleClaim": "string or null",
  "sourceAttribution": {
    "name": "string or null",
    "type": "news_outlet|social_account|government|organization|individual|unknown",
    "confidence": "high|medium|low"
  },
  "timeContext": {
    "mentionedDate": "string or null",
    "isCurrentEvent": true,
    "notes": "string or null"
  },
  "namedPeople": [
    { "name": "string", "confidence": "high|medium|low" }
  ],
  "namedOrganizations": [
    { "name": "string", "confidence": "high|medium|low" }
  ],
  "locationHints": ["string"],
  "contentItems": [
    {
      "kind": "post|article|news_banner|video|ad|commentary|other",
      "summary": "string",
      "prominence": "primary|secondary"
    }
  ]
}`;

function normalizeConfidence(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'low';
}

function normalizeSourceType(value) {
  return ['news_outlet', 'social_account', 'government', 'organization', 'individual', 'unknown'].includes(value)
    ? value
    : 'unknown';
}

function parsePreAnalysis(text) {
  if (!text) return null;
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }

    return JSON.parse(text.trim());
  } catch (error) {
    logger.warn('PreAnalyzer', 'Failed to parse pre-analysis response', { err: error.message });
    return null;
  }
}

function createFallbackPreAnalysis() {
  return {
    language: 'en',
    requiresTranslationVerification: false,
    visibleClaim: null,
    sourceAttribution: {
      name: null,
      type: 'unknown',
      confidence: 'low',
    },
    timeContext: {
      mentionedDate: null,
      isCurrentEvent: true,
      notes: null,
    },
    namedPeople: [],
    namedOrganizations: [],
    locationHints: [],
    contentItems: [],
  };
}

function normalizeNamedEntityArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') {
        return { name: item.trim(), confidence: 'low' };
      }
      if (typeof item === 'object' && typeof item.name === 'string') {
        return {
          name: item.name.trim(),
          confidence: normalizeConfidence(item.confidence),
        };
      }
      return null;
    })
    .filter((item) => item && item.name);
}

function normalizeContentItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const kind = typeof item.kind === 'string' ? item.kind : 'other';
      const summary = typeof item.summary === 'string' ? item.summary.trim() : null;
      const prominence = item.prominence === 'secondary' ? 'secondary' : 'primary';
      if (!summary) return null;
      return { kind, summary, prominence };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function normalizePreAnalysis(raw) {
  const fallback = createFallbackPreAnalysis();
  const language = typeof raw?.language === 'string' && raw.language.trim()
    ? raw.language.trim().toLowerCase()
    : fallback.language;

  const sourceAttribution = {
    name: typeof raw?.sourceAttribution?.name === 'string' && raw.sourceAttribution.name.trim()
      ? raw.sourceAttribution.name.trim()
      : null,
    type: normalizeSourceType(raw?.sourceAttribution?.type),
    confidence: normalizeConfidence(raw?.sourceAttribution?.confidence),
  };

  const namedPeople = normalizeNamedEntityArray(raw?.namedPeople);
  const namedOrganizations = normalizeNamedEntityArray(raw?.namedOrganizations);
  const contentItems = normalizeContentItems(raw?.contentItems);

  return {
    language,
    requiresTranslationVerification: language !== 'en',
    visibleClaim: typeof raw?.visibleClaim === 'string' && raw.visibleClaim.trim()
      ? raw.visibleClaim.trim()
      : null,
    sourceAttribution,
    timeContext: {
      mentionedDate: typeof raw?.timeContext?.mentionedDate === 'string' && raw.timeContext.mentionedDate.trim()
        ? raw.timeContext.mentionedDate.trim()
        : null,
      isCurrentEvent: raw?.timeContext?.isCurrentEvent !== false,
      notes: typeof raw?.timeContext?.notes === 'string' && raw.timeContext.notes.trim()
        ? raw.timeContext.notes.trim()
        : null,
    },
    namedPeople,
    namedOrganizations,
    locationHints: Array.isArray(raw?.locationHints)
      ? raw.locationHints.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, 5)
      : [],
    contentItems,
  };
}

async function preAnalyze({ imageData, mediaType, question, adapterConfig = {} }) {
  const startTime = Date.now();
  const traceCollector = adapterConfig.traceCollector;
  const config = {
    ...adapterConfig,
    model: adapterConfig.preAnalysisModel || 'claude-haiku-4-5-20251001',
    maxTokens: adapterConfig.preAnalysisMaxTokens || 1024,
  };
  const adapter = getVisionAdapter(config);

  let prompt = PRE_ANALYZER_PROMPT;
  if (question) {
    prompt += `\n\nUser question for context: "${question}"`;
  }

  logger.info('PreAnalyzer', 'Starting pre-analysis', { model: config.model });

  try {
    const result = await adapter.analyzeImage({
      imageData,
      mediaType,
      prompt,
    });

    const duration = Date.now() - startTime;
    const parsed = parsePreAnalysis(result.text);
    const normalized = normalizePreAnalysis(parsed);

    if (traceCollector) {
      traceCollector.record({
        phase: 'pre_analysis',
        agent: 'PreAnalyzer',
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
          structured: normalized,
          usage: result.usage,
          stopReason: result.stopReason,
        },
      });
    }

    logger.info('PreAnalyzer', 'Pre-analysis complete', {
      dur: duration,
      language: normalized.language,
      contentItems: normalized.contentItems.length,
      namedPeople: normalized.namedPeople.length,
    });

    return normalized;
  } catch (error) {
    const duration = Date.now() - startTime;

    if (traceCollector) {
      traceCollector.record({
        phase: 'pre_analysis',
        agent: 'PreAnalyzer',
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

    logger.warn('PreAnalyzer', 'Pre-analysis failed, using fallback', { err: error.message });
    return createFallbackPreAnalysis();
  }
}

module.exports = {
  PRE_ANALYZER_PROMPT,
  parsePreAnalysis,
  normalizePreAnalysis,
  createFallbackPreAnalysis,
  preAnalyze,
};
