module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testRunner: 'jest-circus/runner',
  moduleNameMapper: {
    '^@actions/github$': '<rootDir>/__mocks__/@actions/github.js',
    '^@actions/http-client$':
      '<rootDir>/node_modules/@actions/core/node_modules/@actions/http-client/lib/index.js'
  },
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  verbose: true
}