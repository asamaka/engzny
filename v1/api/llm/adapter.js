/**
 * LLM Adapter Interface
 * 
 * Abstract base class for LLM provider implementations.
 * Supports image analysis, text generation, and streaming.
 */

class LLMAdapter {
  constructor(config = {}) {
    if (new.target === LLMAdapter) {
      throw new Error('LLMAdapter is an abstract class and cannot be instantiated directly');
    }
    this.config = config;
  }

  /**
   * Get the provider name
   * @returns {string}
   */
  get providerName() {
    throw new Error('providerName must be implemented');
  }

  /**
   * Analyze an image with a prompt
   * @param {Object} options
   * @param {string} options.imageData - Base64 encoded image data
   * @param {string} options.mediaType - MIME type (image/jpeg, image/png, etc.)
   * @param {string} options.prompt - Analysis prompt
   * @param {Object} options.responseFormat - Optional JSON schema for structured output
   * @returns {Promise<{text: string, structured?: Object, usage?: Object}>}
   */
  async analyzeImage({ imageData, mediaType, prompt, responseFormat }) {
    throw new Error('analyzeImage must be implemented');
  }

  /**
   * Generate text from a prompt
   * @param {Object} options
   * @param {string} options.prompt - The prompt
   * @param {string} options.systemPrompt - Optional system prompt
   * @param {Object} options.context - Optional context object
   * @returns {Promise<{text: string, usage?: Object}>}
   */
  async generateText({ prompt, systemPrompt, context }) {
    throw new Error('generateText must be implemented');
  }

  /**
   * Stream text generation with token callbacks
   * @param {Object} options
   * @param {string} options.prompt - The prompt
   * @param {string} options.systemPrompt - Optional system prompt
   * @param {Object} options.context - Optional context object
   * @param {Function} options.onToken - Callback for each token: (token: string) => void
   * @param {Function} options.onComplete - Callback when complete: (fullText: string, usage: Object) => void
   * @param {Function} options.onError - Callback for errors: (error: Error) => void
   * @returns {Promise<void>}
   */
  async streamText({ prompt, systemPrompt, context, onToken, onComplete, onError }) {
    throw new Error('streamText must be implemented');
  }

  /**
   * Stream image analysis with token callbacks
   * @param {Object} options
   * @param {string} options.imageData - Base64 encoded image data
   * @param {string} options.mediaType - MIME type
   * @param {string} options.prompt - Analysis prompt
   * @param {Function} options.onToken - Callback for each token
   * @param {Function} options.onComplete - Callback when complete
   * @param {Function} options.onError - Callback for errors
   * @returns {Promise<void>}
   */
  async streamImageAnalysis({ imageData, mediaType, prompt, onToken, onComplete, onError }) {
    throw new Error('streamImageAnalysis must be implemented');
  }

  /**
   * Check if the adapter supports vision/image analysis
   * @returns {boolean}
   */
  supportsVision() {
    return false;
  }

  /**
   * Check if the adapter supports structured JSON output
   * @returns {boolean}
   */
  supportsStructuredOutput() {
    return false;
  }

  /**
   * Check if the adapter supports streaming
   * @returns {boolean}
   */
  supportsStreaming() {
    return false;
  }
}

module.exports = { LLMAdapter };
