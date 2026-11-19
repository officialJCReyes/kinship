// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Builds the Docs section of the project website from the Markdown files in the repository, so the site can never
// disagree with them (ADR 0023). Usage: node scripts/build-docs.mjs <site-folder>   (the Website workflow passes _site).
// It writes <site-folder>/docs/index.html and <site-folder>/docs/<slug>/index.html, in the site's own page template.
// It needs pandoc (apt install pandoc) and nothing else. It fails, rather than publishing a broken page, when a link in
// a source file points at a file that does not exist or at a heading that is not there.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/officialJCReyes/kinship';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The repository files that become pages. `slug` is the folder under /docs/. */
export const DOCS = [
  {
    src: 'INSTALL.md',
    slug: 'install',
    group: 'Getting started',
    description:
      'Install KinShip with Docker Compose, set it up, put it behind a reverse proxy, update it, and back it up and restore it.',
  },
  {
    src: 'UPGRADE.md',
    slug: 'upgrade',
    group: 'Running KinShip',
    description: 'What to do, release by release, when you move to a new KinShip version.',
  },
  {
    src: 'docs/backup-format.md',
    slug: 'backup-format',
    group: 'Running KinShip',
    description: 'How a KinShip backup file is built, so it can be opened without KinShip.',
  },
];

/** The sidebar. `page` is a slug above, `anchor` a heading id on that page (checked at build time), `href` an outside link. */
export const SIDEBAR = [
  {
    group: 'Getting started',
    items: [
      { label: 'Install guide', page: 'install' },
      { label: 'First-run setup', page: 'install', anchor: '5-first-run-create-your-account' },
      { label: 'Reverse proxy', page: 'install', anchor: 'behind-a-reverse-proxy' },
      { label: 'Inviting people', page: 'install', anchor: 'inviting-people' },
    ],
  },
  {
    group: 'Running KinShip',
    items: [
      { label: 'Updating', page: 'install', anchor: 'updating' },
      { label: 'Upgrade notes', page: 'upgrade' },
      { label: 'Backup and restore', page: 'install', anchor: 'back-up-and-restore' },
      { label: 'Backup file format', page: 'backup-format' },
      { label: 'Troubleshooting', page: 'install', anchor: 'something-wrong' },
    ],
  },
  {
    group: 'Contributing',
    items: [
      { label: 'Contributing', href: `${REPO}/blob/main/CONTRIBUTING.md` },
      { label: 'Architecture decisions', href: `${REPO}/tree/main/docs/decisions` },
      { label: 'Changelog', href: `${REPO}/blob/main/CHANGELOG.md` },
    ],
  },
];

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

export function pandocAvailable() {
  try {
    execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** GitHub-flavoured Markdown to HTML. gfm gives the same heading ids GitHub does, so old links to INSTALL.md#... still work. */
export function renderMarkdown(markdown) {
  return execFileSync('pandoc', ['-f', 'gfm', '-t', 'html5', '--no-highlight', '--wrap=none'], {
    input: markdown,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Where a link found in `srcPath` should go on the site. A document that becomes a page links to its page
 * (`{{DOCS}}` stands for the docs folder, filled in per page); any other repository file links to GitHub; a link to a file
 * that is not in the repository throws.
 * @param {string} href
 * @param {string} srcPath  repository path of the document the link is in, for example 'docs/backup-format.md'
 * @param {{ slugBySrc: Record<string, string>, kindOf: (path: string) => 'file' | 'dir' | null }} ctx
 */
export function rewriteHref(href, srcPath, ctx) {
  if (href.startsWith('#')) return href;
  const [target, ...rest] = href.split('#');
  const fragment = rest.length ? `#${rest.join('#')}` : '';
  const github = new RegExp(`^${REPO.replace(/[.]/g, '\\.')}/(?:blob|tree)/main/(.+)$`).exec(target);
  let path;
  if (github) {
    path = github[1].replace(/\/$/, '');
    if (!ctx.slugBySrc[path]) return href;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return href;
  } else {
    path = posix.normalize(posix.join(posix.dirname(srcPath), target)).replace(/\/$/, '');
    if (path.startsWith('..')) throw new Error(`${srcPath}: link "${href}" leaves the repository`);
  }
  if (ctx.slugBySrc[path]) return `{{DOCS}}${ctx.slugBySrc[path]}/${fragment}`;
  const kind = ctx.kindOf(path);
  if (!kind) throw new Error(`${srcPath}: link "${href}" points at ${path}, which is not in the repository`);
  return `${REPO}/${kind === 'dir' ? 'tree' : 'blob'}/main/${path}${fragment}`;
}

/** Turns pandoc's HTML into the markup the site's styles expect, and returns the heading, the body and the contents list. */
export function shapeBody(html, srcPath, ctx) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>\s*/.exec(html);
  const title = h1 ? stripTags(h1[1]).trim() : srcPath;
  let body = h1 ? html.replace(h1[0], '') : html;
  body = body
    .replace(/<a href="([^"]*)"/g, (_whole, href) => {
      const raw = href.replace(/&amp;/g, '&');
      return `<a href="${escapeHtml(rewriteHref(raw, srcPath, ctx))}"`;
    })
    .replace(/<pre(?: class="[^"]*")?>/g, '<pre class="code">')
    .replace(/<table>/g, '<div class="tbl"><table>')
    .replace(/<\/table>/g, '</table></div>');
  const toc = [...body.matchAll(/<h2 id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => ({
    id: m[1],
    text: stripTags(m[2]).trim(),
  }));
  const ids = new Set([...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  return { title, body, toc, ids };
}

function sidebarHtml(currentSlug, ids) {
  const out = [];
  for (const { group, items } of SIDEBAR) {
    out.push(`<div class="sg">${escapeHtml(group)}</div>`);
    for (const item of items) {
      if (item.href) {
        out.push(`<a class="sl" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`);
        continue;
      }
      if (item.anchor && !ids[item.page]?.has(item.anchor)) {
        throw new Error(
          `The sidebar links to "${item.label}" (${item.page}#${item.anchor}), but that heading does not exist`,
        );
      }
      const here = item.page === currentSlug && !item.anchor;
      const href = `{{DOCS}}${item.page}/${item.anchor ? `#${item.anchor}` : ''}`;
      out.push(
        `<a class="sl${here ? ' sa' : ''}"${here ? ' aria-current="page"' : ''} href="${href}">${escapeHtml(item.label)}</a>`,
      );
    }
  }
  return out.join('\n');
}

const fill = (template, values) =>
  Object.entries(values).reduce((page, [key, value]) => page.split(`{{${key}}}`).join(value), template);

function renderPage(template, { depth, ...values }) {
  // depth 1 is /docs/index.html, depth 2 is /docs/<slug>/index.html
  const rootPath = '../'.repeat(depth);
  const docsPath = depth === 1 ? './' : '../';
  return fill(fill(template, values), { ROOT: rootPath, DOCS: docsPath });
}

function tocHtml(toc) {
  if (toc.length < 2) return '';
  const links = toc.map(({ id, text }) => `<a class="ol" href="#${id}">${escapeHtml(text)}</a>`).join('\n');
  return `<nav aria-label="On this page" style="flex:0 0 200px;min-width:0">\n<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5B6A65;font-weight:600;margin-bottom:10px">On this page</div>\n${links}\n</nav>`;
}

/** Builds every docs page and returns them as { 'docs/install/index.html': '<html…' }. Throws on a broken link or anchor. */
export function buildDocsPages({ readText, kindOf }) {
  const template = readText('scripts/site-docs/template.html');
  const slugBySrc = Object.fromEntries(DOCS.map((doc) => [doc.src, doc.slug]));
  const ctx = { slugBySrc, kindOf };
  const shaped = DOCS.map((doc) => ({ doc, ...shapeBody(renderMarkdown(readText(doc.src)), doc.src, ctx) }));
  const ids = Object.fromEntries(shaped.map(({ doc, ids: pageIds }) => [doc.slug, pageIds]));

  // Links between the pages must land on a heading that exists.
  for (const { doc, body } of shaped) {
    for (const [, slug, fragment] of body.matchAll(/href="\{\{DOCS\}\}([a-z-]+)\/#([^"]+)"/g)) {
      if (!ids[slug]?.has(fragment)) throw new Error(`${doc.src} links to ${slug}#${fragment}, which does not exist`);
    }
  }

  const pages = {};
  for (const { doc, title, body, toc } of shaped) {
    pages[`docs/${doc.slug}/index.html`] = renderPage(template, {
      depth: 2,
      TITLE: escapeHtml(`KinShip docs: ${title}`),
      DESCRIPTION: escapeHtml(doc.description),
      SIDEBAR: sidebarHtml(doc.slug, ids),
      CRUMB: `Docs / ${escapeHtml(doc.group)}`,
      H1: escapeHtml(title),
      BODY: body,
      SOURCE: `<p class="src">This page is built from <a href="${REPO}/blob/main/${doc.src}"><code>${escapeHtml(doc.src)}</code></a> in the repository, so it always matches the code. To fix a mistake, <a href="${REPO}/edit/main/${doc.src}">edit that file on GitHub</a>.</p>`,
      TOCNAV: tocHtml(toc),
    });
  }
  pages['docs/index.html'] = renderPage(template, {
    depth: 1,
    TITLE: 'KinShip docs',
    DESCRIPTION: 'How to install, update, back up and restore KinShip.',
    SIDEBAR: sidebarHtml(null, ids),
    CRUMB: 'Docs',
    H1: 'Documentation',
    BODY: readText('scripts/site-docs/index.body.html'),
    SOURCE: '',
    TOCNAV: '',
  });
  return pages;
}

function main() {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: node scripts/build-docs.mjs <site-folder>');
    process.exit(2);
  }
  if (!pandocAvailable()) {
    console.error('pandoc is needed to build the docs pages (apt install pandoc, or brew install pandoc).');
    process.exit(2);
  }
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
  for (const [path, html] of Object.entries(pages)) {
    const file = join(out, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    console.log(`built ${path}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
