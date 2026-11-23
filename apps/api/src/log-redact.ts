// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the request log may say about a URL. A few routes take a one-time secret in the query string because a browser download
// cannot send a header or a body (the backup download ticket, #74): the log keeps the path and the other parameters, and the
// secret's value is replaced. nginx keeps query strings out of its access log altogether (apps/web/nginx/default.conf).
import type { FastifyRequest } from 'fastify';

/** Query parameters whose values are secrets. Compared without regard to case. */
export const SECRET_QUERY_PARAMS = ['ticket', 'token'] as const;

export const REDACTED = '[redacted]';

/** The URL with the value of every secret query parameter replaced; anything else is returned as it was. */
export function redactUrl(url: string): string {
  const mark = url.indexOf('?');
  if (mark === -1) return url;
  const query = url
    .slice(mark + 1)
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=');
      const name = eq === -1 ? part : part.slice(0, eq);
      let decoded = name;
      try {
        decoded = decodeURIComponent(name.replace(/\+/g, ' '));
      } catch {
        // a malformed name is compared as written
      }
      return (SECRET_QUERY_PARAMS as readonly string[]).includes(decoded.toLowerCase()) ? `${name}=${REDACTED}` : part;
    })
    .join('&');
  return `${url.slice(0, mark)}?${query}`;
}

/** Fastify's own request serializer, with the URL redacted. */
export function serializeRequest(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: redactUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}
