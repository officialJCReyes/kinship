// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AuthUser, Union } from '@kinship/shared';

/** SuperAdmin and Family Admin. A convenience for showing buttons; the API and the database decide. */
export function isAdmin(user: AuthUser | undefined): boolean {
  return user?.role === 'superadmin' || user?.role === 'familyadmin';
}

/** A Member may change a relationship they are a partner in. Admins may change any. */
export function canEditUnion(user: AuthUser | undefined, union: Pick<Union, 'partnerIds'>): boolean {
  if (!user) return false;
  return (
    isAdmin(user) || (user.role === 'member' && user.personId !== null && union.partnerIds.includes(user.personId))
  );
}
