// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one way the api talks to GitHub: a GET with a fixed set of headers, a hard time limit, a hard size limit, and redirects
// followed by hand, only to GitHub's own hosts over HTTPS. Nothing about this installation is sent: no version, no token, no
// cookies, no identifier. (Node's fetch adds a few fixed headers of its own, such as Accept-Language: *.)

/** The only user agent KinShip uses for the update check. It carries no version and nothing about the install. */
export const USER_AGENT = 'KinShip-update-check';
export const MAX_REDIRECTS = 3;

export type HostCheck = (url: URL) => boolean;

/** GitHub's own hosts: the site, the API, and the hosts that serve release assets. */
export const githubHosts: HostCheck = (url) =>
  url.protocol === 'https:' &&
  url.port === '' &&
  url.username === '' &&
  url.password === '' &&
  (url.hostname === 'github.com' ||
    url.hostname === 'api.github.com' ||
    url.hostname.endsWith('.githubusercontent.com'));

export type FetchFailure = 'offline' | 'timeout' | 'too_large' | 'redirect_refused' | 'rate_limited' | 'bad_status';

export class FetchError extends Error {
  override name = 'FetchError';
  constructor(
    readonly failure: FetchFailure,
    /** Seconds GitHub asked us to wait, when it said. */
    readonly retryAfterSeconds?: number,
  ) {
    super(failure);
  }
}

export interface GetResult {
  status: number;
  etag: string | null;
  body: Buffer;
}

export interface GetOptions {
  fetch?: typeof fetch;
  allowHost?: HostCheck;
  maxBytes: number;
  timeoutMs: number;
  /** Stops the whole check, whatever is running. */
  signal?: AbortSignal;
  headers?: Record<string, string>;
  now?: () => number;
}

function retryAfter(headers: Headers, now: number): number | undefined {
  const asNumber = Number(headers.get('retry-after'));
  if (Number.isFinite(asNumber) && asNumber > 0) return Math.ceil(asNumber);
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset * 1000 > now) return Math.ceil((reset * 1000 - now) / 1000);
  }
  return undefined;
}

/** Reads at most `maxBytes` of a response body; a longer one is cut off and refused. */
async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new FetchError('too_large');
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FetchError('too_large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * GET `url` (which the caller built from constants and validated versions; never from text in a response). Returns the
 * status and the body for 200 and 304; throws a FetchError for everything else.
 */
export async function getLimited(url: string, options: GetOptions): Promise<GetResult> {
  const doFetch = options.fetch ?? fetch;
  const allowHost = options.allowHost ?? githubHosts;
  const now = options.now ?? Date.now;
  let target = new URL(url);
  if (!allowHost(target)) throw new FetchError('redirect_refused');
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs), ...(options.signal ? [options.signal] : [])]);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await doFetch(target, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': USER_AGENT, ...options.headers },
        // Nothing else is sent: no cookies, no referrer, no credentials.
        credentials: 'omit',
        referrer: '',
      });
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      ) {
        throw new FetchError('timeout');
      }
      throw new FetchError('offline');
    }
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      void response.body?.cancel().catch(() => undefined);
      const location = response.headers.get('location');
      let next: URL;
      try {
        next = new URL(location ?? '', target);
      } catch {
        throw new FetchError('redirect_refused');
      }
      if (!allowHost(next)) throw new FetchError('redirect_refused');
      target = next;
      continue;
    }
    if (response.status === 403 || response.status === 429) {
      void response.body?.cancel().catch(() => undefined);
      const wait = retryAfter(response.headers, now());
      // GitHub answers 403 for a few other reasons too; only a rate limit says how long to wait.
      throw new FetchError(wait !== undefined || response.status === 429 ? 'rate_limited' : 'bad_status', wait);
    }
    if (response.status !== 200 && response.status !== 304) {
      void response.body?.cancel().catch(() => undefined);
      throw new FetchError('bad_status');
    }
    const body =
      response.status === 304
        ? Buffer.alloc(0)
        : await readLimited(response, options.maxBytes).catch((error: unknown) => {
            if (error instanceof FetchError) throw error;
            throw new FetchError(signal.aborted ? 'timeout' : 'offline');
          });
    return { status: response.status, etag: response.headers.get('etag'), body };
  }
  throw new FetchError('redirect_refused');
}
