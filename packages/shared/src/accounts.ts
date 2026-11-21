// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Role } from './api.js';

/**
 * Accounts, invitations and set-password links (migration 0011, ADR 0012).
 *
 * A link is shown once: its token exists only in the response that creates or regenerates it (LinkCreated) and in the
 * URL fragment the admin hands over. The server keeps only a SHA-256 hash.
 */

/** How an account's password last changed. null (unknown) means it was set before KinShip recorded how. */
export const PASSWORD_CHANGE_CODES = ['setup', 'self', 'admin_link', 'cli', 'invitation'] as const;
export type PasswordChangeCode = (typeof PASSWORD_CHANGE_CODES)[number];

/** Which roles each role may invite. Nobody invites a second SuperAdmin in 0.2. */
export const ROLES_INVITABLE_BY: Readonly<Record<Role, readonly Role[]>> = {
  superadmin: ['familyadmin', 'member', 'user'],
  familyadmin: ['member', 'user'],
  member: [],
  user: [],
};

/** Which roles each role may make a set-password link for (never for themselves, see canMakeSetPasswordLink). */
export const ROLES_RESETTABLE_BY: Readonly<Record<Role, readonly Role[]>> = {
  superadmin: ['superadmin', 'familyadmin', 'member', 'user'],
  familyadmin: ['member', 'user'],
  member: [],
  user: [],
};

/** May this account make a set-password link for that one? Never for yourself: a locked-out SuperAdmin uses the CLI. */
export function canMakeSetPasswordLink(actor: { id: string; role: Role }, target: { id: string; role: Role }): boolean {
  return actor.id !== target.id && ROLES_RESETTABLE_BY[actor.role].includes(target.role);
}

/**
 * May this account link that one to a person, change the link or remove it (ADR 0020)? A SuperAdmin any account; a Family
 * Admin a Member or a User; anyone who manages accounts their own. The database functions (0016) check the same rule.
 */
export function canLinkPerson(actor: { id: string; role: Role }, target: { id: string; role: Role }): boolean {
  if (actor.role !== 'superadmin' && actor.role !== 'familyadmin') return false;
  return (
    actor.id === target.id ||
    actor.role === 'superadmin' ||
    (actor.role === 'familyadmin' && (target.role === 'member' || target.role === 'user'))
  );
}

/** The roles a role change may set. Nobody is made SuperAdmin by a role change (only a provider group can, in 0.4). */
export const SETTABLE_ROLES = ['familyadmin', 'member', 'user'] as const;

/**
 * May this account change that account's role to `next` (ADR 0029)? Never your own; a SuperAdmin never changes
 * (in 0.3 a SuperAdmin account is never the target) and is never set; a SuperAdmin sets Family Admin, Member or User on
 * any other account; a Family Admin only switches a Member or a User between Member and User. The database function
 * kinship_auth.can_change_role_for (0019) is the same rule, and a test compares them.
 */
export function canChangeRole(
  actor: { id: string; role: Role },
  target: { id: string; role: Role },
  next: Role,
): boolean {
  if (actor.id === target.id) return false;
  if (target.role === 'superadmin' || next === 'superadmin') return false;
  if (actor.role === 'superadmin') return true;
  return actor.role === 'familyadmin' && target.role !== 'familyadmin' && next !== 'familyadmin';
}

/** The roles this account may set on that one (the Users page offers exactly these). Empty: no role control. */
export function rolesSettableBy(actor: { id: string; role: Role }, target: { id: string; role: Role }): Role[] {
  return SETTABLE_ROLES.filter((role) => canChangeRole(actor, target, role));
}

/**
 * May this account disable, enable or delete that account (ADR 0029)? Never your own; a SuperAdmin any other account; a Family
 * Admin a Member or a User. The last active SuperAdmin is protected separately (the database refuses it). The database function
 * kinship_auth.can_disable_for (0019) is the same rule, and a test compares them.
 */
export function canDisableAccount(actor: { id: string; role: Role }, target: { id: string; role: Role }): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === 'superadmin') return true;
  return actor.role === 'familyadmin' && (target.role === 'member' || target.role === 'user');
}

/** An invitation lasts 7 days, a set-password link 24 hours. */
export const INVITATION_HOURS = 7 * 24;
export const SET_PASSWORD_LINK_HOURS = 24;
export const INVITATION_NOTE_MAX = 500;

/** Body of POST /api/admin/invitations. */
export interface InvitationInput {
  email: string;
  role: Exclude<Role, 'superadmin'>;
  /** An existing person who has no account yet. Optional. */
  personId?: string | null;
  /** A few words shown to the invitee, up to 500 characters. Optional. */
  note?: string | null;
}

/** The one response that carries a token: POST /api/admin/invitations, .../set-password-link and .../regenerate. */
export interface LinkCreated {
  linkId: string;
  kind: 'invite' | 'reset';
  /** The raw token. Shown once; only its hash is stored. The page builds /invite#<token> or /reset#<token>. */
  token: string;
  expiresAt: string;
}

export type AccountStatus = 'active' | 'invited' | 'expired' | 'disabled';

/** An open link as the Users page sees it (never the token). */
export interface OpenLinkSummary {
  id: string;
  expiresAt: string;
  expired: boolean;
  /** The asking admin could make a new link or revoke this one. */
  canManage: boolean;
}

/** One row of the Users page: an account, or an invitation that has not been accepted. */
export interface AccountSummary {
  /** The account id, or the invitation's link id for an invitation. */
  id: string;
  kind: 'account' | 'invitation';
  /** Null for an invitation: nobody has chosen a name yet. */
  displayName: string | null;
  email: string;
  role: Role;
  person: { id: string; name: string } | null;
  status: AccountStatus;
  lastSignInAt: string | null;
  /** Who invited this account (its invitation), or who made the invitation. */
  invitedBy: string | null;
  passwordChangedAt: string | null;
  passwordChangedVia: PasswordChangeCode | null;
  /** The invitation, for status invited or expired. */
  invitation: (OpenLinkSummary & { note: string | null }) | null;
  /** An open set-password link for this account. */
  setPasswordLink: OpenLinkSummary | null;
  /** The asking admin may make a set-password link for this account. */
  canSetPasswordLink: boolean;
  /** The asking admin may link this account to a person, change the link or remove it (canLinkPerson). */
  canLinkPerson: boolean;
  /** The roles the asking admin may set on this account, the current one included (rolesSettableBy). Empty: none. */
  allowedRoles: Role[];
  /** When the account was disabled, or null while it is active. */
  disabledAt: string | null;
  /** The asking admin may disable this account, or enable it (canDisableAccount), and it is not the last active SuperAdmin. */
  canDisable: boolean;
  /** This account is the only active SuperAdmin: it can never be demoted, disabled or deleted. */
  lastSuperAdmin: boolean;
}

export interface AccountsResponse {
  accounts: AccountSummary[];
}

/**
 * Body of PUT /api/admin/accounts/:id/person (link, or change the link). `currentPersonId` is the person the page believes
 * the account is linked to now (null for none): if another admin changed it since, the answer is 409 account_already_linked.
 */
export interface LinkPersonInput {
  personId: string;
  currentPersonId: string | null;
}

/** Answer of PUT /api/admin/accounts/:id/person. */
export interface LinkPersonResponse {
  accountId: string;
  person: { id: string; name: string };
}

/** Query of DELETE /api/admin/accounts/:id/person, the same guard as LinkPersonInput.currentPersonId. */
export interface UnlinkPersonQuery {
  currentPersonId: string;
}

/**
 * Advice for GET /api/admin/accounts/:id/link-preview?personId=, never a decision (the PUT checks everything again).
 * Only a Member's edit rights depend on the link, so the three counts are 0 for every other role.
 */
export interface LinkPreview {
  role: Role;
  person: { id: string; name: string };
  current: { id: string; name: string } | null;
  /** Everyone below the person: children, theirs and so on. */
  descendantsInLine: number;
  /** Of those, the people this account added: it may edit them after the link (and the person). */
  createdByAccountInLine: number;
  /** People the account may edit through its current link and would no longer be able to edit. */
  losesEdit: number;
}

/** The structured log line written for every link, change and unlink (ADR 0020): ids only, no names or emails. */
export interface AccountPersonLogLine {
  event: 'account_person_linked' | 'account_person_unlinked';
  actor: string;
  account: string;
  from: string | null;
  to: string | null;
}

/**
 * Body of PATCH /api/admin/accounts/:id/role. `currentRole` is the role the page believes the account has: if another admin
 * changed it since, the answer is 409 account_role_changed. Setting the role it already has changes nothing (200).
 */
export interface ChangeRoleInput {
  role: Role;
  currentRole: Role;
}

/** Answer of PATCH /api/admin/accounts/:id/role. */
export interface ChangeRoleResponse {
  accountId: string;
  role: Role;
  previous: Role;
}

/** The structured log line for a role change (ADR 0029): ids and role codes only, no names or emails. */
export interface AccountRoleLogLine {
  event: 'account_role_changed';
  actor: string;
  account: string;
  from: Role;
  to: Role;
}

/** Answer of POST /api/admin/accounts/:id/disable and .../enable. */
export interface AccountStateResponse {
  accountId: string;
  status: 'active' | 'disabled';
  disabledAt: string | null;
}

/** The structured log lines for disable and enable (ADR 0029): ids only. Written only when something changed. */
export interface AccountStateLogLine {
  event: 'account_disabled' | 'account_enabled';
  actor: string;
  account: string;
}

/** Body of POST /api/links/lookup and /api/links/accept: the token is in the body, never in a URL. */
export interface LinkLookupRequest {
  token: string;
}

/** What the public pages show about a link. The same 404 invalid_link answers every kind of bad link. */
export type LinkLookup =
  | {
      kind: 'invite';
      treeName: string | null;
      email: string;
      role: Role;
      /** The person the account will be linked to, or null (then the invitee gives their name). */
      person: { name: string } | null;
      note: string | null;
      invitedBy: string | null;
      expiresAt: string;
    }
  | {
      kind: 'reset';
      treeName: string | null;
      /** The name of the account whose password will change. */
      displayName: string;
      expiresAt: string;
    };

export interface AcceptLinkRequest {
  token: string;
  password: string;
  /** For an invitation with no linked person. Ignored when a person is linked (their name is used). */
  displayName?: string;
}

/** Body of POST /api/auth/password. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export const ACCOUNT_ERROR_CODES = [
  'invalid_link',
  'link_not_found',
  'link_exists',
  'email_taken',
  'invitation_exists',
  'person_already_linked',
  'account_already_linked',
  'person_is_placeholder',
  'person_has_open_invitation',
  'account_not_linked',
  'role_not_allowed',
  'account_not_found',
  'invalid_current_password',
  'self_not_allowed',
  'last_superadmin',
  'account_role_changed',
  'account_disabled',
  'account_not_disabled',
  'confirmation_mismatch',
] as const;
export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];

/** The admin routes and the public link routes. The API registers exactly these (checked by a test). */
export const ACCOUNT_ROUTES = [
  { method: 'POST', path: '/api/admin/invitations', access: 'admin' },
  { method: 'GET', path: '/api/admin/accounts', access: 'admin' },
  { method: 'POST', path: '/api/admin/links/:id/regenerate', access: 'admin' },
  { method: 'POST', path: '/api/admin/links/:id/revoke', access: 'admin' },
  { method: 'POST', path: '/api/admin/accounts/:id/set-password-link', access: 'admin' },
  { method: 'GET', path: '/api/admin/accounts/:id/link-preview', access: 'admin' },
  { method: 'PUT', path: '/api/admin/accounts/:id/person', access: 'admin' },
  { method: 'DELETE', path: '/api/admin/accounts/:id/person', access: 'admin' },
  { method: 'PATCH', path: '/api/admin/accounts/:id/role', access: 'admin' },
  { method: 'POST', path: '/api/admin/accounts/:id/disable', access: 'admin' },
  { method: 'POST', path: '/api/admin/accounts/:id/enable', access: 'admin' },
  { method: 'POST', path: '/api/links/lookup', access: 'public' },
  { method: 'POST', path: '/api/links/accept', access: 'public' },
  { method: 'POST', path: '/api/auth/password', access: 'signed-in' },
] as const;
