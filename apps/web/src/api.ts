// SPDX-License-Identifier: AGPL-3.0-or-later
import { CSRF_HEADER, CSRF_VALUE } from '@kinship/shared';
import { reportVersionMismatch } from './lib/version-mismatch.js';
import type {
  AcceptLinkRequest,
  AccountsResponse,
  AccountStateResponse,
  ChangeRoleInput,
  DeleteAccountInput,
  DeleteAccountPreview,
  ChangeRoleResponse,
  AddChildRequest,
  AddParentRequest,
  AddSiblingRequest,
  SiblingResponse,
  BackupSettings,
  UpdateBackupAckRequest,
  UpdateDismissRequest,
  UpdateSettings,
  UpdatesResponse,
  WhatsNewResponse,
  BackupsResponse,
  DownloadTicket,
  ApiErrorCode,
  ApiHealth,
  ApiVersion,
  ChangePasswordRequest,
  ChildResponse,
  InvitationInput,
  LinkPersonInput,
  LinkPersonResponse,
  LinkPreview,
  LinkCreated,
  LinkLookup,
  LabelInput,
  LabelPatch,
  LabelResponse,
  LineageView,
  LoginRequest,
  MeResponse,
  ParentageResponse,
  PeoplePage,
  PersonDetail,
  PersonInput,
  PersonPatch,
  PersonResponse,
  SetupRequest,
  SetupStatus,
  RelationshipResponse,
  TreeResponse,
  UnionInput,
  UnionPatch,
  UpdateMeRequest,
  UpdateParentLinkRequest,
  LinkKind,
  UnionResponse,
} from '@kinship/shared';

/** A failed API call. `code` is the API's `error` value, when it sent one. */
export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: ApiErrorCode,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }

  /** The path of the request field the API says is wrong (`family.children.1.birth`), when it names one. */
  get field(): string | undefined {
    const value = this.details.field;
    return typeof value === 'string' ? value : undefined;
  }

  get retryAfterSeconds(): number | undefined {
    const value = this.details.retryAfterSeconds;
    return typeof value === 'number' ? value : undefined;
  }
}

interface Reply {
  status: number;
  body: unknown;
}

async function send(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Reply> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers[CSRF_HEADER] = CSRF_VALUE;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });
  if (response.status === 204) return { status: 204, body: undefined };
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // A proxy error page (for example 502 when the API is down) is not JSON.
    throw new ApiError(`${path} did not return JSON`, response.status);
  }
  if (response.status === 503) {
    const details = asRecord(parsed);
    if (details.error === 'version_mismatch') {
      reportVersionMismatch({
        web: typeof details.web === 'string' ? details.web : '',
        api: typeof details.api === 'string' ? details.api : '',
      });
    }
  }
  return { status: response.status, body: parsed };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function fail(path: string, reply: Reply): never {
  const details = asRecord(reply.body);
  const code = typeof details.error === 'string' ? (details.error as ApiErrorCode) : undefined;
  throw new ApiError(`${path} failed with ${reply.status}`, reply.status, code, details);
}

export async function fetchVersion(signal?: AbortSignal): Promise<ApiVersion> {
  const reply = await send('GET', '/api/version', undefined, signal);
  if (reply.status !== 200 || !('version' in asRecord(reply.body))) fail('/api/version', reply);
  return reply.body as ApiVersion;
}

/** 503 with a JSON body is a normal answer ("database unreachable"), not an error. */
export async function fetchHealth(signal?: AbortSignal): Promise<ApiHealth> {
  const reply = await send('GET', '/api/health', undefined, signal);
  if ((reply.status !== 200 && reply.status !== 503) || !('status' in asRecord(reply.body))) fail('/api/health', reply);
  return reply.body as ApiHealth;
}

export async function fetchSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  const reply = await send('GET', '/api/setup/status', undefined, signal);
  if (reply.status !== 200 || typeof asRecord(reply.body).needsSetup !== 'boolean') fail('/api/setup/status', reply);
  return reply.body as SetupStatus;
}

/** The signed-in person, or null when nobody is signed in. */
export async function fetchMe(signal?: AbortSignal): Promise<MeResponse | null> {
  const reply = await send('GET', '/api/auth/me', undefined, signal);
  if (reply.status === 401) return null;
  if (reply.status !== 200 || !('user' in asRecord(reply.body))) fail('/api/auth/me', reply);
  return reply.body as MeResponse;
}

export async function login(request: LoginRequest): Promise<MeResponse> {
  const reply = await send('POST', '/api/auth/login', request);
  if (reply.status !== 200) fail('/api/auth/login', reply);
  return reply.body as MeResponse;
}

export async function logout(): Promise<void> {
  const reply = await send('POST', '/api/auth/logout', {});
  if (reply.status !== 204) fail('/api/auth/logout', reply);
}

/** The account's own display setting: which family the charts follow for an adopted person. */
export async function updateMe(request: UpdateMeRequest): Promise<MeResponse> {
  const reply = await send('PATCH', '/api/auth/me', request);
  if (reply.status !== 200) fail('/api/auth/me', reply);
  return reply.body as MeResponse;
}

/** Is this the setup token? Resolves when it is; throws ApiError (invalid_setup_token, already_set_up, rate_limited) when not. */
export async function checkSetupToken(token: string): Promise<void> {
  const reply = await send('POST', '/api/setup/check', { token });
  if (reply.status !== 204) fail('/api/setup/check', reply);
}

// --- Backups (SuperAdmin only) ---

export async function fetchBackups(signal?: AbortSignal): Promise<BackupsResponse> {
  const reply = await send('GET', '/api/admin/backups', undefined, signal);
  if (reply.status !== 200) fail('/api/admin/backups', reply);
  return reply.body as BackupsResponse;
}

/** Starts a backup in the background (202). The page then polls fetchBackups. */
export async function startBackup(): Promise<void> {
  const reply = await send('POST', '/api/admin/backups');
  if (reply.status !== 202) fail('/api/admin/backups', reply);
}

export async function startBackupTest(): Promise<void> {
  const reply = await send('POST', '/api/admin/backups/test');
  if (reply.status !== 202) fail('/api/admin/backups/test', reply);
}

export async function fetchBackupSettings(signal?: AbortSignal): Promise<BackupSettings> {
  const reply = await send('GET', '/api/admin/backups/settings', undefined, signal);
  if (reply.status !== 200) fail('/api/admin/backups/settings', reply);
  return reply.body as BackupSettings;
}

export async function updateBackupSettings(patch: Partial<BackupSettings>): Promise<BackupSettings> {
  const reply = await send('PATCH', '/api/admin/backups/settings', patch);
  if (reply.status !== 200) fail('/api/admin/backups/settings', reply);
  return reply.body as BackupSettings;
}

/** The SuperAdmin's password again, for a one-time ticket to download one encrypted archive. */
export async function requestDownloadTicket(name: string, password: string): Promise<DownloadTicket> {
  const reply = await send('POST', '/api/admin/backups/download-ticket', { name, password });
  if (reply.status !== 200) fail('/api/admin/backups/download-ticket', reply);
  return reply.body as DownloadTicket;
}

export async function setup(request: SetupRequest): Promise<MeResponse> {
  const reply = await send('POST', '/api/setup', request);
  if (reply.status !== 201) fail('/api/setup', reply);
  return reply.body as MeResponse;
}

// --- People, relationships and the tree. Every path here is in PEOPLE_ROUTES (a test checks it). ---

function succeeded(reply: Reply): boolean {
  return reply.status >= 200 && reply.status < 300;
}

export async function listPeople(
  params: { q?: string; cursor?: string | null; limit?: number },
  signal?: AbortSignal,
): Promise<PeoplePage> {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set('q', params.q.trim());
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const path = `/api/people${query.size ? `?${query}` : ''}`;
  const reply = await send('GET', path, undefined, signal);
  if (reply.status !== 200) fail(path, reply);
  return reply.body as PeoplePage;
}

export async function fetchPerson(id: string, signal?: AbortSignal): Promise<PersonDetail> {
  const path = `/api/people/${encodeURIComponent(id)}`;
  const reply = await send('GET', path, undefined, signal);
  if (reply.status !== 200) fail(path, reply);
  return reply.body as PersonDetail;
}

/** The people, relationships and parent links around one person (see TreeResponse). */
/** How `b` is related to `a`. Without `lineage` the API follows the signed-in account's own setting. */
export async function fetchRelationship(
  a: string,
  b: string,
  lineage?: LineageView,
  signal?: AbortSignal,
): Promise<RelationshipResponse> {
  const query = new URLSearchParams({ a, b });
  if (lineage) query.set('lineage', lineage);
  const path = `/api/relationship?${query}`;
  const reply = await send('GET', path, undefined, signal);
  if (reply.status !== 200) fail(path, reply);
  return reply.body as RelationshipResponse;
}

export async function fetchTree(
  id: string,
  options: { up: number; down: number; collateral?: boolean | 'siblings'; lineage?: LineageView },
  signal?: AbortSignal,
): Promise<TreeResponse> {
  const query = new URLSearchParams({ up: String(options.up), down: String(options.down) });
  // true: every other descendant of the top ancestors; 'siblings': only brothers and sisters and their families (no aunts, uncles, cousins).
  if (options.collateral) query.set('collateral', options.collateral === 'siblings' ? 'siblings' : 'true');
  // Without `lineage` the API follows the signed-in account's own setting.
  if (options.lineage) query.set('lineage', options.lineage);
  const path = `/api/tree/${encodeURIComponent(id)}?${query}`;
  const reply = await send('GET', path, undefined, signal);
  if (reply.status !== 200) fail(path, reply);
  return reply.body as TreeResponse;
}

export async function createPerson(input: PersonInput): Promise<PersonResponse> {
  const reply = await send('POST', '/api/people', input);
  if (!succeeded(reply)) fail('/api/people', reply);
  return reply.body as PersonResponse;
}

export async function updatePerson(id: string, patch: PersonPatch): Promise<PersonResponse> {
  const path = `/api/people/${encodeURIComponent(id)}`;
  const reply = await send('PATCH', path, patch);
  if (!succeeded(reply)) fail(path, reply);
  return reply.body as PersonResponse;
}

/** Without `confirm`, a person with relationships or children is refused with 409 confirm_required (and counts). */
export async function deletePerson(id: string, confirm: boolean): Promise<void> {
  const path = `/api/people/${encodeURIComponent(id)}${confirm ? '?confirm=true' : ''}`;
  const reply = await send('DELETE', path);
  if (!succeeded(reply)) fail(path, reply);
}

export async function addChild(parentId: string, request: AddChildRequest): Promise<ChildResponse> {
  const path = `/api/people/${encodeURIComponent(parentId)}/children`;
  const reply = await send('POST', path, request);
  if (!succeeded(reply)) fail(path, reply);
  return reply.body as ChildResponse;
}

export async function addSibling(personId: string, request: AddSiblingRequest): Promise<SiblingResponse> {
  const path = `/api/people/${encodeURIComponent(personId)}/siblings`;
  const reply = await send('POST', path, request);
  if (!succeeded(reply)) fail(path, reply);
  return reply.body as SiblingResponse;
}

export async function addParent(childId: string, request: AddParentRequest): Promise<ParentageResponse> {
  const path = `/api/people/${encodeURIComponent(childId)}/parents`;
  const reply = await send('POST', path, request);
  if (!succeeded(reply)) fail(path, reply);
  return reply.body as ParentageResponse;
}

export async function removeParent(childId: string, parentId: string): Promise<ParentageResponse> {
  const path = `/api/people/${encodeURIComponent(childId)}/parents/${encodeURIComponent(parentId)}`;
  const reply = await send('DELETE', path);
  if (!succeeded(reply)) fail(path, reply);
  return (reply.body ?? { parentage: null, warnings: [] }) as ParentageResponse;
}

export async function createUnion(input: UnionInput): Promise<UnionResponse> {
  const reply = await send('POST', '/api/unions', input);
  if (!succeeded(reply)) fail('/api/unions', reply);
  return reply.body as UnionResponse;
}

export async function updateUnion(id: string, patch: UnionPatch): Promise<UnionResponse> {
  const path = `/api/unions/${encodeURIComponent(id)}`;
  const reply = await send('PATCH', path, patch);
  if (!succeeded(reply)) fail(path, reply);
  return reply.body as UnionResponse;
}

export async function createLabel(input: LabelInput): Promise<LabelResponse> {
  const reply = await send('POST', '/api/labels', input);
  if (!succeeded(reply)) fail('/api/labels', reply);
  return reply.body as LabelResponse;
}

export async function updateLabel(id: string, patch: LabelPatch): Promise<LabelResponse> {
  const path = `/api/labels/${encodeURIComponent(id)}`;
  const reply = await send('PATCH', path, patch);
  if (!succeeded(reply)) fail(path, reply);
  return reply.body as LabelResponse;
}

export async function deleteLabel(id: string): Promise<void> {
  const path = `/api/labels/${encodeURIComponent(id)}`;
  const reply = await send('DELETE', path);
  if (!succeeded(reply)) fail(path, reply);
}

export async function deleteUnion(id: string): Promise<void> {
  const path = `/api/unions/${encodeURIComponent(id)}`;
  const reply = await send('DELETE', path);
  if (!succeeded(reply)) fail(path, reply);
}

/** Change (or clear) the date of one set of a child's parent links. Admins only. */
export async function updateParentLink(
  childId: string,
  kind: LinkKind,
  request: UpdateParentLinkRequest,
): Promise<ParentageResponse> {
  const path = `/api/people/${encodeURIComponent(childId)}/parents/${kind}`;
  const reply = await send('PATCH', path, request);
  if (!succeeded(reply)) fail(path, reply);
  return reply.body as ParentageResponse;
}

// --- Admin: accounts, invitations and set-password links. Every path here is in ACCOUNT_ROUTES (a test checks it). ---

export async function fetchAccounts(signal?: AbortSignal): Promise<AccountsResponse> {
  const reply = await send('GET', '/api/admin/accounts', undefined, signal);
  if (reply.status !== 200) fail('/api/admin/accounts', reply);
  return reply.body as AccountsResponse;
}

/** The only answers that carry a link token. Callers keep them in component state only, never in a cache. */
export async function createInvitation(input: InvitationInput): Promise<LinkCreated> {
  const reply = await send('POST', '/api/admin/invitations', input);
  if (reply.status !== 201) fail('/api/admin/invitations', reply);
  return reply.body as LinkCreated;
}

export async function regenerateLink(linkId: string): Promise<LinkCreated> {
  const path = `/api/admin/links/${encodeURIComponent(linkId)}/regenerate`;
  const reply = await send('POST', path, {});
  if (reply.status !== 200) fail(path, reply);
  return reply.body as LinkCreated;
}

export async function revokeLink(linkId: string): Promise<void> {
  const path = `/api/admin/links/${encodeURIComponent(linkId)}/revoke`;
  const reply = await send('POST', path, {});
  if (reply.status !== 204) fail(path, reply);
}

export async function createSetPasswordLink(accountId: string): Promise<LinkCreated> {
  const path = `/api/admin/accounts/${encodeURIComponent(accountId)}/set-password-link`;
  const reply = await send('POST', path, {});
  if (reply.status !== 201) fail(path, reply);
  return reply.body as LinkCreated;
}

/** Advice before linking an account to a person (the PUT checks everything again). */
export async function fetchLinkPreview(
  accountId: string,
  personId: string,
  signal?: AbortSignal,
): Promise<LinkPreview> {
  const path = `/api/admin/accounts/${encodeURIComponent(accountId)}/link-preview?personId=${encodeURIComponent(personId)}`;
  const reply = await send('GET', path, undefined, signal);
  if (reply.status !== 200) fail(path, reply);
  return reply.body as LinkPreview;
}

/** Links an account to a person, or changes the link. `currentPersonId` is what the page believes it is now. */
export async function linkAccountPerson(accountId: string, input: LinkPersonInput): Promise<LinkPersonResponse> {
  const path = `/api/admin/accounts/${encodeURIComponent(accountId)}/person`;
  const reply = await send('PUT', path, input);
  if (reply.status !== 200) fail(path, reply);
  return reply.body as LinkPersonResponse;
}

export async function changeAccountRole(accountId: string, input: ChangeRoleInput): Promise<ChangeRoleResponse> {
  const path = `/api/admin/accounts/${encodeURIComponent(accountId)}/role`;
  const reply = await send('PATCH', path, input);
  if (reply.status !== 200) fail(path, reply);
  return reply.body as ChangeRoleResponse;
}

export async function disableAccount(accountId: string): Promise<AccountStateResponse> {
  const path = `/api/admin/accounts/${encodeURIComponent(accountId)}/disable`;
  const reply = await send('POST', path, {});
  if (reply.status !== 200) fail(path, reply);
  return reply.body as AccountStateResponse;
}

export async function enableAccount(accountId: string): Promise<AccountStateResponse> {
  const path = `/api/admin/accounts/${encodeURIComponent(accountId)}/enable`;
  const reply = await send('POST', path, {});
  if (reply.status !== 200) fail(path, reply);
  return reply.body as AccountStateResponse;
}

export async function fetchDeletePreview(accountId: string, signal?: AbortSignal): Promise<DeleteAccountPreview> {
  const path = `/api/admin/accounts/${encodeURIComponent(accountId)}/delete-preview`;
  const reply = await send('GET', path, undefined, signal);
  if (reply.status !== 200) fail(path, reply);
  return reply.body as DeleteAccountPreview;
}

/** The typed email goes in the body, never the URL, so it reaches no request log. */
export async function deleteAccount(accountId: string, input: DeleteAccountInput): Promise<void> {
  const path = `/api/admin/accounts/${encodeURIComponent(accountId)}/delete`;
  const reply = await send('POST', path, input);
  if (reply.status !== 204) fail(path, reply);
}

export async function unlinkAccountPerson(accountId: string, currentPersonId: string): Promise<void> {
  const path = `/api/admin/accounts/${encodeURIComponent(accountId)}/person?currentPersonId=${encodeURIComponent(currentPersonId)}`;
  const reply = await send('DELETE', path);
  if (reply.status !== 204) fail(path, reply);
}

// --- Public links and passwords. ---

/** What a link is. The token goes in the BODY, never in the URL, so it reaches no access log. */
export async function lookupLink(token: string, signal?: AbortSignal): Promise<LinkLookup> {
  const reply = await send('POST', '/api/links/lookup', { token }, signal);
  if (reply.status !== 200) fail('/api/links/lookup', reply);
  return reply.body as LinkLookup;
}

/** Accepts an invitation or a set-password link; the answer is the new, signed-in account. */
export async function acceptLink(request: AcceptLinkRequest): Promise<MeResponse> {
  const reply = await send('POST', '/api/links/accept', request);
  if (reply.status !== 201) fail('/api/links/accept', reply);
  return reply.body as MeResponse;
}

/** Changes the signed-in account's own password. The other devices are signed out; this one gets a new cookie. */
export async function changePassword(request: ChangePasswordRequest): Promise<void> {
  const reply = await send('POST', '/api/auth/password', request);
  if (reply.status !== 204) fail('/api/auth/password', reply);
}

// ---- Admin > Updates and What's new ----

export async function fetchUpdates(signal?: AbortSignal): Promise<UpdatesResponse> {
  const reply = await send('GET', '/api/admin/updates', undefined, signal);
  if (reply.status !== 200) fail('/api/admin/updates', reply);
  return reply.body as UpdatesResponse;
}

export async function updateUpdateSettings(patch: Partial<UpdateSettings>): Promise<UpdateSettings> {
  const reply = await send('PATCH', '/api/admin/updates/settings', patch);
  if (reply.status !== 200) fail('/api/admin/updates/settings', reply);
  return reply.body as UpdateSettings;
}

/** Check now. Answers with the new status. */
export async function checkForUpdates(): Promise<UpdatesResponse> {
  const reply = await send('POST', '/api/admin/updates/check');
  if (reply.status !== 200) fail('/api/admin/updates/check', reply);
  return reply.body as UpdatesResponse;
}

export async function dismissUpdate(request: UpdateDismissRequest): Promise<void> {
  const reply = await send('POST', '/api/admin/updates/dismiss', request);
  if (reply.status !== 204) fail('/api/admin/updates/dismiss', reply);
}

export async function ackUpdateBackup(request: UpdateBackupAckRequest): Promise<void> {
  const reply = await send('POST', '/api/admin/updates/backup-ack', request);
  if (reply.status !== 204) fail('/api/admin/updates/backup-ack', reply);
}

/** What changed since this admin last looked (or, with `latest`, the latest update whatever was seen). */
export async function fetchWhatsNew(latest = false, signal?: AbortSignal): Promise<WhatsNewResponse> {
  const reply = await send(
    'GET',
    latest ? '/api/updates/whats-new?latest=1' : '/api/updates/whats-new',
    undefined,
    signal,
  );
  if (reply.status !== 200) fail('/api/updates/whats-new', reply);
  return reply.body as WhatsNewResponse;
}

export async function markWhatsNewSeen(): Promise<void> {
  const reply = await send('POST', '/api/updates/whats-new/seen');
  if (reply.status !== 204) fail('/api/updates/whats-new/seen', reply);
}
