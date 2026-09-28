/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json'],
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.js'],
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  setupFiles: ['<rootDir>/test/setup-env.js'],
};
