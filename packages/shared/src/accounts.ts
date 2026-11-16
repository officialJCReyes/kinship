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

export type AccountStatus = 'active' | 'invited' | 'expired';

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
}

export interface AccountsResponse {
  accounts: AccountSummary[];
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
  'role_not_allowed',
  'account_not_found',
  'invalid_current_password',
] as const;
export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];

/** The admin routes and the public link routes. The API registers exactly these (checked by a test). */
export const ACCOUNT_ROUTES = [
  { method: 'POST', path: '/api/admin/invitations', access: 'admin' },
  { method: 'GET', path: '/api/admin/accounts', access: 'admin' },
  { method: 'POST', path: '/api/admin/links/:id/regenerate', access: 'admin' },
  { method: 'POST', path: '/api/admin/links/:id/revoke', access: 'admin' },
  { method: 'POST', path: '/api/admin/accounts/:id/set-password-link', access: 'admin' },
  { method: 'POST', path: '/api/links/lookup', access: 'public' },
  { method: 'POST', path: '/api/links/accept', access: 'public' },
  { method: 'POST', path: '/api/auth/password', access: 'signed-in' },
] as const;
