// SPDX-License-Identifier: AGPL-3.0-or-later
import { getDisplay } from '../lib/display.js';
import { displayName, displaySurname } from '../lib/names.js';
import type { AuthUser, Person, UnionWithChildren } from '@kinship/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { ActionButton } from '../components/ActionButton.js';
import { t } from '../i18n.js';
import { lifespan, peopleById } from '../lib/people.js';
import { statusName, unionLabel } from '../lib/labels.js';
import { AddRelativeDialog } from '../people/AddRelative.js';
import { canEditUnion, isAdmin } from '../people/permissions.js';
import { EditPersonDialog } from '../people/PersonDialogs.js';
import { useFamilyAround, usePersonDetail } from '../people/queries.js';
import { EditUnionDialog } from '../people/RelationshipDialogs.js';
import { initials, otherLeafLabel } from './family.js';
import type { Leaf } from './family.js';
import { recallPanelCollapsed, rememberPanelCollapsed } from './remember.js';

/** The surname part of the name shown differs from the birth surname (a married surname is in use). Not on the card. */
export function birthSurnameShown(person: Person): boolean {
  return getDisplay().nameForm === 'married' && displaySurname(person) !== displaySurname(person, 'maiden');
}

type Open = { kind: 'edit' } | { kind: 'add' } | { kind: 'union'; union: UnionWithChildren } | null;

/** The person panel on the left of the chart: who is selected, what you can do, and their partners. */
export function TreePanel({
  personId,
  fallback,
  me,
  otherFamily,
  onOpenOther,
}: {
  personId: string;
  fallback: Person | undefined;
  me: AuthUser;
  /** The selected person's other family (birth or adoptive), if they have one: the keyboard path to the second leaf. */
  otherFamily?: Leaf | undefined;
  onOpenOther?: (leaf: Leaf) => void;
}) {
  const [collapsed, setCollapsed] = useState(recallPanelCollapsed);
  const [open, setOpen] = useState<Open>(null);
  const detail = usePersonDetail(personId);
  const around = useFamilyAround(personId);
  const person = detail.data?.person ?? fallback;
  const toggle = () => {
    rememberPanelCollapsed(!collapsed);
    setCollapsed(!collapsed);
  };

  if (collapsed) {
    return (
      <aside className="tree-panel collapsed" aria-label={t('tree.panel.label')}>
        <button
          className="button small"
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-label={t('tree.panel.expand')}
          title={t('tree.panel.expand')}
        >
          »
        </button>
        {person ? (
          <span className="rail-initials" aria-hidden="true" title={displayName(person)}>
            {initials(person)}
          </span>
        ) : null}
      </aside>
    );
  }

  const close = () => setOpen(null);
  const admin = isAdmin(me);
  const blocked = me.role === 'member' ? t('permission.memberOwnProfile') : t('permission.userReadOnly');
  const d = detail.data;
  const names = peopleById(around.data);
  const nameOf = (id: string) => {
    const found = names.get(id);
    return found ? displayName(found) : t('person.unknown');
  };

  return (
    <aside className="tree-panel" aria-label={t('tree.panel.label')}>
      <div className="panel-top">
        <button
          className="button small"
          type="button"
          onClick={toggle}
          aria-expanded={true}
          aria-label={t('tree.panel.collapse')}
          title={t('tree.panel.collapse')}
        >
          «
        </button>
      </div>
      {person ? (
        <>
          <h2 className="panel-name">{displayName(person)}</h2>
          {birthSurnameShown(person) ? (
            <div className="muted panel-birth-surname">
              {t('tree.panel.birthSurname', { surname: displaySurname(person, 'maiden') })}
            </div>
          ) : null}
          {person.isPlaceholder ? (
            <p className="muted">{t('person.placeholderNote')}</p>
          ) : (
            <>
              <div className="muted">{lifespan(person)}</div>
              <div className="pills">
                <span className={`pill ${person.deceased ? 'gray' : 'ok'}`}>
                  {person.deceased ? t('person.deceased') : t('person.living')}
                </span>
                {me.personId === person.id ? <span className="pill">{t('person.you')}</span> : null}
              </div>
            </>
          )}
          <div className="panel-actions">
            <Link className="button" to={`/people/${person.id}`}>
              {t('tree.panel.openProfile')}
            </Link>
            <ActionButton
              disabledReason={!d ? undefined : d.permissions.edit ? undefined : blocked}
              onClick={() => setOpen({ kind: 'edit' })}
              disabled={!d}
            >
              {person.isPlaceholder ? t('person.addDetails') : t('profile.edit')}
            </ActionButton>
            {person.isPlaceholder ? null : (
              <ActionButton
                disabledReason={!d ? undefined : admin || d.permissions.addChild ? undefined : blocked}
                onClick={() => setOpen({ kind: 'add' })}
                disabled={!d || !around.data}
              >
                {t('profile.addRelative')}
              </ActionButton>
            )}
          </div>
          {otherFamily?.family && onOpenOther ? (
            <button
              className="button"
              type="button"
              aria-label={otherLeafLabel(person, otherFamily.family, otherFamily.count ?? 0)}
              onClick={() => onOpenOther(otherFamily)}
            >
              {t(`tree.panel.otherFamily.${otherFamily.family}`)}
            </button>
          ) : null}
          <h3 className="panel-heading">{t('tree.panel.partners')}</h3>
          {!d ? (
            <p className="muted" role="status">
              {t('tree.panel.loading')}
            </p>
          ) : d.unions.length === 0 ? (
            <p className="muted">{t('tree.panel.noPartners')}</p>
          ) : (
            <ul className="plain partner-list">
              {d.unions.map((union) => {
                const partnerId = union.partnerIds.find((id) => id !== person.id) ?? union.partnerIds[0];
                const partner = names.get(partnerId);
                return (
                  <li key={union.id} aria-label={t('union.cardLabel', { name: nameOf(partnerId) })}>
                    <div>
                      {unionLabel(union.status, partner?.gender ?? null, partner?.deceased ?? false)}:{' '}
                      <Link to={`/people/${partnerId}`}>{nameOf(partnerId)}</Link>{' '}
                      <span className="pill">{statusName(union.status)}</span>
                    </div>
                    <ActionButton
                      small
                      disabledReason={canEditUnion(me, union) ? undefined : blocked}
                      onClick={() => setOpen({ kind: 'union', union })}
                    >
                      {t('union.edit')}
                    </ActionButton>
                  </li>
                );
              })}
            </ul>
          )}
          {open?.kind === 'edit' ? <EditPersonDialog person={person} onClose={close} /> : null}
          {open?.kind === 'add' && d && around.data ? (
            <AddRelativeDialog detail={d} tree={around.data} me={me} onClose={close} />
          ) : null}
          {open?.kind === 'union' ? (
            <EditUnionDialog
              union={open.union}
              names={[nameOf(open.union.partnerIds[0]), nameOf(open.union.partnerIds[1])]}
              onClose={close}
            />
          ) : null}
        </>
      ) : (
        <p className="muted" role="status">
          {t('tree.panel.loading')}
        </p>
      )}
    </aside>
  );
}
