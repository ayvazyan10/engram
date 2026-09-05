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
    // react-three-fiber renders <mesh>, <primitive>, <meshStandardMaterial>
    // and friends — three.js objects, not DOM elements. Their props
    // (object, position, visible, args, attach…) are unknown to
    // eslint-plugin-react, which only knows the HTML/SVG attribute set, so
    // every hit in this directory is a false positive.
    //
    // This used to be scoped to src/components/canvas, which held the one
    // WebGL scene. That scene is gone and the R3F tree now lives in the two
    // 3D plates, so the exemption follows it. Still narrowly scoped: every
    // real DOM component in the app keeps the check.
    files: ['src/components/plates/**/*.{ts,tsx}'],
    rules: { 'react/no-unknown-property': 'off' },
  },
];
