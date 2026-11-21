// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The documents that become pages, and the sidebar. Shared by the sync script, astro.config.mjs and the tests, so the
// sidebar's links into a page can be checked against the headings that are really there.

export const REPO = 'https://github.com/officialJCReyes/kinship';
/** Where the docs are published: the Starlight `base`. */
export const BASE = '/docs';

/** The repository files that become pages. `slug` is the page's address under /docs/. */
export const DOCS = [
  {
    src: 'INSTALL.md',
    slug: 'install',
    description:
      'Install KinShip with Docker Compose, set it up, put it behind a reverse proxy, update it, and back it up and restore it.',
  },
  {
    src: 'UPGRADE.md',
    slug: 'upgrade',
    description: 'What to do, release by release, when you move to a new KinShip version.',
  },
  {
    src: 'docs/backup-format.md',
    slug: 'backup-format',
    description: 'How a KinShip backup file is built, so it can be opened without KinShip.',
  },
];

/**
 * The sidebar, in the shape Starlight takes, except that `page` (a slug above) and `anchor` (a heading id on that page)
 * stand in for `link`, so the anchors can be checked. `href` is an outside link.
 */
export const SIDEBAR = [
  {
    label: 'Getting started',
    items: [
      { label: 'Install guide', page: 'install' },
      { label: 'First-run setup', page: 'install', anchor: '5-first-run-create-your-account' },
      { label: 'Reverse proxy', page: 'install', anchor: 'behind-a-reverse-proxy' },
      { label: 'Inviting people', page: 'install', anchor: 'inviting-people' },
    ],
  },
  {
    label: 'Running KinShip',
    items: [
      { label: 'Updating', page: 'install', anchor: 'updating' },
      { label: 'Upgrade notes', page: 'upgrade' },
      { label: 'Backup and restore', page: 'install', anchor: 'back-up-and-restore' },
      { label: 'Backup file format', page: 'backup-format' },
      { label: 'Troubleshooting', page: 'install', anchor: 'something-wrong' },
    ],
  },
  {
    label: 'Contributing',
    items: [
      { label: 'Contributing', href: `${REPO}/blob/main/CONTRIBUTING.md` },
      { label: 'Architecture decisions', href: `${REPO}/tree/main/docs/decisions` },
      { label: 'Changelog', href: `${REPO}/blob/main/CHANGELOG.md` },
    ],
  },
];

/** The sidebar as Starlight's `sidebar` option wants it. */
export function starlightSidebar() {
  return SIDEBAR.map(({ label, items }) => ({
    label,
    items: items.map((item) => ({
      label: item.label,
      link: item.href ?? `/${item.page}/${item.anchor ? `#${item.anchor}` : ''}`,
    })),
  }));
}
