// @ts-check
// Flat config. This package is "type": "module", so this file is ESM; the
// shared config is CommonJS and arrives through Node's default-export interop.
import node from '@engram-ai-memory/eslint-config/node.js';

export default [
  ...node,
  {
    // The CLI's stdout IS its user interface — `console.log` is how every
    // command renders its result. Silencing it here rather than in the source.
    files: ['src/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
