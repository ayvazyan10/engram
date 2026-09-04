// @ts-check
const node = require('@engram-ai-memory/eslint-config/node.js');

module.exports = [
  ...node,
  {
    // The .mcpb launcher ships as plain CommonJS and runs straight from the
    // bundle under Claude Desktop's Node — there is no build step to turn ESM
    // into something it can load, so `require` is the only import form
    // available to it. This package declares no "type", so every .js file
    // here is CommonJS.
    files: ['**/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
