const { getVisionAdapter } = require('../llm');
const { logger } = require('../lib/logger');

const TRANSLATION_VERIFIER_PROMPT = `You are verifying a screenshot translation for accuracy. Be literal, conservative, and cautious.

Your job:
1. Re-read the screenshot text directly
2. Verify the extracted main claim
3. Preserve critical terms exactly (weapons, mines, missiles, people, locations, dates, organizations)
4. Flag any translation risk that could change the story meaning

Return ONLY valid JSON:
{
  "language": "string",
  "normalizedTranslation": "string or null",
  "keyTerms": [
    { "source": "string", "translation": "string", "notes": "string or null" }
  ],
  "discrepancies": [
    { "term": "string", "issue": "string", "severity": "high|medium|low" }
  ],
  "confidence": "high|medium|low",
  "shouldOverrideClaim": true
}

Rules:
- Be literal, not stylistic.
- If a military/security term could be mistranslated, flag it.
- If the original extracted claim is already accurate, keep the same meaning.
- If you are unsure, prefer a more conservative translation.`;

function normalizeSeverity(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'low';
}

function normalizeConfidence(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'low';
}

function parseTranslationVerification(text) {
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
    logger.warn('TranslationVerifier', 'Failed to parse translation verification response', { err: error.message });
    return null;
  }
}

function createSkippedTranslationVerification(preAnalysis = {}) {
  return {
    skipped: true,
    language: preAnalysis.language || 'en',
    normalizedTranslation: preAnalysis.visibleClaim || null,
    keyTerms: [],
    discrepancies: [],
    confidence: 'high',
    shouldOverrideClaim: false,
  };
}

function normalizeTranslationVerification(raw, preAnalysis = {}) {
  const normalizedTranslation = typeof raw?.normalizedTranslation === 'string' && raw.normalizedTranslation.trim()
    ? raw.normalizedTranslation.trim()
    : (preAnalysis.visibleClaim || null);

  const discrepancies = Array.isArray(raw?.discrepancies)
    ? raw.discrepancies
      .map((item) => {
        if (!item || typeof item !== 'object' || typeof item.term !== 'string' || typeof item.issue !== 'string') return null;
        return {
          term: item.term.trim(),
          issue: item.issue.trim(),
          severity: normalizeSeverity(item.severity),
        };
      })
      .filter(Boolean)
      .slice(0, 8)
    : [];

  return {
    skipped: false,
    language: typeof raw?.language === 'string' && raw.language.trim()
      ? raw.language.trim().toLowerCase()
      : (preAnalysis.language || 'unknown'),
    normalizedTranslation,
    keyTerms: Array.isArray(raw?.keyTerms)
      ? raw.keyTerms
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          if (typeof item.source !== 'string' || typeof item.translation !== 'string') return null;
          return {
            source: item.source.trim(),
            translation: item.translation.trim(),
            notes: typeof item.notes === 'string' && item.notes.trim() ? item.notes.trim() : null,
          };
        })
        .filter(Boolean)
        .slice(0, 10)
      : [],
    discrepancies,
    confidence: normalizeConfidence(raw?.confidence),
    shouldOverrideClaim: raw?.shouldOverrideClaim === true || (
      !!normalizedTranslation &&
      normalizedTranslation !== preAnalysis.visibleClaim &&
      discrepancies.some((item) => item.severity === 'high')
    ),
  };
}

async function verifyTranslation({ imageData, mediaType, preAnalysis, adapterConfig = {} }) {
  if (!preAnalysis?.requiresTranslationVerification) {
    return createSkippedTranslationVerification(preAnalysis);
  }

  const startTime = Date.now();
  const traceCollector = adapterConfig.traceCollector;
  const config = {
    ...adapterConfig,
    model: adapterConfig.translationVerificationModel || 'claude-haiku-4-5-20251001',
    maxTokens: adapterConfig.translationVerificationMaxTokens || 1024,
  };
  const adapter = getVisionAdapter(config);

  const prompt = `${TRANSLATION_VERIFIER_PROMPT}

Screenshot language: ${preAnalysis.language}
Previously extracted main claim: ${preAnalysis.visibleClaim || '(none)'}
Visible source/account: ${preAnalysis.sourceAttribution?.name || '(unknown)'}
Visible date/time context: ${preAnalysis.timeContext?.mentionedDate || preAnalysis.timeContext?.notes || '(none)'}`;

  logger.info('TranslationVerifier', 'Starting translation verification', {
    model: config.model,
    language: preAnalysis.language,
  });

  try {
    const result = await adapter.analyzeImage({
      imageData,
      mediaType,
      prompt,
    });

    const duration = Date.now() - startTime;
    const parsed = parseTranslationVerification(result.text);
    const normalized = normalizeTranslationVerification(parsed, preAnalysis);

    if (traceCollector) {
      traceCollector.record({
        phase: 'translation_verify',
        agent: 'TranslationVerifier',
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

    logger.info('TranslationVerifier', 'Translation verification complete', {
      dur: duration,
      discrepancies: normalized.discrepancies.length,
      override: normalized.shouldOverrideClaim,
    });

    return normalized;
  } catch (error) {
    const duration = Date.now() - startTime;

    if (traceCollector) {
      traceCollector.record({
        phase: 'translation_verify',
        agent: 'TranslationVerifier',
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

    logger.warn('TranslationVerifier', 'Translation verification failed, falling back to first-pass claim', {
      err: error.message,
    });

    return {
      ...createSkippedTranslationVerification(preAnalysis),
      skipped: false,
      confidence: 'low',
      discrepancies: [],
      shouldOverrideClaim: false,
    };
  }
}

module.exports = {
  TRANSLATION_VERIFIER_PROMPT,
  parseTranslationVerification,
  normalizeTranslationVerification,
  createSkippedTranslationVerification,
  verifyTranslation,
};
