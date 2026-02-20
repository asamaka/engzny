/**
 * API Health Check Tests
 * Simple tests that ping the real API to verify tokens work
 */

const { describe, it, expect } = require('@jest/globals');
const Anthropic = require('@anthropic-ai/sdk').default;

describe('API Health Checks', () => {
  describe('Claude API Token', () => {
    it('should have a valid working Claude API token', async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

      if (!apiKey) {
        console.warn('⚠️  No CLAUDE_API_KEY found - skipping health check');
        return;
      }

      const client = new Anthropic({ apiKey });

      // Make a cheap test call with Haiku (fastest/cheapest model)
      const response = await client.messages.create({
        model: 'claude-haiku-3-5-20250226',
        max_tokens: 10, // Minimal tokens to keep cost low
        messages: [
          {
            role: 'user',
            content: 'hi',
          },
        ],
      });

      // Verify we got a valid response
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.content[0].type).toBe('text');
      expect(response.usage).toBeDefined();
      expect(response.usage.input_tokens).toBeGreaterThan(0);
      expect(response.usage.output_tokens).toBeGreaterThan(0);

      console.log('✅ Claude API token is valid and working!');
      console.log(`   Model: ${response.model}`);
      console.log(`   Tokens used: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`);
    }, 15000); // 15 second timeout for API call

    it('should detect invalid Claude API token', async () => {
      const invalidKey = 'sk-ant-api03-invalid-key-that-will-fail';
      const client = new Anthropic({ apiKey: invalidKey });

      await expect(
        client.messages.create({
          model: 'claude-haiku-3-5-20250226',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        })
      ).rejects.toThrow();

      console.log('✅ Invalid token correctly rejected');
    }, 10000);
  });

  describe('Claude Vision API', () => {
    it('should have working vision capabilities with valid token', async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

      if (!apiKey) {
        console.warn('⚠️  No CLAUDE_API_KEY found - skipping vision health check');
        return;
      }

      const client = new Anthropic({ apiKey });

      // Create a minimal 1x1 red pixel PNG image
      const redPixelBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

      const response = await client.messages.create({
        model: 'claude-haiku-3-5-20250226',
        max_tokens: 20,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: redPixelBase64,
                },
              },
              {
                type: 'text',
                text: 'What color?',
              },
            ],
          },
        ],
      });

      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content[0].type).toBe('text');

      console.log('✅ Claude Vision API is working!');
      console.log(`   Response: ${response.content[0].text.substring(0, 50)}...`);
      console.log(`   Tokens used: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`);
    }, 20000); // 20 second timeout for vision API call
  });
});
