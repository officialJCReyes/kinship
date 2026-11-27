// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Email templates (ADR 0041, 53b): every template rendered as HTML and as text (snapshots in __snapshots__/mail/; copy a
// .html.snap file to .html and open it in a browser to look at it), the structural checks that stand in for Outlook, the
// privacy scan, escaping of admin text and values, and the checks on an admin's draft.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAIL_TEMPLATE_IDS } from '@kinship/shared';
import { describe, expect, it } from 'vitest';
import { LOGO_PATH } from '../src/mail/layout.js';
import { checkField, fill, placeholdersIn } from '../src/mail/placeholders.js';
import { describeFields, headerSafe, initialsOf, render, splitParagraphs } from '../src/mail/render.js';
import type { RenderedMail, TemplateDef } from '../src/mail/render.js';
import { checkDraft, TEMPLATES } from '../src/mail/templates/index.js';
import type { TemplateParams } from '../src/mail/templates/index.js';
import { INVITATION_PRIVACY } from '../src/mail/templates/invitation.js';

const here = dirname(fileURLToPath(import.meta.url));
const URL_BASE = 'https://tree.hale.example';
/** The fixed paths a link in an email may use (step 54 builds the real ones on these). */
const LINK_PATHS = ['/invite/', '/reset/', '/secure/'];

type Case = { name: string; mail: RenderedMail };

function renderOf<K extends keyof TemplateParams>(
  id: K,
  params: TemplateParams[K],
  overrides: Record<string, string> = {},
): RenderedMail {
  return render(TEMPLATES[id], params, overrides, URL_BASE);
}

const invite = TEMPLATES.invitation.sample(URL_BASE);
const CASES: Case[] = [
  { name: 'invitation-linked-with-note', mail: renderOf('invitation', invite) },
  {
    name: 'invitation-not-linked-no-note',
    mail: renderOf('invitation', { ...invite, person: null, note: null, role: 'user' }),
  },
  { name: 'invitation-family-admin', mail: renderOf('invitation', { ...invite, role: 'familyadmin', note: '   ' }) },
  { name: 'password-reset', mail: renderOf('password_reset', TEMPLATES.password_reset.sample(URL_BASE)) },
  { name: 'password-changed-no-link', mail: renderOf('password_changed', TEMPLATES.password_changed.sample(URL_BASE)) },
  {
    name: 'password-changed-with-link',
    mail: renderOf('password_changed', {
      ...TEMPLATES.password_changed.sample(URL_BASE),
      secureLink: `${URL_BASE}/secure/SAMPLE-not-a-real-link`,
    }),
  },
  { name: 'test', mail: renderOf('test', { name: 'Marcus Hale', provider: 'Resend' }) },
];

describe('every template, as HTML and as text', () => {
  for (const { name, mail } of CASES) {
    it(`${name} matches its snapshot`, async () => {
      await expect(mail.html).toMatchFileSnapshot(join(here, '__snapshots__', 'mail', `${name}.html.snap`));
      await expect(`Subject: ${mail.subject}\n\n${mail.text}\n`).toMatchFileSnapshot(
        join(here, '__snapshots__', 'mail', `${name}.txt`),
      );
    });
  }

  it('covers every template that ships', () => {
    const covered = new Set(CASES.map((c) => c.name.split('-')[0]));
    expect([...covered].sort()).toEqual(['invitation', 'password', 'test']);
    expect(Object.keys(TEMPLATES).sort()).toEqual([...MAIL_TEMPLATE_IDS].sort());
  });

  it('shows the note and the linked person only when there are some', () => {
    const [withNote, without] = [CASES[0]!.mail, CASES[1]!.mail];
    expect(withNote.text).toContain('Grandpa Walter');
    expect(withNote.text).toContain('Your account is linked to Sofia Hale');
    expect(without.text).not.toContain('Grandpa Walter');
    expect(without.text).toContain('You are not linked to a person yet');
    expect(without.text).toContain('Your role is User.');
  });

  it('shows "Secure my account" only when the caller passes the link', () => {
    expect(CASES[4]!.mail.text).not.toContain('Secure my account');
    expect(CASES[4]!.mail.html).not.toContain('<a ');
    expect(CASES[5]!.mail.text).toContain(`Secure my account: ${URL_BASE}/secure/SAMPLE-not-a-real-link`);
  });
});

/** Every opening tag, with its name and its attributes as written. */
function tags(html: string): { name: string; attrs: string }[] {
  return [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)].map((m) => ({
    name: (m[1] ?? '').toLowerCase(),
    attrs: m[2] ?? '',
  }));
}

describe('built for the strictest clients (Outlook-style checks)', () => {
  const allowed = new Set([
    'html',
    'head',
    'meta',
    'title',
    'body',
    'span',
    'table',
    'tr',
    'td',
    'p',
    'h1',
    'ul',
    'li',
    'a',
    'img',
    'br',
  ]);
  for (const { name, mail } of CASES) {
    it(`${name}: tables for layout, every style inline, no class, no <style>, fixed widths and colours`, () => {
      const html = mail.html;
      expect(html).not.toMatch(/<style/i);
      expect(html).not.toMatch(/\sclass=/i);
      expect(html).not.toMatch(/<(div|section|header|footer|main|article|nav|link|script)\b/i);
      const all = tags(html);
      for (const tag of all) expect(allowed.has(tag.name), tag.name).toBe(true);
      // Inside <body>, every element but a row or a line break carries its own style.
      const body = tags(html.slice(html.indexOf('<body')));
      for (const tag of body) {
        if (tag.name === 'tr' || tag.name === 'br') continue;
        expect(tag.attrs, `<${tag.name}${tag.attrs}>`).toMatch(/\sstyle="[^"]+"/);
      }
      const tables = all.filter((t) => t.name === 'table');
      for (const table of tables) expect(table.attrs).toMatch(/role="presentation"/);
      expect(tables[0]?.attrs).toMatch(/width="100%"/);
      expect(tables[0]?.attrs).toMatch(/bgcolor="#F6F4EC"/);
      expect(tables[1]?.attrs).toMatch(/width="560"/);
      expect(tables[1]?.attrs).toMatch(/bgcolor="#FFFFFF"/);
      expect(html).toContain('bgcolor="#1E4D4A"');
      expect(html).toContain('<meta name="color-scheme" content="light">');
      expect(html).not.toMatch(/prefers-color-scheme|@media/);
    });

    it(`${name}: the logo is the only image and the only remote address outside PUBLIC_URL links`, () => {
      const html = mail.html;
      const images = tags(html).filter((t) => t.name === 'img');
      expect(images).toHaveLength(1);
      expect(images[0]?.attrs).toContain(`src="${URL_BASE}${LOGO_PATH}"`);
      expect(images[0]?.attrs).toContain('alt="KinShip"');
      expect(images[0]?.attrs).toMatch(/width="\d+" height="\d+"/);
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '');
      for (const href of hrefs) {
        expect(href.startsWith(`${URL_BASE}/`), href).toBe(true);
        expect(
          LINK_PATHS.some((path) => href.startsWith(`${URL_BASE}${path}`)),
          href,
        ).toBe(true);
      }
      const addresses = [...`${html}\n${mail.text}`.matchAll(/https?:\/\/[^\s"<>)]*[^\s"<>).,;:]/g)].map((m) => m[0]);
      for (const address of addresses) expect(new URL(address).origin, address).toBe(URL_BASE);
      expect(html).not.toMatch(/background(-image)?:\s*url|<img[^>]+(width|height)="1"/i);
    });

    it(`${name}: the text part says what the HTML says`, () => {
      const headings = [...mail.html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1] ?? '');
      expect(headings).toHaveLength(1);
      expect(mail.text).toContain(decode(headings[0]!).toUpperCase());
      for (const href of [...mail.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '')) {
        expect(mail.text).toContain(href);
      }
      expect(mail.text).not.toMatch(/<[a-z]/i);
    });
  }

  it('the logo the emails point at is in the web image, a PNG on the header teal', () => {
    const file = join(here, '..', '..', 'web', 'public', ...LOGO_PATH.split('/').filter(Boolean));
    expect(existsSync(file), file).toBe(true);
    const png = readFileSync(file);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([258, 96]);
    expect(png.length).toBeLessThan(20_000);
  });
});

function decode(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

describe('privacy: no health, DNA or under-18 detail in any email', () => {
  // Unique markers in the Hale fixtures: if any of them reaches an email, a template is reading something it must not.
  const MARK = {
    health: 'ZQHEALTH9431',
    condition: 'ZQCONDITION2207',
    dna: 'ZQDNA5518',
    haplogroup: 'ZQHAPLO6620',
    match: 'ZQMATCH3349',
    minorName: 'ZQMINOR7781',
    minorBirth: '2014-06-19',
  };
  /** The Hale family as step 54 and 57 will hold it: the person records carry health, DNA and a child under 18. */
  const HALE = {
    person: {
      name: 'Sofia Hale',
      conditions: [{ name: MARK.condition, notes: MARK.health }],
      dna: { provider: '23andMe', haplogroup: MARK.haplogroup, matches: [MARK.match], result: MARK.dna },
      children: [{ name: MARK.minorName, birthDate: MARK.minorBirth }],
    },
  };
  // Words that would only be there if a template talked about health or DNA. Narrow on purpose: everyday words are out.
  const WORDS = [
    /diagnos/i,
    /medication/i,
    /\bcondition/i,
    /haplogroup/i,
    /centimorgan/i,
    /ethnicity/i,
    /genetic/i,
    /\bDNA\b/,
    /\bhealth\b/i,
    /\bmatch(es)?\b/i,
  ];
  // Allowed exception: the invitation's two fixed privacy lines SAY that health and DNA stay private (design doc section 1).
  // They name no one's data. They are taken out before the scan; nothing else may use these words.
  const EXCEPTIONS: readonly string[] = INVITATION_PRIVACY;

  /** Every template with every fixture field mixed into its params, as a careless caller might. */
  function renderedWithFixtures(): Case[] {
    const extra = { ...HALE, ...HALE.person };
    return (Object.keys(TEMPLATES) as (keyof TemplateParams)[]).flatMap((id) => {
      const def = TEMPLATES[id] as TemplateDef<unknown>;
      const sample = def.sample(URL_BASE) as Record<string, unknown>;
      return [
        { name: id, mail: render(def, { ...extra, ...sample }, {}, URL_BASE) },
        { name: `${id} (person)`, mail: render(def, { ...extra, ...sample, person: 'Sofia Hale' }, {}, URL_BASE) },
      ];
    });
  }

  for (const { name, mail } of renderedWithFixtures()) {
    it(`${name}: no marker and no listed word in the subject, HTML or text`, () => {
      for (const part of [mail.subject, mail.html, mail.text]) {
        for (const marker of Object.values(MARK)) expect(part).not.toContain(marker);
        let scanned = part;
        for (const sentence of EXCEPTIONS) scanned = scanned.split(sentence).join(' ');
        for (const word of WORDS) expect(scanned, `${word} in ${name}`).not.toMatch(word);
      }
    });
  }
});

describe('admin text and values are escaped, and headers stay clean', () => {
  const hostile = {
    subject: 'Tom & Jerry <script>alert(1)</script>\r\nBcc: someone@elsewhere.example',
    preview: 'Line one\nBcc: x@elsewhere.example',
    heading: '<img src=x onerror=alert(1)>',
    intro: `A & B <b>bold</b>\n\nSecond paragraph ${'W'.repeat(400)}`,
    worth_knowing: '<a href="https://evil.example">click</a>',
    footer: 'Plain & simple',
  };
  const mail = render(
    TEMPLATES.invitation,
    { ...invite, inviter: 'Marcus <b>Hale</b> & co', note: '<script>x</script>' },
    hostile,
    URL_BASE,
  );

  it('prints admin text and values as text, never as markup', () => {
    expect(mail.html).not.toMatch(/<script|<b>|<img src=x|<a href="https:\/\/evil/i);
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('A &amp; B &lt;b&gt;bold&lt;/b&gt;');
    expect(mail.html).toContain('Marcus &lt;b&gt;Hale&lt;/b&gt; &amp; co');
    expect(mail.html).toContain('W'.repeat(400));
    expect(mail.text).toContain('A & B <b>bold</b>');
    // The plain-text part has no markup at all: an admin's "<a href=…>" is printed as the characters they typed.
    expect(mail.text).toContain('- <a href="https://evil.example">click</a>');
  });

  it('keeps the subject and preview on one line, at most 200 characters', () => {
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toBe('Tom & Jerry <script>alert(1)</script> Bcc: someone@elsewhere.example');
    expect(mail.html).not.toMatch(/Line one\s*\n\s*Bcc/);
    expect(headerSafe(`a\u2028b\u0000c${'x'.repeat(300)}`)).toHaveLength(200);
    expect(headerSafe('  a \t b  ')).toBe('a b');
  });

  it('refuses a button that is not on PUBLIC_URL', () => {
    expect(() =>
      render(TEMPLATES.invitation, { ...invite, link: 'https://evil.example/invite/x' }, {}, URL_BASE),
    ).toThrow(/not on PUBLIC_URL/);
  });

  it('fills placeholders in one pass: a value that looks like a placeholder is printed as it is', () => {
    const tricky = render(TEMPLATES.invitation, { ...invite, tree: '{inviter}' }, {}, URL_BASE);
    expect(tricky.subject).toBe('Marcus Hale invited you to the {inviter} tree');
  });

  it('ignores overrides on the fixed test email', () => {
    const fixed = render(TEMPLATES.test, { name: 'Marcus Hale', provider: 'SMTP' }, { subject: 'Changed' }, URL_BASE);
    expect(fixed.subject).toBe('KinShip test email');
  });
});

describe('placeholders and the checks on a draft', () => {
  const def = TEMPLATES.invitation as TemplateDef<unknown>;
  const rule = (key: string) => describeFields(def).find((f) => f.key === key)!;

  it('finds and fills placeholders', () => {
    expect(placeholdersIn('{inviter} and {tree}, {inviter}')).toEqual(['inviter', 'tree', 'inviter']);
    expect(fill('Hi {name}, {unknown}!', { name: 'Sofia' })).toBe('Hi Sofia, !');
  });

  it('refuses unknown placeholders, stray braces, line breaks, long text and empty required fields', () => {
    expect(checkField(rule('subject'), '{inviter} asked {person} to {join}')).toEqual([
      { field: 'subject', problem: 'unknown_placeholder', placeholder: 'person' },
      { field: 'subject', problem: 'unknown_placeholder', placeholder: 'join' },
    ]);
    for (const text of ['Hello {', 'Hello }', '{{tree}}', '{Tree}', '{ tree }', '{}']) {
      expect(checkField(rule('intro'), text), text).toContainEqual({ field: 'intro', problem: 'stray_brace' });
    }
    expect(checkField(rule('subject'), 'One\nTwo')).toEqual([{ field: 'subject', problem: 'line_break' }]);
    expect(checkField(rule('subject'), 'One\rTwo')).toEqual([{ field: 'subject', problem: 'line_break' }]);
    expect(checkField(rule('heading'), 'One\nTwo')).toEqual([{ field: 'heading', problem: 'line_break' }]);
    expect(checkField(rule('subject'), 'x'.repeat(150))).toEqual([]);
    expect(checkField(rule('subject'), 'x'.repeat(151))).toEqual([{ field: 'subject', problem: 'too_long', max: 150 }]);
    expect(checkField(rule('intro'), 'x'.repeat(1000))).toEqual([]);
    expect(checkField(rule('intro'), 'x'.repeat(1001))).toEqual([{ field: 'intro', problem: 'too_long', max: 1000 }]);
    expect(checkField(rule('subject'), '  ')).toEqual([{ field: 'subject', problem: 'empty' }]);
    expect(checkField(rule('heading'), '')).toEqual([{ field: 'heading', problem: 'empty' }]);
    expect(checkField(rule('intro'), '')).toEqual([]);
    expect(checkField(rule('intro'), 'Two\n\nparagraphs')).toEqual([]);
  });

  it('keeps only what differs from the default, and lists every problem at once', () => {
    const intro = rule('intro').default;
    expect(checkDraft(def, { intro, subject: 'Join us, {tree}' })).toEqual({
      problems: [],
      changed: { subject: 'Join us, {tree}' },
    });
    expect(checkDraft(def, { intro: 'A\r\n\r\nB' }).changed).toEqual({ intro: 'A\n\nB' });
    expect(checkDraft(def, { subject: '', nope: 'x', intro: 4, footer: '{' }).problems).toEqual([
      { field: 'subject', problem: 'empty' },
      { field: 'nope', problem: 'unknown_field' },
      { field: 'intro', problem: 'not_text' },
      { field: 'footer', problem: 'stray_brace' },
    ]);
    expect(checkDraft(def, 'text').problems).toEqual([{ field: '', problem: 'not_text' }]);
  });

  it('never lets the "if this was not you" text of the security notice be emptied', () => {
    const changed = TEMPLATES.password_changed as TemplateDef<unknown>;
    expect(checkDraft(changed, { not_you: ' ' }).problems).toEqual([{ field: 'not_you', problem: 'empty' }]);
  });

  it('allows no placeholder that could carry health, DNA or a birth date', () => {
    for (const def of Object.values(TEMPLATES) as TemplateDef<unknown>[]) {
      for (const field of def.fields) {
        for (const name of field.placeholders) {
          expect(['inviter', 'tree', 'role', 'expires', 'name', 'email', 'when', 'url', 'provider']).toContain(name);
        }
        // Every default passes its own checks.
        expect(
          checkField(
            describeFields(def).find((f) => f.key === field.key)!,
            field.default,
          ),
        ).toEqual([]);
      }
    }
  });

  it('splits paragraphs at blank lines and makes initials', () => {
    expect(splitParagraphs('a\n\n\nb\n  \nc\nd')).toEqual(['a', 'b', 'c\nd']);
    expect([
      initialsOf('Sofia Hale'),
      initialsOf('walter'),
      initialsOf('  '),
      initialsOf('Ana María de la Cruz'),
    ]).toEqual(['SH', 'W', '?', 'AC']);
  });
});
