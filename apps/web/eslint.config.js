// @ts-check
const browser = require('@engram-ai-memory/eslint-config/browser.js');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = [
  ...browser,
  {
    ...react.configs.flat.recommended,
    files: ['src/**/*.{ts,tsx}'],
    settings: { react: { version: 'detect' } },
  },
  {
    ...react.configs.flat['jsx-runtime'],
    files: ['src/**/*.{ts,tsx}'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
