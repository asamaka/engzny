/**
 * Claude LLM Adapter
 * 
 * Implementation of LLMAdapter for Anthropic's Claude models.
 * Supports vision, text generation, and streaming.
 */

const Anthropic = require('@anthropic-ai/sdk').default;
const { LLMAdapter } = require('./adapter');

class ClaudeAdapter extends LLMAdapter {
  constructor(config = {}) {
    super(config);
    
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for ClaudeAdapter');
    }
    
    this.client = new Anthropic({ apiKey: this.apiKey });
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 4096;
  }

  get providerName() {
    return 'claude';
  }

  supportsVision() {
    return true;
  }

  supportsStructuredOutput() {
    return true; // Claude can return JSON when prompted
  }

  supportsStreaming() {
    return true;
  }

  /**
   * Analyze an image with a prompt
   */
  async analyzeImage({ imageData, mediaType, prompt, responseFormat }) {
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageData,
            },
          },
          {
            type: 'text',
            text: responseFormat 
              ? `${prompt}\n\nRespond with valid JSON matching this schema:\n${JSON.stringify(responseFormat, null, 2)}`
              : prompt,
          },
        ],
      },
    ];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages,
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    let structured = null;
    if (responseFormat) {
      try {
        // Extract JSON from the response (handle markdown code blocks)
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
        const jsonStr = jsonMatch[1] || text;
        structured = JSON.parse(jsonStr.trim());
      } catch (e) {
        console.warn('Failed to parse structured response:', e.message);
      }
    }

    return {
      text,
      structured,
      usage: response.usage,
      model: response.model,
    };
  }

  /**
   * Generate text from a prompt
   */
  async generateText({ prompt, systemPrompt, context }) {
    const messages = [
      {
        role: 'user',
        content: context 
          ? `Context:\n${JSON.stringify(context, null, 2)}\n\n${prompt}`
          : prompt,
      },
    ];

    const requestOptions = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages,
    };

    if (systemPrompt) {
      requestOptions.system = systemPrompt;
    }

    const response = await this.client.messages.create(requestOptions);

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return {
      text,
      usage: response.usage,
      model: response.model,
    };
  }

  /**
   * Stream text generation with token callbacks
   */
  async streamText({ prompt, systemPrompt, context, onToken, onComplete, onError }) {
    try {
      const messages = [
        {
          role: 'user',
          content: context 
            ? `Context:\n${JSON.stringify(context, null, 2)}\n\n${prompt}`
            : prompt,
        },
      ];

      const requestOptions = {
        model: this.model,
        max_tokens: this.maxTokens,
        messages,
      };

      if (systemPrompt) {
        requestOptions.system = systemPrompt;
      }

      const stream = this.client.messages.stream(requestOptions);
      let fullText = '';

      stream.on('text', (text) => {
        fullText += text;
        if (onToken) onToken(text);
      });

      const finalMessage = await stream.finalMessage();
      
      if (onComplete) {
        onComplete(fullText, finalMessage.usage);
      }
    } catch (error) {
      if (onError) {
        onError(error);
      } else {
        throw error;
      }
    }
  }

  /**
   * Stream image analysis with token callbacks
   */
  async streamImageAnalysis({ imageData, mediaType, prompt, onToken, onComplete, onError }) {
    console.log('[ClaudeAdapter] streamImageAnalysis called');
    console.log('[ClaudeAdapter] Image data length:', imageData ? `${imageData.length} chars` : 'null');
    console.log('[ClaudeAdapter] Media type:', mediaType);
    console.log('[ClaudeAdapter] Prompt length:', prompt ? `${prompt.length} chars` : 'null');
    
    try {
      const messages = [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageData,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ];

      console.log('[ClaudeAdapter] Creating stream...');
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: this.maxTokens,
        messages,
      });

      let fullText = '';
      let tokenCount = 0;
      const startTime = Date.now();

      console.log('[ClaudeAdapter] Stream created, waiting for tokens...');
      
      stream.on('text', (text) => {
        tokenCount++;
        fullText += text;
        if (tokenCount === 1) {
          console.log('[ClaudeAdapter] First token received!');
        }
        if (tokenCount % 100 === 0) {
          console.log(`[ClaudeAdapter] Received ${tokenCount} tokens, ${fullText.length} chars so far`);
        }
        if (onToken) onToken(text);
      });

      console.log('[ClaudeAdapter] Waiting for finalMessage...');
      const finalMessage = await stream.finalMessage();
      const duration = Date.now() - startTime;
      
      console.log(`[ClaudeAdapter] Stream complete! Total tokens: ${tokenCount}, Duration: ${duration}ms`);
      console.log(`[ClaudeAdapter] Final text length: ${fullText.length} chars`);
      
      if (onComplete) {
        onComplete(fullText, finalMessage.usage);
      }
    } catch (error) {
      console.error('[ClaudeAdapter] streamImageAnalysis error:', error.message);
      console.error('[ClaudeAdapter] Error details:', {
        status: error.status,
        requestID: error.requestID,
        error: error.error,
      });
      if (onError) {
        onError(error);
      } else {
        throw error;
      }
    }
  }
}

module.exports = { ClaudeAdapter };
