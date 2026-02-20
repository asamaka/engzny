/**
 * Jest Setup File
 * Global configuration and setup for all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';

// Mock console methods to reduce noise during tests
// (uncomment if you want cleaner test output)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };

// Increase test timeout for API calls (if needed)
jest.setTimeout(10000);

// Global test helpers
global.createMockBase64Image = () => {
  // Returns a minimal valid base64 PNG (1x1 transparent pixel)
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
};

global.createMockApiKey = (provider = 'claude') => {
  if (provider === 'claude') {
    return 'sk-ant-api03-' + 'test'.repeat(10);
  } else if (provider === 'gemini') {
    return 'AIzaSy' + 'test'.repeat(8);
  }
  return 'mock-api-key';
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

console.log('✓ Jest setup complete');
