// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Reset your password" (design/kinship-email-templates.md section 3). Step 54 sends it only to an enabled local account, so
// the email never has to say whether an address has an account. The button, the expiry line and the "never asks for your
// password" line are code.
import type { MailNode } from '../layout.js';
import type { TemplateDef } from '../render.js';

export interface PasswordResetParams {
  /** The account's display name. */
  name: string;
  /** The account's own address (the one the email goes to). */
  email: string;
  tree: string;
  /** How long the link works, as a phrase: "1 hour". */
  expires: string;
  link: string;
}

const ALL = ['name', 'email', 'tree', 'expires'] as const;

export const passwordReset: TemplateDef<PasswordResetParams> = {
  id: 'password_reset',
  editable: true,
  fields: [
    { key: 'subject', kind: 'subject', placeholders: ['tree'], default: 'Reset your KinShip password' },
    {
      key: 'preview',
      kind: 'preview',
      placeholders: ['tree', 'expires'],
      default: 'Choose a new password. The link works for {expires}.',
    },
    { key: 'heading', kind: 'heading', placeholders: ['name', 'tree'], default: 'Reset your password' },
    {
      key: 'intro',
      kind: 'text',
      placeholders: ALL,
      default:
        'Someone asked to reset the password for the KinShip account {email} on the {tree} tree. If that was you, choose a new password below.',
    },
    {
      key: 'good_to_know',
      kind: 'list',
      placeholders: ALL,
      default: 'If you did not ask for this, you can ignore this email. Your current password keeps working.',
    },
    {
      key: 'footer',
      kind: 'text',
      placeholders: ['tree'],
      default: 'Nobody can use this email without the link, and it stops working once it has been used.',
    },
  ],
  values: (p) => ({ name: p.name, email: p.email, tree: p.tree, expires: p.expires }),
  build({ params: p, publicUrl, text, paragraphs }) {
    const nodes: MailNode[] = [{ kind: 'heading', text: text('heading') }];
    for (const paragraph of paragraphs('intro')) nodes.push({ kind: 'paragraph', text: paragraph });
    nodes.push({ kind: 'button', label: 'Choose a new password', url: p.link });
    nodes.push({
      kind: 'small',
      text: `This link works once and expires in ${p.expires}. A new request cancels it. If the button does not work, copy this address into your browser: ${p.link}`,
    });
    nodes.push({
      kind: 'list',
      title: 'Good to know',
      items: [...paragraphs('good_to_know'), 'KinShip never emails your password and never asks for it.'],
    });
    return { nodes, footer: [`Sent by the ${p.tree} tree on KinShip (${publicUrl}).`, ...paragraphs('footer')] };
  },
  sample: (publicUrl) => ({
    name: 'Marcus Hale',
    email: 'marcus@hale.example',
    tree: 'Hale Family',
    expires: '1 hour',
    link: `${publicUrl}/reset/SAMPLE-not-a-real-link`,
  }),
};
