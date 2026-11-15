// SPDX-License-Identifier: AGPL-3.0-or-later
import { CSRF_HEADER, CSRF_VALUE } from '@kinship/shared';
import type {
  ApiErrorCode,
  ApiHealth,
  ApiVersion,
  LoginRequest,
  MeResponse,
  SetupRequest,
  SetupStatus,
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

async function send(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<Reply> {
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

export async function setup(request: SetupRequest): Promise<MeResponse> {
  const reply = await send('POST', '/api/setup', request);
  if (reply.status !== 201) fail('/api/setup', reply);
  return reply.body as MeResponse;
}
