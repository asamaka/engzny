/**
 * LLM Provider Factory
 * 
 * Creates and manages LLM adapter instances.
 * Supports multiple providers with a unified interface.
 */

const { LLMAdapter } = require('./adapter');
const { ClaudeAdapter } = require('./claude');
const { PerplexityAdapter } = require('./perplexity');
const { GeminiAdapter } = require('./gemini');

// Registry of available providers
const providers = {
  claude: ClaudeAdapter,
  perplexity: PerplexityAdapter,
  gemini: GeminiAdapter,
};

// Singleton instances cache
const instances = new Map();

/**
 * Create or retrieve an LLM adapter instance
 * @param {string} provider - Provider name ('claude', 'openai', 'perplexity')
 * @param {Object} config - Provider-specific configuration
 * @returns {LLMAdapter}
 */
function getAdapter(provider = 'claude', config = {}) {
  const { traceCollector, requestId, maxIterations, ...adapterConfig } = config;
  const cacheKey = `${provider}:${adapterConfig.model || 'default'}`;
  
  if (instances.has(cacheKey)) {
    return instances.get(cacheKey);
  }
  
  const AdapterClass = providers[provider];
  if (!AdapterClass) {
    throw new Error(`Unknown LLM provider: ${provider}. Available: ${Object.keys(providers).join(', ')}`);
  }
  
  const instance = new AdapterClass(adapterConfig);
  instances.set(cacheKey, instance);
  
  return instance;
}

/**
 * Get the default adapter (Claude for MVP)
 * @param {Object} config - Optional configuration
 * @returns {LLMAdapter}
 */
function getDefaultAdapter(config = {}) {
  const defaultProvider = process.env.DEFAULT_LLM_PROVIDER || 'claude';
  return getAdapter(defaultProvider, config);
}

/**
 * Get a vision-capable adapter
 * @param {Object} config - Optional configuration
 * @returns {LLMAdapter}
 */
function getVisionAdapter(config = {}) {
  // For MVP, Claude is our vision adapter
  const visionProvider = process.env.VISION_LLM_PROVIDER || 'claude';
  const adapter = getAdapter(visionProvider, config);
  
  if (!adapter.supportsVision()) {
    throw new Error(`Provider ${visionProvider} does not support vision`);
  }
  
  return adapter;
}

/**
 * Get a research/deep-dive adapter (Perplexity when configured, else Claude)
 * @param {Object} config - Optional configuration
 * @returns {LLMAdapter}
 */
function getResearchAdapter(config = {}) {
  const researchProvider = process.env.RESEARCH_LLM_PROVIDER ||
    (process.env.PERPLEXITY_API_KEY ? 'perplexity' : 'claude');
  return getAdapter(researchProvider, config);
}

/**
 * Check if Perplexity is available for web-grounded research
 * @returns {boolean}
 */
function isPerplexityAvailable() {
  return !!process.env.PERPLEXITY_API_KEY;
}

/**
 * Register a new provider
 * @param {string} name - Provider name
 * @param {typeof LLMAdapter} AdapterClass - Adapter class
 */
function registerProvider(name, AdapterClass) {
  if (!(AdapterClass.prototype instanceof LLMAdapter)) {
    throw new Error('AdapterClass must extend LLMAdapter');
  }
  providers[name] = AdapterClass;
}

/**
 * List available providers
 * @returns {string[]}
 */
function listProviders() {
  return Object.keys(providers);
}

/**
 * Clear adapter cache (useful for testing)
 */
function clearCache() {
  instances.clear();
}

/**
 * Check if Gemini is available
 * @returns {boolean}
 */
function isGeminiAvailable() {
  return !!process.env.GEMINI_API_KEY;
}

module.exports = {
  LLMAdapter,
  ClaudeAdapter,
  PerplexityAdapter,
  GeminiAdapter,
  getAdapter,
  getDefaultAdapter,
  getVisionAdapter,
  getResearchAdapter,
  isPerplexityAvailable,
  isGeminiAvailable,
  registerProvider,
  listProviders,
  clearCache,
};
