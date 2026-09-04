// @ts-check
// Flat config. CommonJS to match this package's module type.
const node = require('@engram-ai-memory/eslint-config/node.js');

module.exports = [
  ...node,
  {
    // This worker's stdout is a line-delimited IPC protocol that the parent
    // test parses — `console.log` here is the transport, not debug output.
    files: ['src/sync/__tests__/deviceId-race-worker.cjs'],
    rules: { 'no-console': 'off' },
  },
];
