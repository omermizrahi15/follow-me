module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
  },
  plugins: [
    '@typescript-eslint',
    'import',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  rules: {
    // ── TypeScript safety ──────────────────────────────────────────
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',          // no foo!
    '@typescript-eslint/no-unnecessary-condition': 'error',
    '@typescript-eslint/no-floating-promises': 'error',           // must await or handle promises
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/prefer-nullish-coalescing': 'error',      // ?? over ||
    '@typescript-eslint/prefer-optional-chain': 'error',          // ?. over && chains
    '@typescript-eslint/consistent-type-imports': 'error',        // import type { Foo }
    '@typescript-eslint/explicit-function-return-type': ['error', {
      allowExpressions: true,
      allowTypedFunctionExpressions: true,
    }],

    // ── Clean architecture boundaries ──────────────────────────────
    // Domain must not import from any other layer
    'import/no-restricted-paths': ['error', {
      zones: [
        {
          target: './src/domain',
          from: './src/application',
          message: 'Domain must not import from application layer.',
        },
        {
          target: './src/domain',
          from: './src/infrastructure',
          message: 'Domain must not import from infrastructure layer.',
        },
        {
          target: './src/domain',
          from: './src/ui',
          message: 'Domain must not import from UI layer.',
        },
        // Application must not import from infrastructure or UI
        {
          target: './src/application',
          from: './src/infrastructure',
          message: 'Application layer must not import from infrastructure. Use interfaces.',
        },
        {
          target: './src/application',
          from: './src/ui',
          message: 'Application layer must not import from UI layer.',
        },
        // UI must not import from infrastructure directly
        {
          target: './src/ui',
          from: './src/infrastructure',
          message: 'UI must not import from infrastructure directly. Use hooks that call use cases.',
        },
        // UI must not import use cases directly — must go through hooks
        {
          target: './src/ui/screens',
          from: './src/application/usecases',
          message: 'Screens must not import use cases directly. Use a hook instead.',
        },
        {
          target: './src/ui/components',
          from: './src/application',
          message: 'Components must not import from the application layer.',
        },
      ],
    }],
  },
  overrides: [
    // Relax some rules for test files
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.integration.test.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
