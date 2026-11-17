// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A small, inert Markdown renderer for text that comes from the internet (release notes, upgrade notes) or from the changelog.
// It builds React elements and never sets HTML: raw HTML in the text is shown as text, an image is shown as its description,
// a link is a link only when it is http or https, and every scan is linear (no regular expression over the text).
import type { ReactNode } from 'react';

/** Text beyond these limits is not shown (the api shortens notes too; this is the last line of defence). */
export const MAX_MARKDOWN_CHARS = 40_000;
export const MAX_MARKDOWN_LINES = 2_000;
const MAX_INLINE_DEPTH = 4;
const PUNCTUATION = '\\`*_{}[]()#+-.!<>|~';

/** The URL as the browser would read it when it is http or https, else null. */
export function safeUrl(raw: string): string | null {
  if (raw.length === 0 || raw.length > 2000) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A span (code, emphasis, link) is at most this long. Searching only this far keeps every scan linear for any text. */
const MAX_SPAN = 2000;

/** Where `needle` first appears at or after `from`, looking no further than MAX_SPAN characters; -1 when it does not. */
function within(text: string, needle: string, from: number): number {
  const found = text.slice(from, from + MAX_SPAN + needle.length).indexOf(needle);
  return found < 0 ? -1 : from + found;
}

const isAlnum = (c: string | undefined): boolean => c !== undefined && /^[0-9A-Za-z]$/.test(c);

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}

/** Bold, italic, code, links and escapes inside one block of text. */
function inline(text: string, depth = 0, links = true): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = '';
  let key = 0;
  const flush = () => {
    if (plain !== '') out.push(plain);
    plain = '';
  };
  const push = (node: ReactNode) => {
    flush();
    out.push(<span key={key++}>{node}</span>);
  };
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    const next = text.charAt(i + 1);
    if (c === '\\' && next !== '' && PUNCTUATION.includes(next)) {
      plain += next;
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = within(text, '`', i + 1);
      if (end > i + 1) {
        push(<code>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }
    if ((c === '*' || c === '_') && depth < MAX_INLINE_DEPTH) {
      const double = next === c;
      const marker = double ? c + c : c;
      const start = i + marker.length;
      const end = within(text, marker, start);
      const boundaryBefore = c === '*' || !isAlnum(text.charAt(i - 1));
      const inner = end > start ? text.slice(start, end) : '';
      if (
        inner !== '' &&
        inner.trim() === inner &&
        boundaryBefore &&
        (c === '*' || !isAlnum(text.charAt(end + marker.length)))
      ) {
        const children = inline(inner, depth + 1, links);
        push(double ? <strong>{children}</strong> : <em>{children}</em>);
        i = end + marker.length;
        continue;
      }
    }
    if (c === '!' && next === '[') {
      const parsed = bracketLink(text, i + 1);
      if (parsed) {
        // No remote images: the description is shown as text.
        push(parsed.label);
        i = parsed.end;
        continue;
      }
    }
    if (c === '[') {
      const parsed = bracketLink(text, i);
      if (parsed) {
        const href = links ? safeUrl(parsed.target) : null;
        const label = inline(parsed.label, depth + 1, false);
        push(href ? <Link href={href}>{label}</Link> : label);
        i = parsed.end;
        continue;
      }
    }
    if (c === '<' && links) {
      const end = within(text, '>', i + 1);
      const inner = end > i ? text.slice(i + 1, end) : '';
      if ((inner.startsWith('https://') || inner.startsWith('http://')) && !inner.includes(' ')) {
        const href = safeUrl(inner);
        if (href) {
          push(<Link href={href}>{inner}</Link>);
          i = end + 1;
          continue;
        }
      }
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

/** "[label](target)" starting at `start` (which is the "["): the label, the target and where it ends, or null. */
function bracketLink(text: string, start: number): { label: string; target: string; end: number } | null {
  // The label ends at the matching "]" (a label may hold an image: [![alt](src)](href)).
  let depth = 0;
  let close = -1;
  for (let i = start; i < text.length && i < start + MAX_SPAN; i++) {
    const c = text.charAt(i);
    if (c === '\\') i++;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0 || text.charAt(close + 1) !== '(') return null;
  const end = within(text, ')', close + 2);
  if (end < 0) return null;
  const target = text.slice(close + 2, end).trim();
  const space = target.indexOf(' ');
  return { label: text.slice(start + 1, close), target: space < 0 ? target : target.slice(0, space), end: end + 1 };
}

interface Item {
  depth: number;
  ordered: boolean;
  text: string;
}

function listMarker(line: string): { indent: number; ordered: boolean; text: string } | null {
  let indent = 0;
  while (line.charAt(indent) === ' ') indent++;
  const rest = line.slice(indent);
  const first = rest.charAt(0);
  if ((first === '-' || first === '*' || first === '+') && rest.charAt(1) === ' ') {
    return { indent, ordered: false, text: rest.slice(2).trim() };
  }
  let digits = 0;
  while (digits < 9 && /^[0-9]$/.test(rest.charAt(digits))) digits++;
  if (digits > 0 && (rest.charAt(digits) === '.' || rest.charAt(digits) === ')') && rest.charAt(digits + 1) === ' ') {
    return { indent, ordered: true, text: rest.slice(digits + 2).trim() };
  }
  return null;
}

function renderItems(items: Item[], from: number, depth: number, key: { n: number }): [ReactNode, number] {
  const ordered = items[from]?.ordered ?? false;
  const lis: ReactNode[] = [];
  let i = from;
  while (i < items.length && (items[i]?.depth ?? 0) >= depth) {
    const item = items[i] as Item;
    if (item.depth > depth) {
      // A deeper item with no parent at this depth: show it at this one.
      item.depth = depth;
    }
    let nested: ReactNode = null;
    i++;
    if (i < items.length && (items[i]?.depth ?? 0) > depth) {
      const [list, after] = renderItems(items, i, depth + 1, key);
      nested = list;
      i = after;
    }
    lis.push(
      <li key={key.n++}>
        {inline(item.text)}
        {nested}
      </li>,
    );
  }
  const List = ordered ? 'ol' : 'ul';
  return [<List key={key.n++}>{lis}</List>, i];
}

function blocks(lines: string[], depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const key = { n: 0 };
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) out.push(<p key={key.n++}>{inline(paragraph.join(' '))}</p>);
    paragraph = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? '').trimEnd();
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      flushParagraph();
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) code.push(lines[i++] ?? '');
      i++;
      out.push(
        <pre key={key.n++}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (trimmed === '') {
      flushParagraph();
      i++;
      continue;
    }
    let hashes = 0;
    while (hashes < 7 && trimmed.charAt(hashes) === '#') hashes++;
    if (hashes >= 1 && hashes <= 6 && trimmed.charAt(hashes) === ' ') {
      flushParagraph();
      const Heading = hashes <= 2 ? 'h4' : hashes === 3 ? 'h5' : 'h6';
      out.push(<Heading key={key.n++}>{inline(trimmed.slice(hashes + 1).trim())}</Heading>);
      i++;
      continue;
    }
    if (
      trimmed.length >= 3 &&
      [...trimmed].every((c) => c === trimmed.charAt(0)) &&
      '-*_'.includes(trimmed.charAt(0))
    ) {
      flushParagraph();
      out.push(<hr key={key.n++} />);
      i++;
      continue;
    }
    if (trimmed.startsWith('>') && depth < 3) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoted.push((lines[i] ?? '').trim().slice(1).replace(/^ /, ''));
        i++;
      }
      out.push(<blockquote key={key.n++}>{blocks(quoted, depth + 1)}</blockquote>);
      continue;
    }
    if (listMarker(line)) {
      flushParagraph();
      const items: Item[] = [];
      const indents: number[] = [];
      while (i < lines.length) {
        const current = (lines[i] ?? '').trimEnd();
        const marker = listMarker(current);
        if (marker && items.length > 0 && marker.indent === 0 && marker.ordered !== items[0]?.ordered) break;
        if (marker) {
          while (indents.length > 0 && (indents[indents.length - 1] ?? 0) > marker.indent) indents.pop();
          if (indents.length === 0 || (indents[indents.length - 1] ?? 0) < marker.indent) indents.push(marker.indent);
          items.push({ depth: indents.length - 1, ordered: marker.ordered, text: marker.text });
          i++;
        } else if (current.trim() !== '' && current.startsWith(' ') && items.length > 0) {
          // A continuation line of the item above.
          (items[items.length - 1] as Item).text += ` ${current.trim()}`;
          i++;
        } else break;
      }
      out.push(renderItems(items, 0, 0, key)[0]);
      continue;
    }
    // A link reference definition ("[0.2.0]: https://...") is not text.
    if (trimmed.startsWith('[') && trimmed.includes(']: ')) {
      i++;
      continue;
    }
    paragraph.push(trimmed);
    i++;
  }
  flushParagraph();
  return out;
}

/** Renders Markdown as plain elements. Safe for text we do not control. */
export function Markdown({ text }: { text: string }) {
  const limited = text.length > MAX_MARKDOWN_CHARS ? text.slice(0, MAX_MARKDOWN_CHARS) : text;
  const lines = limited.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_MARKDOWN_LINES);
  return <div className="markdown">{blocks(lines)}</div>;
}
