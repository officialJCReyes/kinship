// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ApiErrorCode } from '@kinship/shared';

/**
 * An error with an HTTP status and one of the API's error codes. Throw it anywhere inside a
 * request (also inside a transaction: the transaction rolls back); the error handler in app.ts
 * turns it into `{ error: code, ...extra }`.
 */
export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export const badRequest = (code: ApiErrorCode, extra?: Record<string, unknown>) => new ApiError(400, code, extra);
export const forbidden = () => new ApiError(403, 'forbidden');
export const notFound = (code: ApiErrorCode) => new ApiError(404, code);
export const conflict = (code: ApiErrorCode, extra?: Record<string, unknown>) => new ApiError(409, code, extra);

/**
 * Turns an error from Postgres into an ApiError when it is one of the rules the database
 * enforces. The API checks the same rules first, with clearer answers; this is the safety net
 * (for a race between two requests, or a check the API does not repeat), and it keeps a
 * rejected write from turning into a 500.
 */
export function fromDatabaseError(error: unknown): ApiError | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') {
    return undefined;
  }
  const constraint = 'constraint' in error && typeof error.constraint === 'string' ? error.constraint : '';
  switch (error.code) {
    case '42501': // permission denied, or a row-level security policy refused the row
    case 'KS010':
      return forbidden();
    case 'KS020':
      return new ApiError(403, 'role_not_allowed');
    case 'KS021':
      return conflict('email_taken');
    case 'KS022':
      return conflict('invitation_exists');
    case 'KS023':
      return conflict('person_already_linked');
    case 'KS024':
      return notFound('person_not_found');
    case 'KS025':
      return notFound('account_not_found');
    case 'KS026':
      return notFound('link_not_found');
    case 'KS027':
      return conflict('link_exists');
    case 'KS040':
      return conflict('account_already_linked');
    case 'KS041':
      return conflict('person_is_placeholder');
    case 'KS042':
      return conflict('person_has_open_invitation');
    case 'KS043':
      return conflict('account_not_linked');
    case 'KS030': // the one answer for every bad link (see accept_invitation)
      return notFound('invalid_link');
    case 'KS011':
      return badRequest('parent_is_self');
    case 'KS012':
      return badRequest('child_is_partner');
    case 'KS013':
      return conflict('would_create_cycle');
    case 'KS015':
      return conflict('same_person_both_kinds');
    case '23514': // check violation
      if (constraint === 'unions_end_date_status') return badRequest('end_date_not_allowed');
      if (constraint.startsWith('unions_partners_')) return badRequest('partners_identical');
      if (constraint.startsWith('relationship_labels_')) return badRequest('invalid_label');
      if (constraint.startsWith('people_death')) return badRequest('invalid_date');
      if (constraint.includes('precision') || constraint.endsWith('_check')) return badRequest('invalid_request');
      return undefined;
    case '23505': // unique violation
      if (constraint === 'relationship_labels_unique') return conflict('duplicate_label');
      return undefined;
    case '23503': // foreign key: someone was deleted while this request ran
      return notFound('person_not_found');
    default:
      return undefined;
  }
}
