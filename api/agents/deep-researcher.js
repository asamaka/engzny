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

/**
 * Build a research query from the content analysis and card data.
 */
function buildResearchQuery(contentAnalysis, cards) {
  const cardSummaries = cards.map(c => {
    const data = c.populatedData || c.data || c.placeholderData || {};
    return `- ${c.cardType}: ${data.title || data.name || data.claim || data.label || 'unknown'}`;
  }).join('\n');

  return `Research the following based on a screenshot analysis.

**Content Type:** ${contentAnalysis.contentType}
**Platform:** ${contentAnalysis.platform || 'unknown'}
**User Intent:** ${contentAnalysis.intent}

**Key Questions to Answer:**
${(contentAnalysis.topQuestions || []).map(q => `- ${q}`).join('\n')}

**Current Cards (for context):**
${cardSummaries}

**Research Goals:**
1. Verify facts and claims visible in the screenshot
2. Find additional context, background, or recent developments
3. Identify any misleading or inaccurate information
4. Find related links, sources, and references
5. Answer the user's likely questions with factual, sourced data

Return a structured JSON response:
{
  "findings": [
    {
      "topic": "string (what this finding is about)",
      "summary": "string (key finding in 1-2 sentences)",
      "details": "string (detailed information)",
      "confidence": "high|medium|low",
      "sourceUrls": ["array of source URLs"],
      "relatedCardTypes": ["card types this could enhance"],
      "factCheck": {
        "claim": "string (if applicable)",
        "verdict": "verified|misleading|unverified|false|partially_true|needs_context",
        "explanation": "string"
      }
    }
  ],
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

  const query = buildResearchQuery(contentAnalysis, cards);

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
    return {
      findings: [{
        topic: 'Research Results',
        summary: text.slice(0, 500),
        details: text,
        confidence: 'medium',
        sourceUrls: [],
      }],
    };
  }
}

module.exports = { deepResearch };
