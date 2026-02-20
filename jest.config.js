/** @type {import('jest').Config} */
const jestConfig = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'json'],
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {},
  verbose: true
};

export default jestConfig;
