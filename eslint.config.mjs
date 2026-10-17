// ESLint flat configuration, My Shop.
//
// Master Plan §7.1 makes lint a CI gate rather than advice, and §14 of the
// authorization makes strict TypeScript non-negotiable. The type-aware rules
// below are the ones that catch defects this codebase actually cares about:
// unhandled promises (a partially applied financial posting is a data-integrity
// bug), floating promises, and accidental `any` (the master plan's §30.1 integer
// money rule is defeated the moment money becomes `any`).

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.tsbuildinfo'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Correctness.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      // Money and tenant identity must never be `any`. Master Plan §30.1 and §9.3.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',

      // The master plan's strictness flags are enforced by the compiler, not the
      // linter. These entries exist so a linter suppression cannot quietly
      // reintroduce what the compiler forbids.
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    // The backend integration tree is outside `tsconfig.json`'s `include`, because the
    // build config emits into `dist/` and test sources must never reach the shipped
    // process. Without this project assignment the type-aware rules below cannot parse
    // them, which would silently drop `services/api/test/**` out of Master Plan §37.2
    // stage 3 — the gate would still be "green" while linting nothing.
    files: ['services/api/test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // `projectService` is switched off explicitly here. Flat config deep-merges
        // `parserOptions`, so the shared `projectService: true` from the block above would
        // otherwise survive alongside `project`, and typescript-eslint rejects having
        // both.
        projectService: false,
        project: './services/api/tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Tests assert outcomes, not implementation, and legitimately reach for
    // loosely typed fixtures. Strictness still applies to `any`.
    files: ['**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);