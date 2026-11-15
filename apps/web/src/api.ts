// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ApiHealth, ApiVersion } from '@kinship/shared';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function getJson(path: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A proxy error page (for example 502 when the API is down) is not JSON.
    throw new ApiError(`${path} did not return JSON`, response.status);
  }
  return { status: response.status, body };
}

export async function fetchVersion(signal?: AbortSignal): Promise<ApiVersion> {
  const { status, body } = await getJson('/api/version', signal);
  if (status !== 200 || typeof body !== 'object' || body === null || !('version' in body)) {
    throw new ApiError('Unexpected response from /api/version', status);
  }
  return body as ApiVersion;
}

/** 503 with a JSON body is a normal answer ("database unreachable"), not an error. */
export async function fetchHealth(signal?: AbortSignal): Promise<ApiHealth> {
  const { status, body } = await getJson('/api/health', signal);
  if ((status !== 200 && status !== 503) || typeof body !== 'object' || body === null || !('status' in body)) {
    throw new ApiError('Unexpected response from /api/health', status);
  }
  return body as ApiHealth;
}
