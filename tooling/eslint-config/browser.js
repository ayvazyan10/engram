// @ts-check

// Shared config + browser globals. Used by the web dashboard, which also
// layers React rules on top in its own eslint.config.js.
const globals = require('globals');
const base = require('./index.js');

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...base,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
];

module.exports = config;
