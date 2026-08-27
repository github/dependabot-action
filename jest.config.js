module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testRunner: 'jest-circus/runner',
  moduleNameMapper: {
    '^@actions/github$': '<rootDir>/__mocks__/@actions/github.js',
    '^@actions/core$': '<rootDir>/node_modules/@actions/core',
    '^@actions/exec$': '<rootDir>/node_modules/@actions/exec',
    '^@actions/http-client$': '<rootDir>/node_modules/@actions/http-client',
    '^@actions/http-client/lib/(.*?)(?:\\.js)?$':
      '<rootDir>/node_modules/@actions/http-client/lib/$1.js',
    '^@actions/io$': '<rootDir>/node_modules/@actions/io',
    '^@actions/io/lib/(.*?)(?:\\.js)?$':
      '<rootDir>/node_modules/@actions/io/lib/$1.js'
  },
  transformIgnorePatterns: ['/node_modules/(?!@actions/(core|exec|http-client|io)/)'],
  transform: {
    '^.+\\.[jt]s$': ['ts-jest', {tsconfig: {allowJs: true, module: 'commonjs'}}]
  },
  verbose: true
}