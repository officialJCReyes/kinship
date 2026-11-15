// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  // The web app uses the shared package's TypeScript source directly (no build step needed).
  resolve: {
    alias: { '@kinship/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  define: {
    // Shown on the About page. GIT_COMMIT is set by the Docker build.
    __WEB_VERSION__: JSON.stringify(pkg.version),
    __WEB_COMMIT__: JSON.stringify(process.env.GIT_COMMIT ?? 'unknown'),
    __WEB_BUILD_DATE__: JSON.stringify(process.env.BUILD_DATE ?? 'unknown'),
  },
  server: {
    // Development only. In the real stack the nginx web container proxies /api.
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000' } },
  },
  build: { sourcemap: true },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
