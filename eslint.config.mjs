// SPDX-License-Identifier: AGPL-3.0-or-later
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['e2e/artifacts/', 'e2e/.stack/', '**/node_modules/', '**/dist/', 'design/', 'pnpm-lock.yaml', 'reports/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
  },
  {
    // The web app runs in the browser (its tests run in jsdom).
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        __WEB_VERSION__: 'readonly',
        __WEB_COMMIT__: 'readonly',
        __WEB_BUILD_DATE__: 'readonly',
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // The project website's script runs in the browser.
    files: ['site/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
