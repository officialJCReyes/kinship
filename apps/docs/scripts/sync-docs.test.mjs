// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import GithubSlugger from 'github-slugger';
import { DOCS, SIDEBAR } from './docs.mjs';
import { buildPages, rewriteHref, rewriteLinks, toPage } from './sync-docs.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const readText = (path) => readFileSync(join(repoRoot, path), 'utf8');
const kindOf = (path) =>
  existsSync(join(repoRoot, path)) ? (statSync(join(repoRoot, path)).isDirectory() ? 'dir' : 'file') : null;

const ctx = {
  slugBySrc: { 'INSTALL.md': 'install', 'docs/backup-format.md': 'backup-format' },
  kindOf: (path) => (path === 'SECURITY.md' ? 'file' : path === 'docs/decisions' ? 'dir' : null),
};

test('a link to a document that is a page goes to the page, keeping its heading', () => {
  assert.equal(rewriteHref('INSTALL.md#updating', 'UPGRADE.md', ctx), '/docs/install/#updating');
  assert.equal(rewriteHref('../INSTALL.md', 'docs/backup-format.md', ctx), '/docs/install/');
  assert.equal(
    rewriteHref('https://github.com/officialJCReyes/kinship/blob/main/INSTALL.md', 'UPGRADE.md', ctx),
    '/docs/install/',
  );
});

test('a link to another repository file goes to GitHub, a folder to its tree', () => {
  assert.equal(
    rewriteHref('SECURITY.md', 'INSTALL.md', ctx),
    'https://github.com/officialJCReyes/kinship/blob/main/SECURITY.md',
  );
  assert.equal(
    rewriteHref('decisions', 'docs/backup-format.md', ctx),
    'https://github.com/officialJCReyes/kinship/tree/main/docs/decisions',
  );
});

test('outside links and same-page anchors are left alone', () => {
  assert.equal(rewriteHref('https://example.org/x', 'INSTALL.md', ctx), 'https://example.org/x');
  assert.equal(rewriteHref('#updating', 'INSTALL.md', ctx), '#updating');
});

test('a link to a file that is not in the repository stops the build', () => {
  assert.throws(() => rewriteHref('NOPE.md', 'INSTALL.md', ctx), /not in the repository/);
  assert.throws(() => rewriteHref('../../x.md', 'INSTALL.md', ctx), /leaves the repository/);
});

test('links inside fenced code blocks are not touched', () => {
  const text = ['See [a](SECURITY.md).', '```', '[b](NOPE.md)', '```', 'And [c](#top).'].join('\n');
  const out = rewriteLinks(text, 'INSTALL.md', ctx);
  assert.match(out, /\[a\]\(https:\/\/github\.com\/officialJCReyes\/kinship\/blob\/main\/SECURITY\.md\)/);
  assert.match(out, /\[b\]\(NOPE\.md\)/);
});

test('a page gets its title from the first heading, and front matter Starlight accepts', () => {
  const page = toPage(DOCS[0], '# Installing KinShip\n\nHello.\n', ctx);
  assert.match(page, /^---\ntitle: "Installing KinShip"\n/);
  assert.match(page, /editUrl: "https:\/\/github\.com\/officialJCReyes\/kinship\/edit\/main\/INSTALL\.md"/);
  assert.ok(!page.includes('# Installing KinShip'));
  assert.throws(() => toPage(DOCS[0], 'No heading here\n', ctx), /no first-level heading/);
});

test('the real documents build, and every sidebar anchor is a heading that exists', () => {
  const pages = buildPages(readText, kindOf);
  assert.deepEqual(Object.keys(pages).sort(), ['backup-format.md', 'install.md', 'upgrade.md']);
  const ids = {};
  for (const doc of DOCS) {
    const slugger = new GithubSlugger();
    ids[doc.slug] = new Set(
      [...readText(doc.src).replace(/^(```|~~~)[\s\S]*?^\1/gm, '').matchAll(/^#{1,6} (.+)$/gm)].map((m) =>
        slugger.slug(m[1].replace(/[`*_]/g, '')),
      ),
    );
  }
  for (const { items } of SIDEBAR) {
    for (const item of items) {
      if (!item.page) continue;
      assert.ok(ids[item.page], `sidebar "${item.label}" names an unknown page ${item.page}`);
      if (item.anchor) {
        assert.ok(
          ids[item.page].has(item.anchor),
          `The sidebar links to "${item.label}" (${item.page}#${item.anchor}), but that heading does not exist`,
        );
      }
    }
  }
});
