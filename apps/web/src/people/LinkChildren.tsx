// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Are any of these also {name}'s children?" (ADR 0039). The children who hang from one parent alone, offered when that
// parent gets a partner or a second parent, so a child entered under one parent first can hang from both. The server lists
// only the children it would accept (GET /api/people/:id/linkable-children) and checks again when the form is saved.
import type { LinkableChild } from '@kinship/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import * as api from '../api.js';
import { t } from '../i18n.js';
import { displayName } from '../lib/names.js';
import { lifespan } from '../lib/people.js';

/** The children who hang from `parentId` alone and could also be `partnerId`'s (a new person when null). */
export function useLinkableChildren(parentId: string | null, partnerId: string | null, exclude: string | null = null) {
  return useQuery({
    queryKey: ['people', 'linkable', parentId, partnerId, exclude],
    queryFn: ({ signal }) => api.fetchLinkableChildren(parentId as string, { partner: partnerId, exclude }, signal),
    enabled: parentId !== null,
    select: (body) => body.children,
  });
}

/**
 * The checklist. Nothing shows while the list loads or when it is empty, so a form without such children looks as it always
 * did. `preselectAll` ticks every child once the list arrives (Add partner, when the person has no other relationship);
 * otherwise nothing is ticked. When the list changes (another existing partner chosen), ticks that no longer apply are dropped.
 */
export function LinkChildrenField({
  parentId,
  partnerId,
  exclude = null,
  otherName,
  preselectAll,
  value,
  onChange,
}: {
  parentId: string | null;
  partnerId: string | null;
  exclude?: string | null;
  /** The partner or new parent, as the legend names them. */
  otherName: string;
  preselectAll: boolean;
  value: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const query = useLinkableChildren(parentId, partnerId, exclude);
  const children = query.data;
  const applied = useRef<readonly LinkableChild[] | undefined>(undefined);
  useEffect(() => {
    if (!children || applied.current === children) return;
    const first = applied.current === undefined;
    applied.current = children;
    const ids = children.map((entry) => entry.child.id);
    onChange(first && preselectAll ? ids : value.filter((id) => ids.includes(id)));
    // Only a new list changes the ticks; the person's own clicks go through onChange directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  if (!children || children.length === 0) return null;
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...value.filter((v) => v !== id), id] : value.filter((v) => v !== id));
  return (
    <fieldset className="choice link-children" data-testid="link-children">
      <legend>{t('linkChildren.legend', { name: otherName })}</legend>
      <p className="muted field-help">{t('linkChildren.help')}</p>
      {children.map(({ child, kind }) => {
        const years = lifespan(child);
        return (
          <label key={child.id}>
            <input
              type="checkbox"
              checked={value.includes(child.id)}
              onChange={(event) => toggle(child.id, event.target.checked)}
            />{' '}
            {displayName(child)}
            <span className="muted">
              {years ? ` · ${years}` : ''} · {t(`linkChildren.kind.${kind}`)}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** The name of a child the server refused (`details.childId` of the error), for the message in the form. */
export function refusedChildName(error: unknown, children: readonly LinkableChild[] | undefined): string | null {
  if (!(error instanceof api.ApiError)) return null;
  const id = error.details.childId;
  const found = typeof id === 'string' ? children?.find((entry) => entry.child.id === id) : undefined;
  return found ? displayName(found.child) : null;
}
