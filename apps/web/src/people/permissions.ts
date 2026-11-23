// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AuthUser, TreeResponse, Union } from '@kinship/shared';

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

/**
 * Who gets the "+" on their card in a chart (backlog 15): the same rule as the side panel's Add relative button, which the
 * API decides as `permissions.addChild` (admins always; a Member for their own person and the people in their line, which is
 * themselves and their descendants; a User never). A chart has no per-person permissions, so a Member's line is worked out
 * from the chart's own parent links: it may miss a descendant whose connecting line is not drawn (no "+" there; the panel
 * still offers the button), but it never shows a "+" the API would refuse. Unknown parents (placeholders) never get one, as
 * the panel hides Add relative for them.
 */
export function addableOnChart(
  user: AuthUser | undefined,
  shown: Pick<TreeResponse, 'people' | 'unions' | 'parentage'>,
) {
  const addable = new Set<string>();
  if (!user) return addable;
  const real = shown.people.filter((p) => !p.isPlaceholder);
  if (isAdmin(user)) {
    for (const person of real) addable.add(person.id);
    return addable;
  }
  if (user.role !== 'member' || user.personId === null) return addable;
  const partners = new Map(shown.unions.map((u) => [u.id, u.partnerIds as readonly string[]]));
  const children = new Map<string, string[]>();
  for (const [child, parentage] of Object.entries(shown.parentage)) {
    const parents = parentage.parentId
      ? [parentage.parentId]
      : parentage.unionId
        ? (partners.get(parentage.unionId) ?? [])
        : [];
    for (const parent of parents) children.set(parent, [...(children.get(parent) ?? []), child]);
  }
  const realIds = new Set(real.map((p) => p.id));
  const queue = [user.personId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (addable.has(id) || !realIds.has(id)) continue;
    addable.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return addable;
}
