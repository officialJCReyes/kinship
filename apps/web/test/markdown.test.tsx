// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Markdown renderer is the only thing standing between text from the internet (release notes) and the SuperAdmin's screen:
// it must produce inert elements, whatever the text says.
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_MARKDOWN_CHARS, Markdown, safeUrl } from '../src/lib/markdown.js';

const html = (text: string) => render(<Markdown text={text} />).container;

describe('Markdown', () => {
  it('renders headings, paragraphs, lists (also nested and numbered), emphasis, code and quotes', () => {
    const c = html(
      [
        '## Heading two',
        '',
        'Some **bold**, *italic*, `code` and a_b_c.',
        '',
        '- one',
        '- two',
        '  - nested',
        '1. first',
        '2. second',
        '',
        '> quoted **text**',
        '',
        '```',
        '<script>alert(1)</script>',
        '```',
      ].join('\n'),
    );
    expect(c.querySelector('h4')?.textContent).toBe('Heading two');
    expect(c.querySelector('strong')?.textContent).toBe('bold');
    expect(c.querySelector('em')?.textContent).toBe('italic');
    expect(c.querySelector('p code')?.textContent).toBe('code');
    expect(c.textContent).toContain('a_b_c');
    expect(c.querySelectorAll('ul > li')).toHaveLength(3);
    expect(c.querySelector('ul ul li')?.textContent).toBe('nested');
    expect(c.querySelectorAll('ol > li')).toHaveLength(2);
    expect(c.querySelector('blockquote strong')?.textContent).toBe('text');
    expect(c.querySelector('pre code')?.textContent).toBe('<script>alert(1)</script>');
    expect(c.querySelector('script')).toBeNull();
  });

  it('shows raw HTML as text and never makes an element from it', () => {
    const attack = [
      '<script>alert(1)</script>',
      '<img src="https://evil.test/p.png" onerror="alert(1)">',
      '<a href="javascript:alert(1)">x</a>',
      '<iframe src="https://evil.test"></iframe>',
      '<style>body{display:none}</style>',
      '<svg onload=alert(1)>',
    ].join('\n\n');
    const c = html(attack);
    for (const tag of ['script', 'img', 'iframe', 'style', 'svg', 'a']) expect(c.querySelector(tag), tag).toBeNull();
    expect(c.textContent).toContain('<script>alert(1)</script>');
    expect(c.textContent).toContain('onerror="alert(1)"');
  });

  it('makes a link only for http and https, opens it safely, and never loads a remote image', () => {
    const c = html(
      [
        '[ok](https://example.com/a?b=1)',
        '[http](http://example.com)',
        '[js](javascript:alert(1))',
        '[data](data:text/html,<script>alert(1)</script>)',
        '[vb](vbscript:x)',
        '[rel](/relative/path)',
        '[ftp](ftp://example.com/x)',
        '[file](file:///etc/passwd)',
        '<https://auto.example.com/x>',
        '<javascript:alert(1)>',
        '![logo](https://evil.test/track.png)',
        '[![badge](https://evil.test/b.svg)](https://example.com/b)',
      ].join('\n\n'),
    );
    const links = [...c.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/a?b=1',
      'http://example.com/',
      'https://auto.example.com/x',
      'https://example.com/b',
    ]);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    }
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).toContain('logo');
    expect(c.textContent).toContain('js');
    // The text of a refused link stays on the page as text; no attribute carries a dangerous address.
    for (const element of c.querySelectorAll('*')) {
      for (const attribute of ['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href']) {
        expect(element.getAttribute(attribute) ?? '', attribute).not.toMatch(/^(javascript|data|vbscript|file):/i);
      }
    }
  });

  it('checks a URL the way the browser reads it', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com/');
    expect(safeUrl('HTTPS://EXAMPLE.com/x')).toBe('https://example.com/x');
    for (const bad of [
      '',
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'java\nscript:alert(1)',
      '//example.com',
      'https://' + 'a'.repeat(2100),
    ]) {
      expect(safeUrl(bad), bad).toBeNull();
    }
  });

  it('does not stop on broken or hostile input, and stays fast on it', () => {
    const nasty = [
      '['.repeat(50_000),
      '*'.repeat(50_000),
      '_a'.repeat(20_000),
      '`'.repeat(30_000),
      '[a](' + 'b('.repeat(10_000),
      '- '.repeat(5_000),
      '> '.repeat(5_000),
      '<'.repeat(30_000),
      '\\'.repeat(30_000),
      '**' + '*'.repeat(20_000),
      '#'.repeat(10_000) + ' x',
      '1. '.repeat(5_000),
      ' '.repeat(30_000) + 'x',
    ];
    const start = performance.now();
    for (const text of nasty) html(text);
    expect(performance.now() - start).toBeLessThan(5000);
  });

  it('shows only the first part of a huge text', () => {
    const c = html('word '.repeat(MAX_MARKDOWN_CHARS) + 'THE END');
    expect(c.textContent).not.toContain('THE END');
    const many = html(Array.from({ length: 10_000 }, (_, i) => `- item ${i}`).join('\n'));
    expect(many.querySelectorAll('li').length).toBeLessThanOrEqual(2000);
  });

  it('drops link reference definitions and handles escapes', () => {
    const c = html('Text \\*not bold\\*\n\n[0.2.0]: https://example.com/compare\n\n[1.0]: x');
    expect(c.textContent).toContain('*not bold*');
    expect(c.textContent).not.toContain('compare');
    expect(c.querySelector('em')).toBeNull();
  });

  it('never sets HTML: the source has no dangerouslySetInnerHTML or innerHTML', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/markdown.tsx'), 'utf8');
    expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    for (const file of [
      'components/UpdateDialog.tsx',
      'components/WhatsNew.tsx',
      'components/UpdateBanner.tsx',
      'pages/AdminUpdatesPage.tsx',
    ]) {
      expect(readFileSync(join(process.cwd(), 'src', file), 'utf8'), file).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML/,
      );
    }
  });
});
