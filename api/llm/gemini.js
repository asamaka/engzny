/**
 * Gemini LLM Adapter
 *
 * Implementation of LLMAdapter for Google's Gemini models.
 * Supports vision analysis and text generation via the Generative Language API.
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
    return false;
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

    return {
      text,
      usage: payload.usageMetadata,
      model: this.model,
      stopReason: payload.candidates?.[0]?.finishReason,
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

  async generateText({ prompt, systemPrompt, maxTokens }) {
    const parts = [];
    if (systemPrompt) {
      parts.push({ text: `${systemPrompt}\n\n${prompt}` });
    } else {
      parts.push({ text: prompt });
    }

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: maxTokens || this.maxTokens,
      },
    };

    return this._callApi(body);
  }
}

module.exports = { GeminiAdapter };
