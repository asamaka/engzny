#!/usr/bin/env node
/**
 * API Key Validator
 * Tests all API connections to ensure they're working
 */

require('dotenv').config();

const GEMINI_TEST_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function validateGeminiKey() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      status: 'error',
      message: 'GEMINI_API_KEY is not set in .env file',
      hint: 'Get your free API key from: https://ai.google.dev/',
    };
  }

  try {
    const response = await fetch(`${GEMINI_TEST_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: 'Hello' }]
        }]
      })
    });

    if (response.status === 400 && response.statusText.includes('API key')) {
      return {
        status: 'error',
        message: 'Invalid API key',
        hint: 'Please check your GEMINI_API_KEY in .env file',
      };
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return {
        status: 'error',
        message: `Gemini API error: ${error.error?.message || response.statusText}`,
        hint: 'Check your API key and quota',
      };
    }

    const data = await response.json();
    return {
      status: 'success',
      message: 'Gemini API is working!',
      model: 'gemini-2.5-flash',
      response: data.candidates?.[0]?.content?.parts?.[0]?.text || 'OK',
    };
  } catch (error) {
    return {
      status: 'error',
      message: 'Network error connecting to Gemini',
      hint: error.message,
    };
  }
}

async function validateAnthropicKey() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      status: 'skip',
      message: 'ANTHROPIC_API_KEY not set (optional)',
    };
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk').default;
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    });

    return {
      status: 'success',
      message: 'Anthropic API is working!',
      model: response.model,
    };
  } catch (error) {
    return {
      status: 'error',
      message: 'Anthropic API error',
      hint: error.message,
    };
  }
}

async function main() {
  console.log('🔑 API Key Validation\n');
  console.log('=' .repeat(50));

  // Test Gemini (Required)
  console.log('\n📊 GEMINI API (Required for analysis)');
  console.log('-'.repeat(50));
  const geminiResult = await validateGeminiKey();

  if (geminiResult.status === 'success') {
    console.log('✅ Status:', geminiResult.message);
    console.log('📦 Model:', geminiResult.model);
    console.log('💬 Test response:', geminiResult.response.substring(0, 50) + '...');
  } else {
    console.log('❌ Status:', geminiResult.message);
    if (geminiResult.hint) {
      console.log('💡 Hint:', geminiResult.hint);
    }
  }

  // Test Anthropic (Optional)
  console.log('\n🤖 ANTHROPIC API (Optional alternative)');
  console.log('-'.repeat(50));
  const anthropicResult = await validateAnthropicKey();

  if (anthropicResult.status === 'success') {
    console.log('✅ Status:', anthropicResult.message);
    console.log('📦 Model:', anthropicResult.model);
  } else if (anthropicResult.status === 'skip') {
    console.log('⚠️  Status:', anthropicResult.message);
  } else {
    console.log('❌ Status:', anthropicResult.message);
    if (anthropicResult.hint) {
      console.log('💡 Hint:', anthropicResult.hint);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('\n📋 SUMMARY');
  console.log('-'.repeat(50));

  const canAnalyze = geminiResult.status === 'success';

  if (canAnalyze) {
    console.log('✅ Ready to analyze screenshots!');
    console.log('🚀 Start server: npm start');
    console.log('🌐 Visit: http://localhost:3000');
  } else {
    console.log('❌ Cannot analyze screenshots yet');
    console.log('\n📝 TO DO:');
    console.log('1. Get API key from: https://ai.google.dev/');
    console.log('2. Add to .env file: GEMINI_API_KEY=your_key_here');
    console.log('3. Run this script again: node scripts/validate-api-keys.js');
  }

  console.log('\n');
  process.exit(canAnalyze ? 0 : 1);
}

main().catch(console.error);
