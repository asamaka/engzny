/**
 * LLM Adapter Tests
 * Tests for Claude and Gemini LLM adapters
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

// Mock the Anthropic SDK
const mockStream = {
  on: jest.fn(),
  finalMessage: jest.fn(),
};

const mockClient = {
  messages: {
    create: jest.fn(),
    stream: jest.fn(() => mockStream),
  },
};

jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => mockClient),
}));

const { ClaudeAdapter } = require('../../api/llm/claude');
const { LLMAdapter } = require('../../api/llm/adapter');

describe('LLM Adapters', () => {
  describe('LLMAdapter Base Class', () => {
    it('should not allow direct instantiation', () => {
      expect(() => new LLMAdapter()).toThrow('LLMAdapter is an abstract class');
    });

    it('should require subclasses to implement providerName', () => {
      class TestAdapter extends LLMAdapter {}
      const adapter = new TestAdapter();
      expect(() => adapter.providerName).toThrow('providerName must be implemented');
    });

    it('should require subclasses to implement analyzeImage', async () => {
      class TestAdapter extends LLMAdapter {}
      const adapter = new TestAdapter();
      await expect(adapter.analyzeImage({})).rejects.toThrow('analyzeImage must be implemented');
    });

    it('should require subclasses to implement generateText', async () => {
      class TestAdapter extends LLMAdapter {}
      const adapter = new TestAdapter();
      await expect(adapter.generateText({})).rejects.toThrow('generateText must be implemented');
    });
  });

  describe('ClaudeAdapter', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
      jest.clearAllMocks();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    describe('Initialization', () => {
      it('should initialize with API key from config', () => {
        const adapter = new ClaudeAdapter({ apiKey: 'sk-ant-test123' });
        expect(adapter.apiKey).toBe('sk-ant-test123');
        expect(adapter.providerName).toBe('claude');
      });

      it('should initialize with API key from environment', () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key';
        const adapter = new ClaudeAdapter();
        expect(adapter.apiKey).toBe('sk-ant-env-key');
      });

      it('should throw error if no API key is provided', () => {
        delete process.env.ANTHROPIC_API_KEY;
        expect(() => new ClaudeAdapter()).toThrow('ANTHROPIC_API_KEY is required');
      });

      it('should use default model if not specified', () => {
        const adapter = new ClaudeAdapter({ apiKey: 'sk-ant-test123' });
        expect(adapter.model).toBe('claude-sonnet-4-20250514');
      });

      it('should allow custom model configuration', () => {
        const adapter = new ClaudeAdapter({
          apiKey: 'sk-ant-test123',
          model: 'claude-opus-4-6'
        });
        expect(adapter.model).toBe('claude-opus-4-6');
      });

      it('should use default maxTokens if not specified', () => {
        const adapter = new ClaudeAdapter({ apiKey: 'sk-ant-test123' });
        expect(adapter.maxTokens).toBe(4096);
      });

      it('should allow custom maxTokens configuration', () => {
        const adapter = new ClaudeAdapter({
          apiKey: 'sk-ant-test123',
          maxTokens: 8192
        });
        expect(adapter.maxTokens).toBe(8192);
      });
    });

    describe('Capabilities', () => {
      let adapter;

      beforeEach(() => {
        adapter = new ClaudeAdapter({ apiKey: 'sk-ant-test123' });
      });

      it('should support vision', () => {
        expect(adapter.supportsVision()).toBe(true);
      });

      it('should support structured output', () => {
        expect(adapter.supportsStructuredOutput()).toBe(true);
      });

      it('should support streaming', () => {
        expect(adapter.supportsStreaming()).toBe(true);
      });
    });

    describe('analyzeImage', () => {
      let adapter;

      beforeEach(() => {
        adapter = new ClaudeAdapter({ apiKey: 'sk-ant-test123' });
        mockClient.messages.create.mockResolvedValue({
          content: [{ type: 'text', text: 'Test analysis result' }],
          usage: { input_tokens: 100, output_tokens: 50 },
          model: 'claude-sonnet-4-20250514',
        });
      });

      it('should analyze image with basic prompt', async () => {
        const result = await adapter.analyzeImage({
          imageData: 'base64imagedata',
          mediaType: 'image/png',
          prompt: 'What is in this image?',
        });

        expect(result.text).toBe('Test analysis result');
        expect(result.usage).toBeDefined();
        expect(result.model).toBe('claude-sonnet-4-20250514');
        expect(mockClient.messages.create).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
          })
        );
      });

      it('should handle structured output request', async () => {
        mockClient.messages.create.mockResolvedValue({
          content: [{
            type: 'text',
            text: '```json\n{"key": "value"}\n```'
          }],
          usage: { input_tokens: 100, output_tokens: 50 },
          model: 'claude-sonnet-4-20250514',
        });

        const result = await adapter.analyzeImage({
          imageData: 'base64imagedata',
          mediaType: 'image/png',
          prompt: 'Analyze this',
          responseFormat: { type: 'object', properties: { key: { type: 'string' } } },
        });

        expect(result.text).toContain('json');
        expect(result.structured).toEqual({ key: 'value' });
      });

      it('should handle malformed JSON gracefully', async () => {
        mockClient.messages.create.mockResolvedValue({
          content: [{ type: 'text', text: 'Not valid JSON' }],
          usage: { input_tokens: 100, output_tokens: 50 },
          model: 'claude-sonnet-4-20250514',
        });

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const result = await adapter.analyzeImage({
          imageData: 'base64imagedata',
          mediaType: 'image/png',
          prompt: 'Analyze this',
          responseFormat: { type: 'object' },
        });

        expect(result.structured).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to parse structured response:',
          expect.any(String)
        );

        consoleSpy.mockRestore();
      });

      it('should combine multiple text blocks', async () => {
        mockClient.messages.create.mockResolvedValue({
          content: [
            { type: 'text', text: 'First part' },
            { type: 'text', text: 'Second part' },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
          model: 'claude-sonnet-4-20250514',
        });

        const result = await adapter.analyzeImage({
          imageData: 'base64imagedata',
          mediaType: 'image/png',
          prompt: 'Analyze this',
        });

        expect(result.text).toBe('First part\nSecond part');
      });
    });

    describe('generateText', () => {
      let adapter;

      beforeEach(() => {
        adapter = new ClaudeAdapter({ apiKey: 'sk-ant-test123' });
        mockClient.messages.create.mockResolvedValue({
          content: [{ type: 'text', text: 'Generated response' }],
          usage: { input_tokens: 50, output_tokens: 25 },
          model: 'claude-sonnet-4-20250514',
        });
      });

      it('should generate text from prompt', async () => {
        const result = await adapter.generateText({
          prompt: 'Tell me a joke',
        });

        expect(result.text).toBe('Generated response');
        expect(result.usage).toBeDefined();
        expect(mockClient.messages.create).toHaveBeenCalled();
      });

      it('should include system prompt when provided', async () => {
        await adapter.generateText({
          prompt: 'Hello',
          systemPrompt: 'You are a helpful assistant',
        });

        expect(mockClient.messages.create).toHaveBeenCalledWith(
          expect.objectContaining({
            system: 'You are a helpful assistant',
          })
        );
      });

      it('should include context when provided', async () => {
        await adapter.generateText({
          prompt: 'Continue this',
          context: { previousMessage: 'Hello' },
        });

        const calls = mockClient.messages.create.mock.calls;
        const messageContent = calls[0][0].messages[0].content;
        expect(messageContent).toContain('Context:');
        expect(messageContent).toContain('previousMessage');
      });
    });

    describe('Error Handling', () => {
      let adapter;

      beforeEach(() => {
        adapter = new ClaudeAdapter({ apiKey: 'sk-ant-test123' });
      });

      it('should propagate API errors', async () => {
        const apiError = new Error('API rate limit exceeded');
        apiError.status = 429;
        mockClient.messages.create.mockRejectedValue(apiError);

        await expect(
          adapter.analyzeImage({
            imageData: 'base64imagedata',
            mediaType: 'image/png',
            prompt: 'Analyze',
          })
        ).rejects.toThrow('API rate limit exceeded');
      });

      it('should handle invalid image data', async () => {
        const invalidImageError = new Error('Invalid image data');
        invalidImageError.status = 400;
        mockClient.messages.create.mockRejectedValue(invalidImageError);

        await expect(
          adapter.analyzeImage({
            imageData: 'invalid-data',
            mediaType: 'image/png',
            prompt: 'Analyze',
          })
        ).rejects.toThrow('Invalid image data');
      });
    });
  });

  describe('Streaming', () => {
    let adapter;

    beforeEach(() => {
      adapter = new ClaudeAdapter({ apiKey: 'sk-ant-test123' });
      jest.clearAllMocks();
    });

    describe('streamText', () => {
      it('should call onToken callback for each token', async () => {
        const onToken = jest.fn();
        const onComplete = jest.fn();

        // Setup stream mock
        mockStream.on.mockImplementation((event, callback) => {
          if (event === 'text') {
            callback('Hello ');
            callback('world');
          }
          return mockStream;
        });

        mockStream.finalMessage.mockResolvedValue({
          usage: { input_tokens: 10, output_tokens: 5 },
        });

        await adapter.streamText({
          prompt: 'Say hello',
          onToken,
          onComplete,
        });

        expect(onToken).toHaveBeenCalledTimes(2);
        expect(onToken).toHaveBeenCalledWith('Hello ');
        expect(onToken).toHaveBeenCalledWith('world');
        expect(onComplete).toHaveBeenCalledWith(
          'Hello world',
          expect.objectContaining({ input_tokens: 10 })
        );
      });

      it('should call onError callback on failure', async () => {
        const onError = jest.fn();
        const streamError = new Error('Stream failed');

        mockStream.finalMessage.mockRejectedValue(streamError);

        await adapter.streamText({
          prompt: 'Say hello',
          onError,
        });

        expect(onError).toHaveBeenCalledWith(streamError);
      });
    });

    describe('streamImageAnalysis', () => {
      it('should stream image analysis tokens', async () => {
        const onToken = jest.fn();
        const onComplete = jest.fn();

        mockStream.on.mockImplementation((event, callback) => {
          if (event === 'text') {
            callback('This ');
            callback('is ');
            callback('a ');
            callback('test');
          }
          return mockStream;
        });

        mockStream.finalMessage.mockResolvedValue({
          usage: { input_tokens: 200, output_tokens: 100 },
        });

        await adapter.streamImageAnalysis({
          imageData: 'base64imagedata',
          mediaType: 'image/png',
          prompt: 'Analyze this image',
          onToken,
          onComplete,
        });

        expect(onToken).toHaveBeenCalledTimes(4);
        expect(onComplete).toHaveBeenCalledWith(
          'This is a test',
          expect.objectContaining({ input_tokens: 200 })
        );
      });
    });
  });
});
