// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, passthroughImageService } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import { BASE, REPO, starlightSidebar } from './scripts/docs.mjs';

// Published under /docs/ on https://kinshiptree.app/ (the Website workflow merges the build into the site).
export default defineConfig({
  site: 'https://kinshiptree.app',
  base: BASE,
  trailingSlash: 'always',
  // No image optimization: it would need sharp and its LGPL libvips binaries (see pnpm-workspace.yaml).
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: 'KinShip docs',
      description: 'Everything you need to run KinShip, the self-hosted family tree, on your own server.',
      logo: {
        light: './src/assets/kinship-logo-horizontal.svg',
        dark: './src/assets/kinship-logo-horizontal-reversed.svg',
        alt: 'KinShip',
        replacesTitle: true,
      },
      favicon: '/icon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      customCss: ['./src/styles/kinship.css'],
      sidebar: starlightSidebar(),
      plugins: [starlightLinksValidator()],
    }),
  ],
});
