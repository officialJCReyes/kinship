// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Limiters } from '../app.js';
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
