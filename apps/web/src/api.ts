// SPDX-License-Identifier: AGPL-3.0-or-later
import { CSRF_HEADER, CSRF_VALUE } from '@kinship/shared';
import type {
  AccountsResponse,
  AddChildRequest,
  AddParentRequest,
  ApiErrorCode,
  ApiHealth,
  ApiVersion,
  ChildResponse,
  InvitationInput,
  LinkCreated,
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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
export async function fetchTree(
  id: string,
  options: { up: number; down: number; collateral?: boolean; lineage?: LineageView },
  signal?: AbortSignal,
): Promise<TreeResponse> {
  const query = new URLSearchParams({ up: String(options.up), down: String(options.down) });
  if (options.collateral) query.set('collateral', 'true');
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
