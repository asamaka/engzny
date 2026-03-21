/**
 * Fact-Check Streaming Pipeline
 *
 * Text-first pipeline that streams Gemini's response directly to the client.
 * Uses Google Search grounding for real-time web verification.
 *
 * Response format is structured plain text that the frontend parses progressively:
 *   VERDICT: TRUE|FALSE|MISLEADING|PARTLY TRUE|UNVERIFIED
 *   [one-line verdict explanation]
 *   ---SUMMARY
 *   [high-level analysis paragraphs]
 *   ---ANGLE: Title of investigation angle
 *   [deep-dive paragraphs for this angle]
 *   ---ANGLE: Another angle
 *   [deep-dive paragraphs]
 *   ---SOURCES
 *   [source list]
 */

const { getAdapter } = require('../llm');
const { logger } = require('../lib/logger');

function buildFactCheckPrompt() {
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const month = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = now.getUTCFullYear();

  return `You are a world-class fact-checker and investigative analyst. Today is ${isoDate} (${month} ${year}).

IMPORTANT — WEB SEARCH IS MANDATORY:
You have access to Google Search. You MUST search the web before writing your analysis. Do NOT rely on your training data for any factual claims. Your job is to find what real sources say RIGHT NOW, not to recall what you were trained on.

Before writing anything, perform at least 3-5 Google searches:
- Search for the specific claims, names, and events in the screenshot
- Search for the original source of the content shown
- Search for counter-arguments or fact-checks by authoritative outlets (Reuters, AP, BBC, AFP, official statements)
- Search in the language of the screenshot if it's not English, then also in English

Your analysis is only as good as the web sources backing it. An analysis without web sources is just an opinion — users need verified facts.

You will be shown a screenshot. Your workflow:
1. READ the screenshot — identify the key claims, people, events, dates
2. SEARCH the web — multiple searches for each major claim
3. ANALYZE what you found — compare sources, note agreements and contradictions
4. WRITE your response grounded in what your searches returned

YOUR RESPONSE MUST FOLLOW THIS EXACT FORMAT (including the section markers):

VERDICT: [exactly one of: TRUE, FALSE, MISLEADING, PARTLY TRUE, UNVERIFIED]
[One sentence explaining your verdict — this is the first thing the user sees, make it count]

---SUMMARY
Write 2-3 paragraphs analyzing what the screenshot shows. Reference specific findings from your web searches — name the sources, cite dates, quote key facts. Be direct and specific — no filler phrases like "upon examination" or "it's worth noting". State what your searches found.

---ANGLE: [Title — the most important investigative angle]
Deep-dive into this specific aspect. 2-3 paragraphs. You MUST cite specific sources, dates, and facts from your web searches. If sources disagree, say so clearly. Name the publications and dates.

---ANGLE: [Title — a second distinct angle or dimension]
Another deep-dive. Different perspective from the first angle. Could be: source credibility, historical context, related events, counter-arguments, or broader implications. Again, ground every claim in your web search results.

---ANGLE: [Title — a third angle if warranted]
Only include this if there's genuinely a third distinct dimension worth exploring. Skip it if two angles cover the story adequately.

---SOURCES
List each source you found via web search, one per line, formatted as:
• Source Name (date) — what it confirmed or denied (URL if available)

CRITICAL RULES:
1. The VERDICT line must be the VERY FIRST line of your response. No preamble, no thinking out loud.
2. The verdict explanation MUST be a single, complete sentence of at least 15 words. It must stand alone as a clear summary. Never write just a word or fragment.
3. You MUST use Google Search for every analysis. Do not skip searching. The user is counting on web-verified facts, not AI opinions.
4. If the screenshot is in a non-English language, translate the key content and search in both the original language and English.
5. Be honest about uncertainty. "UNVERIFIED" is better than a wrong verdict.
6. Each ANGLE must have a distinct title and cover a different dimension — don't repeat the summary.
7. Never fabricate sources or URLs. Only cite what you actually found via search.
8. Write for a general audience. No jargon. Short sentences. Be concise but thorough.
9. If the screenshot is not a claim (e.g., a product page, settings screen, meme), still search for context and provide useful verification where possible.`;
}

/**
 * Run the fact-check streaming pipeline.
 *
 * Callbacks:
 *   onToken(text)            — each text chunk from the stream
 *   onVerdict({verdict, explanation})  — parsed verdict line
 *   onSection({type, title}) — new section detected (summary, angle, sources)
 *   onSources({citations, groundingMetadata}) — web search sources
 *   onComplete({text, duration, model, citations}) — stream finished
 *   onError(error)           — something went wrong
 *   onProgress({phase, progress, message}) — progress updates
 */
async function runFactCheckPipeline({
  imageData,
  mediaType,
  question,
  onToken,
  onVerdict,
  onSection,
  onSources,
  onComplete,
  onError,
  onProgress,
  adapterConfig = {},
}) {
  const startTime = Date.now();
  const requestId = adapterConfig.requestId || 'unknown';

  try {
    let prompt = buildFactCheckPrompt();
    if (question) {
      prompt += `\n\nThe user specifically asks: "${question}"`;
    }

    if (onProgress) {
      onProgress({ phase: 'searching', progress: 10, message: 'Analyzing screenshot and searching the web...' });
    }

    let verdictSent = false;
    let pendingVerdict = null;
    let currentSection = null;
    let textSoFar = '';

    const MIN_EXPLANATION_LENGTH = 30;

    const emitVerdict = (verdict) => {
      if (verdictSent) return;
      verdictSent = true;
      pendingVerdict = null;
      if (onVerdict) onVerdict(verdict);
      if (onProgress) {
        onProgress({ phase: 'analyzing', progress: 30, message: 'Verdict delivered, analyzing deeper...' });
      }
    };

    const extractVerdictFromText = () => {
      const verdictMatch = textSoFar.match(/(?:^|\n)VERDICT:\s*(TRUE|FALSE|MISLEADING|PARTLY TRUE|UNVERIFIED)\s*\n([\s\S]+?)(?=\n\n|\n---)/);
      if (!verdictMatch) return null;
      return {
        verdict: verdictMatch[1],
        explanation: verdictMatch[2].trim().replace(/\n/g, ' '),
      };
    };

    const enhanceExplanationFromSummary = (verdict) => {
      const summaryMatch = textSoFar.match(/---SUMMARY\s*\n([\s\S]+?)(?=\n---|$)/);
      if (!summaryMatch) return verdict;
      const summaryText = summaryMatch[1].trim();
      const firstSentence = summaryText.split(/(?<=\.)\s/)[0];
      if (firstSentence && firstSentence.length >= MIN_EXPLANATION_LENGTH) {
        return { ...verdict, explanation: firstSentence };
      }
      return verdict;
    };

    const parseAndEmitStructure = (newChunk) => {
      textSoFar += newChunk;

      if (!verdictSent) {
        const parsed = extractVerdictFromText();
        if (parsed) {
          if (parsed.explanation.length >= MIN_EXPLANATION_LENGTH) {
            emitVerdict(parsed);
          } else {
            pendingVerdict = parsed;
          }
        }
      }

      if (newChunk.includes('---SUMMARY')) {
        currentSection = 'summary';
        if (onSection) onSection({ type: 'summary', title: 'Summary' });
        if (onProgress) {
          onProgress({ phase: 'analyzing', progress: 40, message: 'Building analysis...' });
        }
      }

      const angleMatch = newChunk.match(/---ANGLE:\s*(.+)/);
      if (angleMatch) {
        currentSection = 'angle';
        if (onSection) onSection({ type: 'angle', title: angleMatch[1].trim() });
        if (onProgress) {
          onProgress({ phase: 'deepdive', progress: 60, message: `Investigating: ${angleMatch[1].trim()}` });
        }
      }

      if (newChunk.includes('---SOURCES')) {
        currentSection = 'sources';
        if (onSection) onSection({ type: 'sources', title: 'Sources' });
        if (onProgress) {
          onProgress({ phase: 'sources', progress: 85, message: 'Compiling sources...' });
        }
      }

      if (pendingVerdict && !verdictSent && textSoFar.includes('---SUMMARY')) {
        const enhanced = enhanceExplanationFromSummary(pendingVerdict);
        emitVerdict(enhanced);
      }
    };

    let result = null;

    // Try Gemini first (streaming with Google Search grounding)
    try {
      const model = process.env.GEMINI_ANALYSIS_MODEL || 'gemini-2.5-flash';
      const adapter = getAdapter('gemini', { model, maxTokens: 8192 });

      logger.info('FactCheckPipeline', 'Starting Gemini streaming analysis', { model, requestId });

      result = await adapter.streamImageAnalysisWithGrounding({
        imageData,
        mediaType,
        prompt,
        maxTokens: 8192,
        systemInstruction: 'You are a fact-checking assistant. You MUST use Google Search to find and cite real web sources for every analysis. Never answer from memory alone — always search first.',
        onToken: (chunk) => {
          parseAndEmitStructure(chunk);
          if (onToken) onToken(chunk);
        },
      });
    } catch (geminiError) {
      // Gemini failed (quota, rate limit, outage) — fall back to Claude with web search
      logger.warn('FactCheckPipeline', 'Gemini failed, falling back to Claude', {
        requestId,
        geminiErr: geminiError.message,
      });

      // Reset parser state for clean fallback
      textSoFar = '';
      verdictSent = false;
      pendingVerdict = null;
      currentSection = null;

      if (onProgress) {
        onProgress({ phase: 'searching', progress: 15, message: 'Switching to backup analysis...' });
      }

      const fallbackModel = process.env.FACTCHECK_FALLBACK_MODEL || 'claude-sonnet-4-20250514';
      const claudeAdapter = getAdapter('claude', { model: fallbackModel, maxTokens: 8192 });

      logger.info('FactCheckPipeline', 'Starting Claude fallback analysis', { model: fallbackModel, requestId });

      const claudeResult = await claudeAdapter.analyzeImageWithWebSearch({
        imageData,
        mediaType,
        prompt,
        maxSearches: 5,
      });

      if (claudeResult.text) {
        parseAndEmitStructure(claudeResult.text);
        if (onToken) onToken(claudeResult.text);
      }

      const citationUrls = extractClaudeCitations(claudeResult);

      result = {
        text: claudeResult.text,
        usage: claudeResult.usage,
        model: claudeResult.model,
        groundingMetadata: null,
        citations: citationUrls,
      };
    }

    let duration = Date.now() - startTime;

    if (pendingVerdict && !verdictSent) {
      const enhanced = enhanceExplanationFromSummary(pendingVerdict);
      emitVerdict(enhanced);
    }

    if (!verdictSent) {
      const lastChance = extractVerdictFromText();
      if (lastChance) emitVerdict(lastChance);
    }

    let citationCount = result?.citations?.length || 0;
    logger.info('FactCheckPipeline', 'Analysis complete', {
      requestId,
      duration,
      model: result?.model,
      textLength: result?.text?.length,
      citations: citationCount,
    });

    // When Gemini skips web search (0 citations), use Claude's web_search
    // tool to find real sources. Claude reliably searches when the tool is
    // available, unlike Gemini which decides internally and usually opts not to.
    if (citationCount === 0 && result?.text) {
      logger.info('FactCheckPipeline', 'Running supplementary search for citations via Claude', { requestId });
      if (onProgress) {
        onProgress({ phase: 'verifying', progress: 90, message: 'Verifying sources...' });
      }

      try {
        const supplementaryCitations = await runSupplementarySearch(result.text, requestId);
        if (supplementaryCitations.length > 0) {
          result.citations = supplementaryCitations;
          result.groundingMetadata = result.groundingMetadata || {};
          citationCount = supplementaryCitations.length;
          logger.info('FactCheckPipeline', 'Supplementary search found citations', {
            requestId,
            citations: citationCount,
          });
        } else {
          logger.warn('FactCheckPipeline', 'Claude supplementary search returned 0 citations', { requestId });
        }
      } catch (err) {
        logger.warn('FactCheckPipeline', 'Claude supplementary search failed (non-fatal)', {
          requestId,
          err: err.message,
        });
      }
      duration = Date.now() - startTime;
    }

    if (result?.citations?.length && onSources) {
      onSources({
        citations: result.citations,
        groundingMetadata: result.groundingMetadata,
      });
    }

    if (onProgress) {
      onProgress({ phase: 'complete', progress: 100, message: 'Analysis complete' });
    }

    if (onComplete) {
      onComplete({
        text: result?.text || textSoFar,
        duration,
        model: result?.model || 'unknown',
        citations: result?.citations || [],
        groundingMetadata: result?.groundingMetadata || null,
      });
    }

    return result;
  } catch (error) {
    logger.error('FactCheckPipeline', 'Pipeline error', {
      requestId,
      err: error.message,
      duration: Date.now() - startTime,
    });
    if (onError) { onError(error); } else { throw error; }
  }
}

/**
 * When the main Gemini analysis returns 0 citations, use Claude's web_search
 * tool to find real sources. Claude's web search is tool-based (it explicitly
 * searches when the tool is available), unlike Gemini which decides internally
 * whether to search and frequently opts not to.
 */
async function runSupplementarySearch(analysisText, requestId) {
  const verdictMatch = analysisText.match(
    /(?:^|\n)VERDICT:\s*(?:TRUE|FALSE|MISLEADING|PARTLY TRUE|UNVERIFIED)\s*\n([\s\S]+?)(?=\n\n|\n---)/
  );
  const summaryMatch = analysisText.match(/---SUMMARY\s*\n([\s\S]+?)(?=\n---|$)/);

  const claim = verdictMatch?.[1]?.trim() || '';
  const summary = summaryMatch?.[1]?.trim().slice(0, 500) || '';

  if (!claim && !summary) return [];

  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const month = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = now.getUTCFullYear();

  const searchPrompt = `Today is ${isoDate} (${month} ${year}). Find real web sources about this claim.

Claim: "${claim}"

${summary ? `Context: ${summary.slice(0, 300)}` : ''}

Search for this claim on major news outlets (Reuters, AP, BBC, CNN, Al Jazeera, etc). For each source you find, report its URL and what it says about the claim. Search in the language of the claim and in English.`;

  const fallbackModel = process.env.FACTCHECK_FALLBACK_MODEL || 'claude-sonnet-4-20250514';
  const adapter = getAdapter('claude', { model: fallbackModel, maxTokens: 2048 });

  const result = await adapter.generateTextWithWebSearch({
    prompt: searchPrompt,
    systemPrompt: 'You are a news verification assistant. Search the web to find real, current sources for the claim. Be thorough.',
    maxSearches: 5,
    maxTokens: 2048,
  });

  const citations = result.citationUrls || [];

  logger.info('FactCheckPipeline', 'Supplementary search result', {
    requestId,
    citations: citations.length,
    model: result.model,
    webSearchUsed: result.webSearchUsed,
  });

  return citations;
}

function extractClaudeCitations(claudeResult) {
  const urls = new Set();
  for (const c of claudeResult.citations || []) {
    if (c.url) urls.add(c.url);
  }
  for (const sr of claudeResult.searchResults || []) {
    if (sr.content && Array.isArray(sr.content)) {
      for (const item of sr.content) {
        if (item.url) urls.add(item.url);
      }
    }
  }
  return [...urls];
}

module.exports = { runFactCheckPipeline };
