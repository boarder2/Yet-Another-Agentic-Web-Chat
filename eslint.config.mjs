import nextConfig from 'eslint-config-next/core-web-vitals';
import nextTypeScriptConfig from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier';

const config = [
  {
    ignores: [
      '**/.next/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/drizzle/**',
      '**/storage/**',
      '**/uploads/**',
      '**/data/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.prettierrc.js',
      'postcss.config.js',
      'tailwind.config.ts',
    ],
  },
  ...nextConfig,
  ...nextTypeScriptConfig,
  prettierConfig,
  {
    // e2e/ uses Playwright fixtures whose `use` callback name collides with
    // the React hooks rule — the rule is irrelevant in test files.
    files: ['e2e/**'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      // Accessibility checks mirroring Microsoft Edge Tools warnings:
      // button-type -> require an explicit type on <button> elements
      'react/button-has-type': 'error',
      // axe/name-role-value -> interactive controls must have discernible text
      'jsx-a11y/control-has-associated-label': 'error',
    },
  },
];

export default config;
