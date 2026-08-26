module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testRunner: 'jest-circus/runner',
  moduleNameMapper: {
    '^@actions/github$': '<rootDir>/__mocks__/@actions/github.js'
  },
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  verbose: true
}