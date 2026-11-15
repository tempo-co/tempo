import {FlatCompat} from '@eslint/eslintrc';
import js from '@eslint/js';
import reactRefresh from 'eslint-plugin-react-refresh';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  ...compat.config({
    env: {browser: true, es2020: true},
    settings: {
      react: {
        version: 'detect',
      },
    },
    extends: [
      'eslint:recommended',
      'plugin:@tanstack/eslint-plugin-query/recommended',
      'plugin:@typescript-eslint/recommended-type-checked',
      'plugin:react-hooks/recommended',
      'plugin:react/recommended',
      'plugin:react/jsx-runtime',
      'prettier',
    ],
    overrides: [
      {
        extends: ['plugin:@typescript-eslint/disable-type-checked'],
        files: ['./**/*.js'],
      },
    ],
    ignorePatterns: ['dist', '.eslintrc.cjs', 'eslint.config.js'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      project: ['./tsconfig.app.json', './tsconfig.node.json'],
      tsconfigRootDir: __dirname,
    },
    rules: {
      // Async JSX handlers are fine: React ignores the returned promise.
      '@typescript-eslint/no-misused-promises': ['error', {checksVoidReturn: {attributes: false}}],
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
      // TanStack Router redirects and not-found responses are thrown objects (`throw redirect()`).
      '@typescript-eslint/only-throw-error': 'off',
      // Only reports what the React Compiler would skip memoizing (react-hook-form's `watch`); the compiler isn't used.
      'react-hooks/incompatible-library': 'off',
      // TypeScript checks props; the rule misreads typed forwarded props (`components/ui/calendar.tsx`).
      'react/prop-types': 'off',
    },
  }),
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {'react-refresh': reactRefresh},
    rules: {
      'react-refresh/only-export-components': ['warn', {allowConstantExport: true}],
    },
  },
  {
    files: ['src/routes/**/*.{ts,tsx}'],
    rules: {
      // Route files export `Route` next to their components; TanStack Router splits them.
      'react-refresh/only-export-components': 'off',
    },
  },
];
