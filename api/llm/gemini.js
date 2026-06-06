/**
 * Gemini LLM Adapter
 *
 * Implementation of LLMAdapter for Google's Gemini models.
 * Supports vision analysis, text generation, and Google Search grounding
 * via the Generative Language API.
 */

const { LLMAdapter } = require('./adapter');

class GeminiAdapter extends LLMAdapter {
  constructor(config = {}) {
    super(config);

    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is required for GeminiAdapter');
    }

    this.model = config.model || 'gemini-2.5-flash';
    this.maxTokens = config.maxTokens || 8192;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  _getEndpoint() {
    return `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`;
  }

  get providerName() {
    return 'gemini';
  }

  supportsVision() {
    return true;
  }

  supportsStructuredOutput() {
    return true;
  }

  supportsStreaming() {
    return true;
  }

  _getStreamEndpoint() {
    return `${this.baseUrl}/${this.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;
  }

  async _callApi(body) {
    const response = await fetch(this._getEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error?.message || `Gemini API error (${response.status})`;
      throw new Error(message);
    }

    const text = (payload.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || '')
      .join('')
      .trim();

    const grounding = payload.candidates?.[0]?.groundingMetadata;

    return {
      text,
      usage: payload.usageMetadata,
      model: this.model,
      stopReason: payload.candidates?.[0]?.finishReason,
      groundingMetadata: grounding || null,
      citations: grounding?.groundingChunks?.map(chunk => chunk.web?.uri).filter(Boolean) || [],
    };
  }

  async analyzeImage({ imageData, mediaType, prompt, responseFormat, maxTokens }) {
    const promptText = responseFormat
      ? `${prompt}\n\nRespond with valid JSON matching this schema:\n${JSON.stringify(responseFormat, null, 2)}`
      : prompt;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: mediaType,
                data: imageData,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: maxTokens || this.maxTokens,
        ...(responseFormat
          ? {
              responseMimeType: 'application/json',
              responseSchema: responseFormat,
            }
          : {}),
      },
    };

    return this._callApi(body);
  }

  /**
   * Analyze an image with Google Search grounding enabled.
   * Gemini performs real-time web searches to verify and enrich its analysis.
   * Returns structured findings with grounding citations.
   */
  async analyzeImageWithGrounding({ imageData, mediaType, prompt, maxTokens }) {
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mediaType,
                data: imageData,
              },
            },
          ],
        },
      ],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: maxTokens || this.maxTokens,
      },
    };

    return this._callApi(body);
  }

  /**
   * Text-only query with Google Search grounding.
   * `thinkingBudget` (2.5 models): pass 0 to disable "thinking" so the output
   * budget isn't consumed before the answer is emitted (important when the caller
   * needs reliable structured output rather than empty/truncated text).
   */
  async generateTextWithGrounding({ prompt, systemPrompt, maxTokens, thinkingBudget }) {
    const generationConfig = {
      temperature: 0.2,
      maxOutputTokens: maxTokens || this.maxTokens,
    };
    if (thinkingBudget != null) generationConfig.thinkingConfig = { thinkingBudget };
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig,
    };

    if (systemPrompt) {
      body.system_instruction = { parts: [{ text: systemPrompt }] };
    }

    return this._callApi(body);
  }

  async generateText({ prompt, systemPrompt, maxTokens }) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: maxTokens || this.maxTokens,
      },
    };

    if (systemPrompt) {
      body.system_instruction = { parts: [{ text: systemPrompt }] };
    }

    return this._callApi(body);
  }

  /**
   * Stream image analysis with Google Search grounding.
   * Tries streaming first via streamGenerateContent. If streaming yields
   * no tokens (can happen with grounding), falls back to non-streaming
   * analyzeImageWithGrounding and emits the full text as a single token.
   */
  async streamImageAnalysisWithGrounding({ imageData, mediaType, prompt, maxTokens, systemInstruction, onToken, onComplete, onError }) {
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: mediaType, data: imageData } },
          ],
        },
      ],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: maxTokens || this.maxTokens,
      },
      ...(systemInstruction ? { system_instruction: { parts: [{ text: systemInstruction }] } } : {}),
    };

    try {
      let fullText = '';
      let groundingMetadata = null;
      let usage = null;
      let streamWorked = false;

      try {
        const response = await fetch(this._getStreamEndpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error?.message || `Gemini stream error (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;

            try {
              const chunk = JSON.parse(jsonStr);
              const parts = chunk.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                if (part.text) {
                  fullText += part.text;
                  streamWorked = true;
                  if (onToken) onToken(part.text);
                }
              }

              if (chunk.candidates?.[0]?.groundingMetadata) {
                groundingMetadata = chunk.candidates[0].groundingMetadata;
              }
              if (chunk.usageMetadata) {
                usage = chunk.usageMetadata;
              }
            } catch {}
          }
        }
      } catch (streamErr) {
        console.warn('[Gemini] Streaming failed, falling back to non-streaming:', streamErr.message);
        streamWorked = false;
      }

      // Fallback: if streaming yielded no text, use non-streaming endpoint
      if (!streamWorked) {
        console.log('[Gemini] Using non-streaming fallback with grounding');
        const result = await this.analyzeImageWithGrounding({ imageData, mediaType, prompt, maxTokens });
        fullText = result.text || '';
        groundingMetadata = result.groundingMetadata;
        usage = result.usage;

        // Emit the full text as one chunk so the pipeline can parse it
        if (fullText && onToken) onToken(fullText);
      }

      const citations = groundingMetadata?.groundingChunks
        ?.map(c => c.web?.uri)
        .filter(Boolean) || [];

      if (onComplete) {
        onComplete({
          text: fullText,
          usage,
          model: this.model,
          groundingMetadata,
          citations,
        });
      }

      return { text: fullText, usage, model: this.model, groundingMetadata, citations };
    } catch (err) {
      if (onError) { onError(err); return null; }
      throw err;
    }
  }
}

module.exports = { GeminiAdapter };
