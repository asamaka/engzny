/**
 * Canvas Generator - Simple approach
 * 
 * Ask the LLM to generate compact, visual, interactive HTML/JS
 * that represents the screenshot content in a useful way.
 */

const { getVisionAdapter } = require('../llm');

const CANVAS_PROMPT = `You are a UI generator. Analyze this screenshot and create a compact, visual HTML interface that displays the key information in a more useful, interactive way.

RULES:
1. Output ONLY valid HTML - no markdown, no explanation, no code fences
2. Include all CSS in a <style> tag
3. Include all JS in a <script> tag at the end
4. Use a dark theme (background: #0a0a0a, text: #e5e5e5, accent: #00ffaa)
5. Use 'JetBrains Mono' font
6. Make it COMPACT - distill information, don't just copy text
7. Make key facts VISUAL - use cards, badges, meters, icons
8. Add "investigate" buttons for claims that could be fact-checked
9. Extract and highlight: numbers, names, dates, claims, sources
10. The output should fit in a single viewport without scrolling if possible

STYLE GUIDE:
- Cards with subtle borders and shadows
- Accent color (#00ffaa) for important elements
- Small text (12-14px), tight spacing
- Icons using simple SVG or unicode symbols
- Hover effects on interactive elements

Generate a self-contained HTML document that visually summarizes this screenshot:`;

/**
 * Stream canvas HTML generation
 * @param {Object} options
 * @param {string} options.imageData - Base64 image
 * @param {string} options.mediaType - MIME type
 * @param {Function} options.onToken - Token callback
 * @param {Function} options.onComplete - Completion callback
 * @param {Function} options.onError - Error callback
 */
async function streamCanvasGeneration({ imageData, mediaType, onToken, onComplete, onError }) {
  console.log('[CanvasGenerator] Starting streamCanvasGeneration');
  console.log('[CanvasGenerator] Image size:', imageData ? `${(Buffer.from(imageData, 'base64').length / 1024).toFixed(2)}KB` : 'null');
  console.log('[CanvasGenerator] Media type:', mediaType);
  
  try {
    const adapter = getVisionAdapter();
    console.log('[CanvasGenerator] Got vision adapter:', adapter.providerName);
    
    let tokenCount = 0;
    const startTime = Date.now();
    
    await adapter.streamImageAnalysis({
      imageData,
      mediaType,
      prompt: CANVAS_PROMPT,
      onToken: (token) => {
        tokenCount++;
        if (tokenCount % 50 === 0) {
          console.log(`[CanvasGenerator] Received ${tokenCount} tokens so far...`);
        }
        if (onToken) onToken(token);
      },
      onComplete: (text, usage) => {
        const duration = Date.now() - startTime;
        console.log(`[CanvasGenerator] Complete! Total tokens: ${tokenCount}, Duration: ${duration}ms`);
        console.log(`[CanvasGenerator] Final text length: ${text.length} chars`);
        if (usage) {
          console.log('[CanvasGenerator] Usage:', JSON.stringify(usage));
        }
        if (onComplete) onComplete(text);
      },
      onError: (error) => {
        console.error('[CanvasGenerator] Error:', error.message);
        console.error('[CanvasGenerator] Error stack:', error.stack);
        if (onError) onError(error);
      },
    });
  } catch (error) {
    console.error('[CanvasGenerator] Outer catch error:', error.message);
    console.error('[CanvasGenerator] Outer catch stack:', error.stack);
    if (onError) {
      onError(error);
    } else {
      throw error;
    }
  }
}

module.exports = { streamCanvasGeneration, CANVAS_PROMPT };
