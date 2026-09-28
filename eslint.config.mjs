import eslint from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          plugins: [
            ['@babel/plugin-proposal-decorators', { legacy: true }],
            ['@babel/plugin-transform-class-properties', { loose: true }],
          ],
        },
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
];
