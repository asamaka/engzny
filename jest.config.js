/**
 * Jest Configuration
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Test match patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/__tests__/**/*.js',
  ],

  // Coverage settings
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'api/**/*.js',
    '!api/index.js',
    '!**/node_modules/**',
    '!**/tests/**',
  ],

  // Coverage thresholds (optional - uncomment to enforce)
  // coverageThresholds: {
  //   global: {
  //     branches: 70,
  //     functions: 70,
  //     lines: 70,
  //     statements: 70,
  //   },
  // },

  // Transform settings (for ES6 modules if needed)
  transform: {},

  // Module file extensions
  moduleFileExtensions: ['js', 'json', 'node'],

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Restore mocks between tests
  restoreMocks: true,

  // Timeout for tests (10 seconds)
  testTimeout: 10000,
};
