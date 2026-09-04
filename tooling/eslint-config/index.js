// @ts-check

// Shared ESLint flat config for the Engram monorepo — the single source of
// truth for lint policy. Written as CommonJS on purpose: every consuming
// package except @engram-ai-memory/cli is CommonJS, and that one ESM package
// picks this array up through Node's default-export interop. Keeping it CJS
// means no package needs a .mjs config or a require(esm) hop.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

/** Build artefacts and vendored trees that must never be linted. */
const ignores = ['dist/**', 'node_modules/**', '.turbo/**', 'coverage/**', '**/*.tsbuildinfo'];

/** @type {import('eslint').Linter.Config[]} */
const config = [
  { ignores },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // TUNED: allowEmptyCatch. Every `no-empty` hit in this repo is a
      // deliberate best-effort cleanup written as `try { … } catch {}` —
      // unlinking a stale pidfile, SIGTERM-ing a child that may already be
      // gone. The empty block IS the intent, and the alternative (a comment
      // in each of them) adds noise without adding a single check.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // TUNED: ignoreReadBeforeAssign. Default `prefer-const` also flags a
      // `let` that is declared, closed over, and only later assigned once —
      // a shape that genuinely cannot become `const` (see the hard-deadline
      // timer in WebhookManager.postJson, read by a `finish` closure defined
      // above the assignment). The plain never-reassigned case still errors.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],

      'no-var': 'error',
    },
  },

  {
    // A .cjs file is CommonJS by definition — `require` is the only import
    // form available to it, so the ESM-import rule cannot apply.
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  {
    // Test files. Vitest injects its globals rather than exporting them, so
    // they are declared here.
    //
    // TUNED: no-explicit-any is off for tests only. Every hit is a partial
    // fixture cast to a full domain type — `{ type: 'semantic', importance:
    // 0.85 } as any` fed to a predicate that only reads two fields. Demanding
    // full objects there would make the tests less readable, not safer.
    // Production sources keep the rule at error.
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.{test,spec}.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
        vitest: 'readonly',
        suite: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

module.exports = config;
