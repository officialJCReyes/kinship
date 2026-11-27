// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The "Send test to me" email: fixed text (it cannot be edited), no link that does anything, nothing about the family.
import type { TemplateDef } from '../render.js';

export interface TestParams {
  /** The SuperAdmin's display name. */
  name: string;
  /** "Resend" or "SMTP". */
  provider: string;
}

export const testEmail: TemplateDef<TestParams> = {
  id: 'test',
  editable: false,
  fields: [
    { key: 'subject', kind: 'subject', placeholders: [], default: 'KinShip test email' },
    { key: 'preview', kind: 'preview', placeholders: [], default: 'If you can read this, email works.' },
    { key: 'heading', kind: 'heading', placeholders: [], default: 'Email works' },
    {
      key: 'body',
      kind: 'text',
      placeholders: ['name', 'url', 'provider'],
      default: [
        'Hello {name},',
        'This is a test email from KinShip at {url}. If you can read it, email works: invitations and password resets can be sent by email.',
        'You asked for it on the Storage & email page in Admin. It was sent through {provider}.',
        'There is nothing to do. You can delete this email.',
      ].join('\n\n'),
    },
  ],
  values: (p, publicUrl) => ({ name: p.name, url: publicUrl, provider: p.provider }),
  build: ({ publicUrl, text, paragraphs }) => ({
    nodes: [
      { kind: 'heading', text: text('heading') },
      ...paragraphs('body').map((paragraph) => ({ kind: 'paragraph' as const, text: paragraph })),
    ],
    footer: [`Sent by KinShip (${publicUrl}).`],
  }),
  sample: () => ({ name: 'Marcus Hale', provider: 'SMTP' }),
};
