/**
 * Deep Researcher Agent
 *
 * Runs in parallel with Sonnet enhancement to gather web-based research.
 * Uses Perplexity Sonar (preferred) or Claude web search as fallback.
 *
 * Produces structured research findings that feed into Sonnet's review pass.
 */

const { getResearchAdapter, getVisionAdapter, isPerplexityAvailable } = require('../llm');
const { logger } = require('../lib/logger');

function currentDateAnchors() {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = now.getUTCFullYear();
  const isoDate = now.toISOString().slice(0, 10);
  return { month, year, isoDate };
}

/**
 * Build a research query from the content analysis and card data.
 */
function buildResearchQuery(contentAnalysis, cards, { preAnalysis, translationVerification } = {}) {
  const cardSummaries = cards.map(c => {
    const data = c.populatedData || c.data || c.placeholderData || {};
    return `- ${c.cardType}: ${data.title || data.name || data.claim || data.label || 'unknown'}`;
  }).join('\n');

  const { month, year, isoDate } = currentDateAnchors();
  const verifiedClaim = translationVerification?.shouldOverrideClaim
    ? translationVerification.normalizedTranslation
    : (translationVerification?.normalizedTranslation || preAnalysis?.visibleClaim || null);
  const keyTerms = Array.isArray(translationVerification?.keyTerms)
    ? translationVerification.keyTerms.map((item) => `${item.source} → ${item.translation}`).join('; ')
    : '';
  const sourceHint = preAnalysis?.sourceAttribution?.name || 'unknown';
  const timeHint = preAnalysis?.timeContext?.mentionedDate || preAnalysis?.timeContext?.notes || 'none visible';
  const contentItems = Array.isArray(preAnalysis?.contentItems)
    ? preAnalysis.contentItems.map((item) => `- ${item.prominence}: ${item.kind} — ${item.summary}`).join('\n')
    : '';

  return `Research the following based on a screenshot analysis.

**Content Type:** ${contentAnalysis.contentType}
**Platform:** ${contentAnalysis.platform || 'unknown'}
**User Intent:** ${contentAnalysis.intent}
**Current date anchor:** ${isoDate} (${month} ${year})
**Visible source attribution:** ${sourceHint}
**Visible date/time context from screenshot:** ${timeHint}
${verifiedClaim ? `**Verified screenshot claim to research literally:** ${verifiedClaim}` : ''}
${keyTerms ? `**Translated key terms:** ${keyTerms}` : ''}

**Key Questions to Answer:**
${(contentAnalysis.topQuestions || []).map(q => `- ${q}`).join('\n')}

**Current Cards (for context):**
${cardSummaries}
${contentItems ? `\n**Distinct visible content items:**\n${contentItems}` : ''}

**Research Goals:**
1. VERIFICATION PRIORITY: If any card is a verification_card, your #1 goal is to check the claim against major news sources (Reuters, AP, BBC, CNN, Al Jazeera, etc.). Search using the claim + ${month} ${year}. For EACH source, report whether they confirm, deny, or haven't reported the claim. Include source URLs.
2. Verify facts and claims visible in the screenshot
3. Find additional context, background, or recent developments grounded in the current event window
4. Identify any misleading or inaccurate information — but be EXTREMELY cautious with breaking news. A claim being unverified is NOT the same as it being false or misleading.
5. Find related links, sources, and references
6. Answer the user's likely questions with factual, sourced data
7. For breaking news / conflict situations: research ALL SIDES of the event. If one side launched strikes, check whether the other side retaliated. A report about events at location A does not invalidate reports about events at location B — both can be true simultaneously.
8. NEVER assume a breaking news report is misleading just because the primary story is about a different aspect of the same event. Military conflicts involve simultaneous actions by multiple parties.
9. For verification findings, structure each source as a separate finding with the source name, what they report, and the source URL.
10. Prefer sources from ${month} ${year}; for breaking_news, treat obviously stale/outdated results as context, not primary verification.

Return a structured JSON response:
{
  "findings": [
    {
      "topic": "string (what this finding is about)",
      "summary": "string (key finding in 1-2 sentences)",
      "details": "string (detailed information)",
      "confidence": "high|medium|low",
      "sourceUrls": ["array of source URLs"],
      "imageUrl": "string (relevant photo/image URL found during research — for people, locations, news)",
      "relatedCardTypes": ["card types this could enhance"],
      "factCheck": {
        "claim": "string (if applicable — state neutrally)",
        "verdict": "verified|misleading|unverified|false|partially_true|needs_context (for breaking news, prefer unverified or needs_context over misleading or false unless you have overwhelming evidence)",
        "explanation": "string (for breaking news, acknowledge the fast-moving nature and recommend checking multiple sources)"
      }
    }
  ],
  "followUpQuestions": [{"question": "string (question user would ask)", "answer": "string (brief 1-2 sentence answer based on research)"}],
  "additionalQuestions": ["questions that arose from research"],
  "overallContext": "string (brief overall context from research)"
}`;
}

/**
 * Run deep research using Sonar or Claude web search.
 */
async function deepResearch({
  contentAnalysis,
  cards,
  imageData,
  mediaType,
  preAnalysis,
  translationVerification,
  adapterConfig = {},
}) {
  const startTime = Date.now();
  const traceCollector = adapterConfig.traceCollector;
  const usePerplexity = isPerplexityAvailable();

  logger.info('DeepResearcher', 'Starting deep research', {
    method: usePerplexity ? 'perplexity' : 'claude-web-search',
    cardCount: cards.length,
    contentType: contentAnalysis.contentType,
  });

  const query = buildResearchQuery(contentAnalysis, cards, {
    preAnalysis,
    translationVerification,
  });

  try {
    let result;
    let citations = [];

    if (usePerplexity) {
      const adapter = getResearchAdapter({
        ...adapterConfig,
        model: 'sonar',
      });

      result = await adapter.generateText({
        prompt: query,
        systemPrompt: 'You are a deep research specialist with internet access. Return ONLY valid JSON with factual, verified information. No markdown, no explanation.',
      });

      citations = result.citations || [];
    } else {
      const adapter = getVisionAdapter({
        ...adapterConfig,
        model: adapterConfig.model || 'claude-sonnet-4-20250514',
      });

      if (typeof adapter.analyzeImageWithWebSearch === 'function') {
        result = await adapter.analyzeImageWithWebSearch({
          imageData,
          mediaType,
          prompt: query,
          maxSearches: 5,
        });
        citations = result.citations || [];
      } else {
        result = await adapter.analyzeImage({
          imageData,
          mediaType,
          prompt: query,
        });
      }
    }

    const duration = Date.now() - startTime;
    const parsed = parseResearchResponse(result.text);

    logger.info('DeepResearcher', 'Research complete', {
      dur: duration,
      method: usePerplexity ? 'perplexity' : 'claude',
      findingCount: parsed.findings?.length || 0,
      citations: citations.length,
      model: result.model,
    });

    if (traceCollector) {
      traceCollector.record({
        phase: 'deep_research',
        agent: 'DeepResearcher',
        model: result.model || (usePerplexity ? 'sonar' : 'claude-sonnet-4-20250514'),
        duration,
        request: {
          userPrompt: query,
          hasImage: !usePerplexity,
          webSearchEnabled: true,
        },
        response: {
          text: result.text,
          structured: parsed,
          usage: result.usage,
          citations,
        },
      });
    }

    return {
      ...parsed,
      citations,
      duration,
      method: usePerplexity ? 'perplexity' : 'claude',
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('DeepResearcher', 'Research failed', {
      err: error.message,
      dur: duration,
    });

    if (traceCollector) {
      traceCollector.record({
        phase: 'deep_research',
        agent: 'DeepResearcher',
        model: usePerplexity ? 'sonar' : 'claude-sonnet-4-20250514',
        duration,
        request: { userPrompt: query },
        response: {},
        error: error.message,
      });
    }

    return {
      findings: [],
      citations: [],
      duration,
      error: error.message,
    };
  }
}

function parseResearchResponse(text) {
  if (!text) {
    logger.warn('DeepResearcher', 'Empty or missing response text');
    return { findings: [] };
  }

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
    logger.warn('DeepResearcher', 'Failed to parse research response, using raw text', {
      err: e.message,
    });
    const safeText = String(text);
    return {
      findings: [{
        topic: 'Research Results',
        summary: safeText.slice(0, 500),
        details: safeText,
        confidence: 'medium',
        sourceUrls: [],
      }],
    };
  }
}

module.exports = { deepResearch, buildResearchQuery };
