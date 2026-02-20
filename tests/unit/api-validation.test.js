/**
 * API Key Validation Tests
 * Tests that API keys are properly validated and secured
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

describe('API Key Validation', () => {
  describe('Claude API Key', () => {
    it('should accept valid Claude API key format', () => {
      const validKey = 'sk-ant-api03-test1234567890test1234567890';
      const isValid = validateClaudeApiKey(validKey);
      expect(isValid).toBe(true);
    });

    it('should reject invalid Claude API key format', () => {
      const invalidKeys = [
        '',
        'invalid-key',
        'sk-wrong-prefix',
        null,
        undefined,
        '12345'
      ];

      invalidKeys.forEach(key => {
        const isValid = validateClaudeApiKey(key);
        expect(isValid).toBe(false);
      });
    });

    it('should reject keys that are too short', () => {
      const shortKey = 'sk-ant-api03-short';
      const isValid = validateClaudeApiKey(shortKey);
      expect(isValid).toBe(false);
    });

    it('should handle whitespace in keys', () => {
      const keyWithSpaces = '  sk-ant-api03-test1234567890test1234567890  ';
      const trimmedValid = validateClaudeApiKey(keyWithSpaces.trim());
      expect(trimmedValid).toBe(true);
    });
  });

  describe('Gemini API Key', () => {
    it('should accept valid Gemini API key format', () => {
      const validKey = 'AIzaSyDtest1234567890abcdefghijklmnopq';
      const isValid = validateGeminiApiKey(validKey);
      expect(isValid).toBe(true);
    });

    it('should reject invalid Gemini API key format', () => {
      const invalidKeys = [
        '',
        'invalid-key',
        'wrong-prefix-1234567890',
        null,
        undefined
      ];

      invalidKeys.forEach(key => {
        const isValid = validateGeminiApiKey(key);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Environment Variable Loading', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should load CLAUDE_API_KEY from environment', () => {
      process.env.CLAUDE_API_KEY = 'sk-ant-api03-test1234567890test1234567890';
      const key = process.env.CLAUDE_API_KEY;
      expect(key).toBe('sk-ant-api03-test1234567890test1234567890');
      expect(validateClaudeApiKey(key)).toBe(true);
    });

    it('should handle missing CLAUDE_API_KEY gracefully', () => {
      delete process.env.CLAUDE_API_KEY;
      const key = process.env.CLAUDE_API_KEY;
      expect(key).toBeUndefined();
    });

    it('should load GEMINI_API_KEY from environment if present', () => {
      process.env.GEMINI_API_KEY = 'AIzaSyDtest1234567890abcdefghijklmnopq';
      const key = process.env.GEMINI_API_KEY;
      expect(key).toBe('AIzaSyDtest1234567890abcdefghijklmnopq');
      expect(validateGeminiApiKey(key)).toBe(true);
    });
  });

  describe('Security', () => {
    it('should not expose API keys in error messages', () => {
      const apiKey = 'sk-ant-api03-secret123456789';

      // Simulate an error that should NOT include the key
      const safeError = sanitizeErrorMessage(
        `API call failed with key ${apiKey}`,
        apiKey
      );

      expect(safeError).not.toContain(apiKey);
      expect(safeError).toContain('***');
    });

    it('should mask API keys in logs', () => {
      const apiKey = 'sk-ant-api03-secret123456789';
      const masked = maskApiKey(apiKey);

      expect(masked).not.toContain(apiKey);
      expect(masked).toMatch(/sk-ant-.*\*{8,}/);
    });
  });
});

// Helper validation functions
function validateClaudeApiKey(key) {
  if (!key || typeof key !== 'string') return false;

  // Claude API keys start with 'sk-ant-' and have sufficient length
  const claudePattern = /^sk-ant-api03-.{20,}$/;
  return claudePattern.test(key);
}

function validateGeminiApiKey(key) {
  if (!key || typeof key !== 'string') return false;

  // Gemini API keys typically start with 'AIzaSy' and have length ~39
  const geminiPattern = /^AIzaSy[a-zA-Z0-9_-]{27,}$/;
  return geminiPattern.test(key);
}

function maskApiKey(key) {
  if (!key || key.length < 12) return '***';
  return key.substring(0, 12) + '*'.repeat(Math.max(8, key.length - 12));
}

function sanitizeErrorMessage(message, apiKey) {
  if (!apiKey) return message;
  return message.replace(new RegExp(apiKey, 'g'), maskApiKey(apiKey));
}

module.exports = {
  validateClaudeApiKey,
  validateGeminiApiKey,
  maskApiKey,
  sanitizeErrorMessage
};
