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
  {
    // react-three-fiber renders <mesh>, <pointLight>, <meshStandardMaterial>
    // and friends — three.js objects, not DOM elements. Their props
    // (position, intensity, emissive, args, attach…) are unknown to
    // eslint-plugin-react, which only knows the HTML/SVG attribute set, so
    // every one of the 90 hits in this directory was a false positive.
    // Scoped to the R3F tree: real DOM components keep the check.
    files: ['src/components/canvas/**/*.{ts,tsx}'],
    rules: { 'react/no-unknown-property': 'off' },
  },
];
