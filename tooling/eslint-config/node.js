// @ts-check

// Shared config + Node.js globals. Used by every package that runs on the
// server or in the terminal.
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
      globals: { ...globals.node },
    },
  },
];

module.exports = config;
