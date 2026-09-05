// Lightweight config for pure-logic unit tests (no RN runtime needed).
// The extractToken parser is plain TS; running it under the full jest-expo
// preset would drag in RN's Flow-typed setup, which the monorepo's transform
// pipeline does not handle. Component/integration tests that need the native
// runtime should use jest-expo in a separate project config.
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': ['babel-jest', { presets: ['babel-preset-expo'] }],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
};
