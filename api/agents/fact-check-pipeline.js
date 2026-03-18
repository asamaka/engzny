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

  return `You are a world-class fact-checker and investigative analyst with access to Google Search. Today is ${isoDate} (${month} ${year}).

You will be shown a screenshot. Your job is to:
1. Determine what claims or information the screenshot contains
2. Use Google Search to verify those claims against authoritative sources
3. Deliver a clear verdict followed by structured analysis

YOUR RESPONSE MUST FOLLOW THIS EXACT FORMAT (including the section markers):

VERDICT: [exactly one of: TRUE, FALSE, MISLEADING, PARTLY TRUE, UNVERIFIED]
[One sentence explaining your verdict — this is the first thing the user sees, make it count]

---SUMMARY
Write 2-3 paragraphs analyzing what the screenshot shows. What are the key claims? What did your web searches find? Give the user a clear, readable overview. Be direct and specific — no filler phrases like "upon examination" or "it's worth noting". Just state what you found.

---ANGLE: [Title — the most important investigative angle]
Deep-dive into this specific aspect. 2-3 paragraphs. Cite specific sources, dates, and facts from your web searches. If sources disagree, say so clearly.

---ANGLE: [Title — a second distinct angle or dimension]
Another deep-dive. Different perspective from the first angle. Could be: source credibility, historical context, related events, counter-arguments, or broader implications.

---ANGLE: [Title — a third angle if warranted]
Only include this if there's genuinely a third distinct dimension worth exploring. Skip it if two angles cover the story adequately.

---SOURCES
List each source you used, one per line, formatted as:
• Source Name — brief description of what it confirmed/denied (URL if available)

CRITICAL RULES:
1. The VERDICT line must be the VERY FIRST line of your response. No preamble, no thinking out loud.
2. Use Google Search aggressively. Search for specific claims, names, dates, and quotes from the screenshot.
3. Search authoritative sources: Reuters, AP, BBC, CNN, official statements, peer-reviewed studies.
4. If the screenshot is in a non-English language, translate the key content and analyze in English.
5. Be honest about uncertainty. "UNVERIFIED" is better than a wrong verdict.
6. Each ANGLE must have a distinct title and cover a different dimension — don't repeat the summary.
7. Never fabricate sources or URLs. Only cite what you actually found via search.
8. Write for a general audience. No jargon. Short sentences. Be concise but thorough.
9. If the screenshot is not a claim (e.g., a product page, settings screen, meme), adjust your analysis accordingly — still provide useful context and verification where possible.`;
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
    const model = process.env.GEMINI_ANALYSIS_MODEL || 'gemini-2.5-flash';
    const adapter = getAdapter('gemini', { model, maxTokens: 8192 });

    let prompt = buildFactCheckPrompt();
    if (question) {
      prompt += `\n\nThe user specifically asks: "${question}"`;
    }

    if (onProgress) {
      onProgress({ phase: 'searching', progress: 10, message: 'Analyzing screenshot and searching the web...' });
    }

    logger.info('FactCheckPipeline', 'Starting streaming analysis', { model, requestId });

    let verdictSent = false;
    let currentSection = null;
    let textSoFar = '';

    const parseAndEmitStructure = (newChunk) => {
      textSoFar += newChunk;

      if (!verdictSent) {
        const verdictMatch = textSoFar.match(/^VERDICT:\s*(TRUE|FALSE|MISLEADING|PARTLY TRUE|UNVERIFIED)\s*\n(.+?)(?:\n|$)/);
        if (verdictMatch) {
          verdictSent = true;
          if (onVerdict) {
            onVerdict({
              verdict: verdictMatch[1],
              explanation: verdictMatch[2].trim(),
            });
          }
          if (onProgress) {
            onProgress({ phase: 'analyzing', progress: 30, message: 'Verdict delivered, analyzing deeper...' });
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
    };

    const result = await adapter.streamImageAnalysisWithGrounding({
      imageData,
      mediaType,
      prompt,
      maxTokens: 8192,
      onToken: (chunk) => {
        parseAndEmitStructure(chunk);
        if (onToken) onToken(chunk);
      },
    });

    const duration = Date.now() - startTime;

    logger.info('FactCheckPipeline', 'Analysis complete', {
      requestId,
      duration,
      model: result?.model,
      textLength: result?.text?.length,
      citations: result?.citations?.length || 0,
    });

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
        model: result?.model || model,
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

module.exports = { runFactCheckPipeline };
