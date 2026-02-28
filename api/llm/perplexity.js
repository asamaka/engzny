/**
 * Perplexity Sonar LLM Adapter
 *
 * Uses Perplexity's Sonar models for web-grounded research.
 * Sonar models have built-in internet access and return citations.
 * API is OpenAI-compatible (chat completions format).
 */

const { LLMAdapter } = require('./adapter');

class PerplexityAdapter extends LLMAdapter {
  constructor(config = {}) {
    super(config);

    this.apiKey = config.apiKey || process.env.PERPLEXITY_API_KEY;
    if (!this.apiKey) {
      throw new Error('PERPLEXITY_API_KEY is required for PerplexityAdapter');
    }

    this.baseUrl = 'https://api.perplexity.ai';
    this.model = config.model || 'sonar';
    this.maxTokens = config.maxTokens || 4096;
  }

  get providerName() {
    return 'perplexity';
  }

  supportsVision() {
    return false;
  }

  supportsStructuredOutput() {
    return true;
  }

  supportsStreaming() {
    return false;
  }

  /**
   * Text-only research query with built-in web search.
   * Perplexity Sonar always searches the web — no tool use needed.
   */
  async generateText({ prompt, systemPrompt, context }) {
    const messages = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    const userContent = context
      ? `Context:\n${JSON.stringify(context, null, 2)}\n\n${prompt}`
      : prompt;

    messages.push({ role: 'user', content: userContent });

    const body = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Perplexity API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      text: choice?.message?.content || '',
      usage: data.usage ? {
        input_tokens: data.usage.prompt_tokens,
        output_tokens: data.usage.completion_tokens,
      } : undefined,
      model: data.model,
      stopReason: choice?.finish_reason,
      citations: data.citations || [],
    };
  }

  /**
   * Research a topic using web-grounded search.
   * Combines context from the screenshot analysis with a web search query.
   */
  async research({ query, context, systemPrompt }) {
    const defaultSystem = `You are a research specialist with real-time internet access. 
Provide accurate, factual information with specific details. 
Return ONLY valid JSON — no markdown, no explanation.`;

    return this.generateText({
      prompt: query,
      systemPrompt: systemPrompt || defaultSystem,
      context,
    });
  }

  async analyzeImage() {
    throw new Error('PerplexityAdapter does not support image analysis — use Claude for vision');
  }

  async streamText() {
    throw new Error('PerplexityAdapter does not support streaming');
  }

  async streamImageAnalysis() {
    throw new Error('PerplexityAdapter does not support image streaming');
  }
}

module.exports = { PerplexityAdapter };
