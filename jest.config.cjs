/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json'],
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.js'],
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  collectCoverageFrom: ['src/**/*.js', '!src/main.js'],
  coverageDirectory: 'coverage',
};
