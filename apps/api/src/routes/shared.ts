// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Limiters } from '../app.js';
import { GuardSet } from '../auth/limiter.js';
import type { Database } from '../db.js';

export interface RouteDeps {
  db: Kysely<Database>;
  sessions: { idleSeconds: number; maxSeconds: number };
  limiters: Limiters;
  failureDelayMs: number;
  /** Waits out a delay limiter's verdict (sleep, or a recorder in tests). */
  pause: (ms: number) => Promise<void>;
  /** Per-address request cap for the routes that check credentials (see @fastify/rate-limit). */
  requestLimit: { max: number; timeWindow: string };
}

/** The `config` of a route that is limited by @fastify/rate-limit. */
export interface RouteLimit {
  rateLimit: { max: number; timeWindow: string; keyGenerator: (request: FastifyRequest) => string };
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length >= 3 && email.length <= 320 && EMAIL.test(email);
}

/** The longest wait, in whole seconds (at least 1), for a 429 response. */
export function retrySeconds(...waitsMs: number[]): number {
  return Math.max(1, Math.ceil(Math.max(0, ...waitsMs) / 1000));
}

/**
 * The limiters for a signed-in person typing their password again (changing it, a backup download ticket, a restore).
 * The session blocks, so a stolen cookie gets 10 guesses and no more; the account only slows down, so those guesses
 * never stop the owner's own session from changing the password (ADR 0042); the address blocks across accounts.
 */
export function passwordGuards(limiters: Limiters, request: FastifyRequest, userId: string): GuardSet {
  return new GuardSet([
    { limiter: limiters.passwordSession, key: request.sessionTokenHash ?? `ip:${request.ip}` },
    { limiter: limiters.passwordIp, key: request.ip },
    { limiter: limiters.passwordAccount, key: userId },
  ]);
}
