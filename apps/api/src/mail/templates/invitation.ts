// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "You're invited to the … tree" (design/kinship-email-templates.md section 1). Step 54 sends it; the link is whatever route
// step 54 builds, passed in by the caller. The card, the role, the button, the expiry line and the privacy wording are code.
import type { Role } from '@kinship/shared';
import type { MailNode } from '../layout.js';
import { initialsOf } from '../render.js';
import type { TemplateDef } from '../render.js';

export interface InvitationParams {
  /** Who sent it (their display name). */
  inviter: string;
  /** The tree's name, for example "Hale Family". */
  tree: string;
  /** The person on the tree the new account is linked to, or null. */
  person: string | null;
  role: Exclude<Role, 'superadmin'>;
  /** How long the link works, as a phrase: "7 days". */
  expires: string;
  /** The invitation link (on PUBLIC_URL). */
  link: string;
  /** The inviter's own note, or null. */
  note: string | null;
}

const ROLE_TEXT: Record<InvitationParams['role'], string> = {
  familyadmin:
    'Your role is Family Admin. You can edit the whole tree, and invite and look after the people who use it.',
  member:
    'Your role is Member. You can view the whole tree, add photos and sources, edit your own profile and add your children.',
  user: 'Your role is User. You can view the tree and its photos. Editing is for Members and admins.',
};

/** The privacy lines: fixed, whatever an admin writes. */
export const INVITATION_PRIVACY = [
  'Your health information is private. Nobody sees it unless you share it with them, one person at a time.',
  'DNA results you add are visible to family accounts. Your match lists and raw files stay with you.',
] as const;

const ALL = ['inviter', 'tree', 'role', 'expires'] as const;

export const invitation: TemplateDef<InvitationParams> = {
  id: 'invitation',
  editable: true,
  fields: [
    {
      key: 'subject',
      kind: 'subject',
      placeholders: ['inviter', 'tree'],
      default: '{inviter} invited you to the {tree} tree',
    },
    {
      key: 'preview',
      kind: 'preview',
      placeholders: ALL,
      default: 'Accept your invitation to the family tree. The link works for {expires}.',
    },
    {
      key: 'heading',
      kind: 'heading',
      placeholders: ['inviter', 'tree'],
      default: 'You’re invited to the {tree} tree',
    },
    {
      key: 'intro',
      kind: 'text',
      placeholders: ALL,
      default:
        '{inviter} has invited you to join the {tree} tree on KinShip, a private place where your family keeps its people, photos, stories and history together.',
    },
    {
      key: 'worth_knowing',
      kind: 'list',
      placeholders: ALL,
      default: 'You choose which reminders you get in My settings.',
    },
    {
      key: 'footer',
      kind: 'text',
      placeholders: ['inviter', 'tree'],
      default: 'If you were not expecting this, ignore this email. Nothing happens until you accept.',
    },
  ],
  values: (p) => ({
    inviter: p.inviter,
    tree: p.tree,
    role: { familyadmin: 'Family Admin', member: 'Member', user: 'User' }[p.role],
    expires: p.expires,
  }),
  build({ params: p, publicUrl, text, paragraphs }) {
    const nodes: MailNode[] = [{ kind: 'heading', text: text('heading') }];
    for (const paragraph of paragraphs('intro')) nodes.push({ kind: 'paragraph', text: paragraph });
    if (p.note !== null && p.note.trim() !== '') nodes.push({ kind: 'quote', text: p.note.trim(), by: p.inviter });
    nodes.push(
      p.person
        ? {
            kind: 'card',
            initials: initialsOf(p.person),
            title: `Your account is linked to ${p.person}`,
            detail: 'You will see yourself on the tree.',
          }
        : {
            kind: 'card',
            initials: '?',
            title: 'You are not linked to a person yet',
            detail: 'You can look around the tree. An admin can link your account to your own person later.',
          },
    );
    nodes.push({ kind: 'paragraph', text: ROLE_TEXT[p.role] });
    nodes.push({ kind: 'button', label: 'Accept invitation', url: p.link });
    nodes.push({
      kind: 'small',
      text: `This link works once and expires in ${p.expires}. If the button does not work, copy this address into your browser: ${p.link}`,
    });
    nodes.push({
      kind: 'list',
      title: 'A few things worth knowing',
      items: [...INVITATION_PRIVACY, ...paragraphs('worth_knowing')],
    });
    return {
      nodes,
      footer: [`Sent by the ${p.tree} tree on KinShip (${publicUrl}).`, ...paragraphs('footer')],
    };
  },
  sample: (publicUrl) => ({
    inviter: 'Marcus Hale',
    tree: 'Hale Family',
    person: 'Sofia Hale',
    role: 'member',
    expires: '7 days',
    link: `${publicUrl}/invite/SAMPLE-not-a-real-link`,
    note: 'Sofia, I have put in everything I know about Grandpa Walter’s side. Would love your help filling in the gaps.',
  }),
};
