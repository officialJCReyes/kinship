// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one email layout (ADR 0041, 53b). An email is a list of nodes; `htmlOf` prints them as HTML and `textOf` as plain text,
// so the two parts always say the same thing.
//
// The HTML is written for the strictest clients (Outlook on Windows draws with Word): tables for every bit of layout, every
// style inline, no <style> block, no class, explicit widths and bgcolor attributes. One column, 560 px; light theme only.
// The only image is the logo, served by the web container without sign-in; there is no tracking pixel. Every piece of text
// is escaped here, whoever wrote it (the built-in wording, an admin, or a value such as a person's name).
import { escapeHtml } from './html.js';

/** The logo's path in the web image (apps/web/public/email/logo.png): the teal-background version, 258 x 96. */
export const LOGO_PATH = '/email/logo.png';
const LOGO_WIDTH = 81;
const LOGO_HEIGHT = 30;

export const COLORS = {
  page: '#F6F4EC',
  card: '#FFFFFF',
  header: '#1E4D4A',
  border: '#D9E0DB',
  text: '#17231F',
  muted: '#5B6A65',
  button: '#1E4D4A',
  buttonText: '#FFFFFF',
  avatar: '#E0EDE1',
  quoteBar: '#4F8A4B',
  quote: '#F3F7F2',
} as const;

const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

export type MailNode =
  | { kind: 'heading'; text: string }
  /** One paragraph. A single line break inside it is kept. */
  | { kind: 'paragraph'; text: string }
  /** A boxed fact with an initials circle, such as "Your account is linked to Sofia Hale". */
  | { kind: 'card'; initials: string; title: string; detail: string }
  /** Someone's own words (the inviter's note), with who wrote them. */
  | { kind: 'quote'; text: string; by: string }
  /** The one teal button. The address must start with PUBLIC_URL (render.ts checks it). */
  | { kind: 'button'; label: string; url: string }
  | { kind: 'small'; text: string }
  | { kind: 'list'; title: string; items: string[] };

export interface MailDocument {
  subject: string;
  /** The line many inboxes show after the subject. May be empty. */
  preview: string;
  nodes: MailNode[];
  /** Small print under the card. */
  footer: string[];
  /** PUBLIC_URL, without a trailing slash. */
  publicUrl: string;
}

/** Escaped text, with a line break kept as <br>. */
function lines(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function nodeHtml(node: MailNode): string {
  switch (node.kind) {
    case 'heading':
      return `<h1 style="margin:0 0 14px 0;font-family:${SERIF};font-size:25px;line-height:31px;font-weight:600;color:${COLORS.text};">${escapeHtml(node.text)}</h1>`;
    case 'paragraph':
      return `<p style="margin:0 0 16px 0;font-family:${SANS};font-size:15px;line-height:24px;color:${COLORS.text};">${lines(node.text)}</p>`;
    case 'card':
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.card}" style="width:100%;margin:0 0 18px 0;border:1px solid ${COLORS.border};border-radius:10px;background-color:${COLORS.card};">` +
        `<tr><td width="56" valign="top" style="width:56px;padding:14px 0 14px 14px;">` +
        `<table role="presentation" width="40" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.avatar}" style="width:40px;border-radius:20px;background-color:${COLORS.avatar};"><tr>` +
        `<td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;font-family:${SERIF};font-size:15px;font-weight:600;line-height:40px;color:${COLORS.header};">${escapeHtml(node.initials)}</td>` +
        `</tr></table></td>` +
        `<td valign="top" style="padding:14px 16px 14px 10px;font-family:${SANS};">` +
        `<p style="margin:0;font-family:${SANS};font-size:15px;line-height:22px;font-weight:600;color:${COLORS.text};">${escapeHtml(node.title)}</p>` +
        `<p style="margin:2px 0 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${COLORS.muted};">${lines(node.detail)}</p>` +
        `</td></tr></table>`
      );
    case 'quote':
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.quote}" style="width:100%;margin:0 0 18px 0;background-color:${COLORS.quote};border-left:3px solid ${COLORS.quoteBar};">` +
        `<tr><td style="padding:12px 16px;font-family:${SANS};">` +
        `<p style="margin:0;font-family:${SANS};font-size:14px;line-height:22px;font-style:italic;color:${COLORS.text};">&ldquo;${lines(node.text)}&rdquo;</p>` +
        `<p style="margin:6px 0 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:${COLORS.muted};">${escapeHtml(node.by)}</p>` +
        `</td></tr></table>`
      );
    case 'button':
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px 0;">` +
        `<tr><td bgcolor="${COLORS.button}" style="border-radius:8px;background-color:${COLORS.button};">` +
        `<a href="${escapeHtml(node.url)}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${COLORS.buttonText};text-decoration:none;border-radius:8px;">${escapeHtml(node.label)}</a>` +
        `</td></tr></table>`
      );
    case 'small':
      return `<p style="margin:0 0 20px 0;font-family:${SANS};font-size:13px;line-height:20px;color:${COLORS.muted};word-break:break-word;">${lines(node.text)}</p>`;
    case 'list':
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:4px 0 0 0;border-top:1px solid ${COLORS.border};">` +
        `<tr><td style="padding:16px 0 0 0;font-family:${SANS};">` +
        `<p style="margin:0 0 6px 0;font-family:${SANS};font-size:13px;line-height:20px;font-weight:600;color:${COLORS.text};">${escapeHtml(node.title)}</p>` +
        `<ul style="margin:0;padding:0 0 0 18px;font-family:${SANS};font-size:14px;line-height:22px;color:${COLORS.text};">` +
        node.items.map((item) => `<li style="margin:0 0 4px 0;">${lines(item)}</li>`).join('') +
        `</ul></td></tr></table>`
      );
  }
}

/** The HTML part. */
export function htmlOf(doc: MailDocument): string {
  const logo = `${doc.publicUrl}${LOGO_PATH}`;
  const preview =
    doc.preview === ''
      ? ''
      : `<span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${COLORS.page};">${escapeHtml(doc.preview)}</span>`;
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">',
    `<title>${escapeHtml(doc.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background-color:${COLORS.page};">`,
    preview,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.page}" style="width:100%;background-color:${COLORS.page};">`,
    `<tr><td align="center" style="padding:24px 12px;">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.card}" style="width:100%;max-width:560px;background-color:${COLORS.card};border:1px solid ${COLORS.border};border-radius:12px;">`,
    `<tr><td bgcolor="${COLORS.header}" style="padding:18px 28px;background-color:${COLORS.header};border-radius:12px 12px 0 0;">`,
    `<img src="${escapeHtml(logo)}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" alt="KinShip" style="display:block;width:${LOGO_WIDTH}px;height:${LOGO_HEIGHT}px;border:0;outline:none;text-decoration:none;font-family:${SANS};font-size:16px;font-weight:600;color:${COLORS.buttonText};">`,
    `</td></tr>`,
    `<tr><td style="padding:28px 28px 10px 28px;">`,
    doc.nodes.map(nodeHtml).join(''),
    `</td></tr></table>`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">`,
    `<tr><td align="center" style="padding:16px 8px 0 8px;">`,
    doc.footer
      .map(
        (line) =>
          `<p style="margin:0 0 8px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${COLORS.muted};text-align:center;">${lines(line)}</p>`,
      )
      .join(''),
    `</td></tr></table>`,
    `</td></tr></table>`,
    '</body></html>',
  ].join('\n');
}

function nodeText(node: MailNode): string[] {
  switch (node.kind) {
    case 'heading':
      return [node.text.toUpperCase(), ''];
    case 'paragraph':
      return [node.text, ''];
    case 'card':
      return [`${node.title}. ${node.detail}`, ''];
    case 'quote':
      return [`"${node.text}"`, `  - ${node.by}`, ''];
    case 'button':
      return [`${node.label}: ${node.url}`, ''];
    case 'small':
      return [node.text, ''];
    case 'list':
      return [`${node.title}:`, ...node.items.map((item) => `- ${item}`), ''];
  }
}

/** The plain-text part, from the same nodes. */
export function textOf(doc: MailDocument): string {
  return [...doc.nodes.flatMap(nodeText), '--', ...doc.footer].join('\n');
}
