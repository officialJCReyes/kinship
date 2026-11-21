// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, passthroughImageService } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

// Published under /docs/ on https://kinshiptree.app/ (the Website workflow merges the build into the site).
export default defineConfig({
  site: 'https://kinshiptree.app',
  base: '/docs',
  trailingSlash: 'always',
  // No image optimization: it would need sharp and its LGPL libvips binaries (see pnpm-workspace.yaml).
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: 'KinShip docs',
      plugins: [starlightLinksValidator()],
    }),
  ],
});
