// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DOCS, SIDEBAR, buildDocsPages, pandocAvailable, rewriteHref, shapeBody } from './build-docs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/officialJCReyes/kinship';
const files = new Set(['CONTRIBUTING.md', 'SECURITY.md', 'docs/backup/kinship-decrypt.mjs']);
const dirs = new Set(['docs/decisions']);
const ctx = {
  slugBySrc: { 'INSTALL.md': 'install', 'UPGRADE.md': 'upgrade', 'docs/backup-format.md': 'backup-format' },
  kindOf: (path) => (files.has(path) ? 'file' : dirs.has(path) ? 'dir' : null),
};

test('a link to a document that becomes a page goes to that page, keeping its heading', () => {
  assert.equal(rewriteHref('UPGRADE.md', 'INSTALL.md', ctx), '{{DOCS}}upgrade/');
  assert.equal(rewriteHref('INSTALL.md#updating', 'UPGRADE.md', ctx), '{{DOCS}}install/#updating');
  assert.equal(rewriteHref('../INSTALL.md#updating', 'docs/backup-format.md', ctx), '{{DOCS}}install/#updating');
  assert.equal(rewriteHref('docs/backup-format.md', 'INSTALL.md', ctx), '{{DOCS}}backup-format/');
});

test('an absolute GitHub link to a page document also goes to the page', () => {
  assert.equal(rewriteHref(`${REPO}/blob/main/UPGRADE.md#020`, 'CHANGELOG.md', ctx), '{{DOCS}}upgrade/#020');
  assert.equal(rewriteHref(`${REPO}/blob/main/CHANGELOG.md`, 'INSTALL.md', ctx), `${REPO}/blob/main/CHANGELOG.md`);
});

test('any other repository file links to GitHub, folders to tree', () => {
  assert.equal(rewriteHref('SECURITY.md', 'INSTALL.md', ctx), `${REPO}/blob/main/SECURITY.md`);
  assert.equal(
    rewriteHref('backup/kinship-decrypt.mjs', 'docs/backup-format.md', ctx),
    `${REPO}/blob/main/docs/backup/kinship-decrypt.mjs`,
  );
  assert.equal(rewriteHref('decisions/', 'docs/backup-format.md', ctx), `${REPO}/tree/main/docs/decisions`);
});

test('outside links and same-page anchors are left alone', () => {
  for (const href of ['https://example.com/a?b=c#d', 'mailto:a@example.com', '#updating']) {
    assert.equal(rewriteHref(href, 'INSTALL.md', ctx), href);
  }
});

test('a link to a file that is not in the repository stops the build', () => {
  assert.throws(() => rewriteHref('MISSING.md', 'INSTALL.md', ctx), /MISSING\.md, which is not in the repository/);
  assert.throws(() => rewriteHref('../../etc/passwd', 'INSTALL.md', ctx), /leaves the repository/);
});

test('shapeBody takes the heading out, styles code blocks and tables, and lists the h2 headings', () => {
  const html = [
    '<h1 id="t">Installing <code>KinShip</code></h1>',
    '<h2 id="one">1. One</h2>',
    '<pre class="sh"><code>echo hi\n</code></pre>',
    '<table><tr><td>x</td></tr></table>',
    '<h2 id="two">Two &amp; more</h2>',
    '<p><a href="UPGRADE.md#x">up</a></p>',
  ].join('\n');
  const out = shapeBody(html, 'INSTALL.md', ctx);
  assert.equal(out.title, 'Installing KinShip');
  assert.ok(!out.body.includes('<h1'));
  assert.ok(out.body.includes('<pre class="code">'));
  assert.ok(out.body.includes('<div class="tbl"><table>'));
  assert.ok(out.body.includes('href="{{DOCS}}upgrade/#x"'));
  assert.deepEqual(out.toc, [
    { id: 'one', text: '1. One' },
    { id: 'two', text: 'Two & more' },
  ]);
  assert.ok(out.ids.has('one') && out.ids.has('two'));
});

// The real documents. This needs pandoc; the CI job installs it, so a missing pandoc there is a failure, not a skip.
const havePandoc = pandocAvailable();
test('pandoc is installed in CI', () => {
  if (process.env.CI) assert.ok(havePandoc, 'install pandoc in this job (apt-get install pandoc)');
});

test('the real INSTALL, UPGRADE and backup-format documents build into pages', { skip: !havePandoc }, () => {
  const pages = buildDocsPages({
    readText: (path) => readFileSync(join(root, path), 'utf8'),
    kindOf: (path) => {
      try {
        return statSync(join(root, path)).isDirectory() ? 'dir' : 'file';
      } catch {
        return null;
      }
    },
  });
  assert.deepEqual(Object.keys(pages).sort(), [
    'docs/backup-format/index.html',
    'docs/index.html',
    'docs/install/index.html',
    'docs/upgrade/index.html',
  ]);
  for (const [path, html] of Object.entries(pages)) {
    assert.ok(!html.includes('{{'), `${path} has an unfilled token`);
    assert.ok(html.includes('@@VERSION@@'), `${path}: the Website workflow fills the version in the footer`);
    assert.ok(
      !/href="(?![a-z]+:|#|\.{1,2}\/)[^"]*\.md/.test(html),
      `${path} links to a Markdown file that is not on the site`,
    );
  }
  // The page is the document itself: one h2 on the page for every "## " heading in the file (outside code blocks).
  for (const doc of DOCS) {
    let fenced = false;
    const headings = readFileSync(join(root, doc.src), 'utf8')
      .split('\n')
      .filter((line) => {
        if (line.startsWith('```')) fenced = !fenced;
        return !fenced && line.startsWith('## ');
      });
    const page = pages[`docs/${doc.slug}/index.html`];
    assert.equal((page.match(/<h2 id=/g) ?? []).length, headings.length, `${doc.src}: headings on the page`);
  }
  assert.ok(pages['docs/install/index.html'].includes('aria-current="page" href="../install/"'));
  assert.ok(pages['docs/upgrade/index.html'].includes('aria-current="page" href="../upgrade/"'));
  for (const doc of DOCS) assert.ok(pages[`docs/${doc.slug}/index.html`].includes(`/blob/main/${doc.src}`));
});

test('every sidebar entry names a page that exists', () => {
  const slugs = new Set(DOCS.map((doc) => doc.slug));
  for (const { items } of SIDEBAR) for (const item of items) assert.ok(item.href || slugs.has(item.page), item.label);
});
