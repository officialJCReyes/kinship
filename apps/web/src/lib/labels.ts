// SPDX-License-Identifier: AGPL-3.0-or-later
import { UNION_STATUSES } from '@kinship/shared';
import type { ChildLink, Gender, LinkKind, MessageKey, UnionStatus } from '@kinship/shared';
import { t } from '../i18n.js';

/**
 * What to call a partner: "Wife", "Ex-husband", "Fiancée", "Late wife" and so on. It follows the status of the
 * relationship, the partner's gender and whether the partner has died. A gender that is not male or female
 * gets a neutral word ("Partner", "Ex-partner", "Late partner"). This is the only place that decides it.
 */
export function unionLabel(status: UnionStatus, partnerGender: Gender | null, partnerDeceased: boolean): string {
  return t(unionLabelKey(status, partnerGender, partnerDeceased));
}

export function unionLabelKey(status: UnionStatus, partnerGender: Gender | null, partnerDeceased: boolean): MessageKey {
  const side = partnerGender === 'male' || partnerGender === 'female' ? partnerGender : 'neutral';
  if (status === 'widowed') return `union.label.widowed.${partnerDeceased ? 'late' : 'survivor'}.${side}` as MessageKey;
  return `union.label.${status}.${side}` as MessageKey;
}

/** The raw status, as a word for the pill next to the label. */
export function statusName(status: UnionStatus): string {
  return t(`union.status.${status}` as MessageKey);
}

export const UNION_STATUS_LIST = UNION_STATUSES;

/** "Father", "Daughter", "Half-sister" and so on, for the list of relatives on a profile. */
export function relativeLabel(kind: 'parent' | 'child' | 'sibling' | 'halfSibling', gender: Gender | null): string {
  const side = gender === 'male' || gender === 'female' ? gender : 'neutral';
  return t(`relative.${kind}.${side}` as MessageKey);
}

/**
 * What to call a parent in a list: "Father", or "Adoptive father" and "Birth father" for someone who has both
 * families (`adopted`). A plain "Father" is only for people with a birth set alone.
 */
export function parentLabel(kind: LinkKind, adopted: boolean, gender: Gender | null): string {
  const side = gender === 'male' || gender === 'female' ? gender : 'neutral';
  if (kind === 'adoptive') return t(`relative.adoptiveParent.${side}` as MessageKey);
  return adopted ? t(`relative.birthParent.${side}` as MessageKey) : relativeLabel('parent', gender);
}

/** What to call a child in a parent's list: "Son", "Adopted son", or "Birth son" for a child who was adopted away. */
export function childLabel(link: Pick<ChildLink, 'kind' | 'adopted'>, gender: Gender | null): string {
  const side = gender === 'male' || gender === 'female' ? gender : 'neutral';
  if (link.kind === 'adoptive') return t(`relative.adoptedChild.${side}` as MessageKey);
  return link.adopted ? t(`relative.birthChild.${side}` as MessageKey) : relativeLabel('child', gender);
}
