// SPDX-License-Identifier: AGPL-3.0-or-later
import http from 'node:http';

type Env = Record<string, string | undefined>;

/**
 * Sends the api's outgoing web requests through HTTPS_PROXY (and HTTP_PROXY, honoring NO_PROXY) when they are set, using Node's
 * own support (no extra library). Only the update check makes such requests. Returns whether a proxy is in use. The address
 * itself, which may contain a password, is never logged or shown.
 */
export function useProxyFromEnv(env: Env = process.env): boolean {
  const set = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((name) => (env[name] ?? '') !== '');
  if (!set) return false;
  http.setGlobalProxyFromEnv(env);
  return true;
}
