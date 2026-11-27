// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Your password was changed" (design/kinship-email-templates.md section 3). A security notice: it cannot be turned off, and
// its "if this was not you" text may be reworded but never emptied. The "Secure my account" button appears only when the
// caller passes a link (step 54 decides whether that route exists); without one the email says to ask a family admin.
import type { MailNode } from '../layout.js';
import type { TemplateDef } from '../render.js';

export interface PasswordChangedParams {
  name: string;
  tree: string;
  /** When it changed, already written for the reader: "Nov 14, 2026 at 5:42 PM". */
  when: string;
  /** "Secure my account" (signs out everywhere and asks for a new password), or null when there is no such link yet. */
  secureLink: string | null;
}

const ALL = ['name', 'tree', 'when'] as const;

export const passwordChanged: TemplateDef<PasswordChangedParams> = {
  id: 'password_changed',
  editable: true,
  fields: [
    { key: 'subject', kind: 'subject', placeholders: ['tree'], default: 'Your KinShip password was changed' },
    { key: 'preview', kind: 'preview', placeholders: ALL, default: 'If this was you, no action is needed.' },
    { key: 'heading', kind: 'heading', placeholders: ['name', 'tree'], default: 'Your password was changed' },
    {
      key: 'body',
      kind: 'text',
      placeholders: ALL,
      default:
        'The password for your KinShip account on the {tree} tree was changed on {when}. You were signed out of every other device.',
    },
    {
      key: 'not_you',
      kind: 'text',
      required: true,
      placeholders: ALL,
      default:
        'If this was you, there is nothing more to do. If it was not you, someone else may have access to your account.',
    },
  ],
  values: (p) => ({ name: p.name, tree: p.tree, when: p.when }),
  build({ params: p, publicUrl, text, paragraphs }) {
    const nodes: MailNode[] = [{ kind: 'heading', text: text('heading') }];
    for (const paragraph of paragraphs('body')) nodes.push({ kind: 'paragraph', text: paragraph });
    for (const paragraph of paragraphs('not_you')) nodes.push({ kind: 'paragraph', text: paragraph });
    if (p.secureLink) {
      nodes.push({ kind: 'button', label: 'Secure my account', url: p.secureLink });
      nodes.push({
        kind: 'small',
        text: `This signs out every device and asks you to choose a new password. If the button does not work, copy this address into your browser: ${p.secureLink}`,
      });
    }
    nodes.push({
      kind: 'small',
      text: 'A family admin can also lock your account and set a new password for you while you sort it out.',
    });
    return {
      nodes,
      footer: [
        `Sent by the ${p.tree} tree on KinShip (${publicUrl}) because your password changed.`,
        'This message is a security notice, so it cannot be turned off.',
      ],
    };
  },
  sample: () => ({ name: 'Marcus Hale', tree: 'Hale Family', when: 'Nov 14, 2026 at 5:42 PM', secureLink: null }),
};
