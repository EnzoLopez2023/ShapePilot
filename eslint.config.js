import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'data/**',
      '.porting-source/**',
      'artifacts/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // The two rules below are React-Compiler-readiness advice rather than
      // correctness checks, and both conflict with behaviour this app is
      // required to preserve exactly.
      //
      // `refs`: the ported undo/redo hook keeps its history stacks in refs and
      // reads their lengths during render, behind an explicit re-render trigger.
      // Moving them to state would change when the toolbar buttons enable and
      // would re-run the 50-entry history array on every keystroke.
      //
      // `set-state-in-effect`: loading data on mount legitimately flips a
      // loading flag inside the effect before awaiting. That is what drives the
      // explicit loading state the accessibility requirements ask for.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',

      'react-refresh/only-export-components': ['warn', {
        allowConstantExport: true,
        // Provider modules deliberately export their own consumer hook.
        allowExportNames: ['useThemeMode', 'useConfirm', 'useAudit'],
      }],
    },
  },
  {
    files: [
      'server/**/*.ts',
      'lib/**/*.ts',
      'scripts/**/*.{ts,mjs}',
      'test/**/*.{ts,mjs}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
)
