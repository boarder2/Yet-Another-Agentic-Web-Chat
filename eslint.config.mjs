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
      '.prettierrc.js',
      'postcss.config.js',
      'tailwind.config.ts',
    ],
  },
  ...nextConfig,
  ...nextTypeScriptConfig,
  prettierConfig,
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
