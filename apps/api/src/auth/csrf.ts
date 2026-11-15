// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * CSRF protection without tokens in forms. Every state-changing request must
 * carry a custom header. A web page on another site cannot add it to a request
 * to us without a CORS preflight, and we never answer preflights, so only our
 * own pages can. Browsers also tell us where the request came from, so:
 *   - an Origin that is not this site is refused (when the browser sends one);
 *   - a request the browser marks Sec-Fetch-Site: cross-site is refused.
 * Requests with no Origin (curl, scripts) still need the header.
 */
export const CSRF_HEADER = 'x-kinship-request';
export const CSRF_VALUE = '1';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfCheck(request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void): void {
  if (SAFE_METHODS.has(request.method)) return done();

  const refuse = (reason: string) => {
    request.log.warn({ reason }, 'request refused by CSRF check');
    void reply.code(403).send({ error: 'csrf' });
  };

  if (request.headers[CSRF_HEADER] !== CSRF_VALUE) return refuse('missing header');
  if (request.headers['sec-fetch-site'] === 'cross-site') return refuse('cross-site');

  const origin = request.headers.origin;
  if (origin !== undefined) {
    let originHost: string | undefined;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = undefined;
    }
    if (originHost === undefined || originHost !== request.host) return refuse('origin mismatch');
  }
  done();
}
