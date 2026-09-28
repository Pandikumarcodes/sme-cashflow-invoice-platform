/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json'],
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.integration-spec.js'],
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
};
