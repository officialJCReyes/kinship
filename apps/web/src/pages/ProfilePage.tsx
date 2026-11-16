// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
  AuthUser,
  ChildLink,
  LinkKind,
  Person,
  PersonDetail,
  TreeResponse,
  UnionWithChildren,
} from '@kinship/shared';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import * as api from '../api.js';
import { useSession } from '../auth.js';
import { ActionButton } from '../components/ActionButton.js';
import { Dialog } from '../components/Dialog.js';
import { ErrorState, Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { formatDate, formatYear } from '../lib/dates.js';
import { errorMessage } from '../lib/errors.js';
import { childLabel, parentLabel, relativeLabel, statusName, unionLabel } from '../lib/labels.js';
import { lifespan, mergeTrees, parentIdsOf, peopleById, personName, siblingsOf } from '../lib/people.js';
import { useNotices } from '../notices.js';
import { AddRelativeDialog } from '../people/AddRelative.js';
import { canEditUnion, isAdmin } from '../people/permissions.js';
import { EditLinkDialog } from '../people/LinkDialogs.js';
import { useSetLineage } from '../people/lineage.js';
import { EditPersonDialog } from '../people/PersonDialogs.js';
import { useFamilyAround, usePersonDetail, useRefreshPeople } from '../people/queries.js';
import { DeletePersonDialog, DeleteUnionDialog, EditUnionDialog } from '../people/RelationshipDialogs.js';
import { useMutation } from '@tanstack/react-query';

type Open =
  | { kind: 'edit' }
  | { kind: 'add' }
  | { kind: 'delete' }
  | { kind: 'editUnion'; union: UnionWithChildren }
  | { kind: 'deleteUnion'; union: UnionWithChildren }
  | { kind: 'removeParent'; parent: Person }
  | { kind: 'editLink'; linkKind: LinkKind }
  | null;

function PersonLink({ person, label }: { person: Person; label?: string | undefined }) {
  return (
    <Link to={`/people/${person.id}`}>
      {personName(person)}
      {person.deceased ? ' †' : ''}
      {label ? <span className="muted"> · {label}</span> : null}
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="profile-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** "Adopted son, 1938" or "Son": what a parent's list calls a child. */
function childLabelText(link: ChildLink, child: Person): string {
  const label = childLabel(link, child.gender);
  return link.kind === 'adoptive' && link.link ? `${label}, ${formatYear(link.link)}` : label;
}

function reasonFor(me: AuthUser): string {
  return me.role === 'member' ? t('permission.memberOwnProfile') : t('permission.userReadOnly');
}

function RemoveParentDialog({ child, parent, onClose }: { child: Person; parent: Person; onClose: () => void }) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const remove = useMutation({ mutationFn: () => api.removeParent(child.id, parent.id) });
  return (
    <Dialog title={t('parents.removeTitle')} onClose={onClose}>
      <p>{t('parents.removeBody', { parent: personName(parent), child: personName(child) })}</p>
      {remove.isError ? (
        <div className="alert" role="alert">
          {errorMessage(remove.error)}
        </div>
      ) : null}
      <div className="actions">
        <ActionButton onClick={onClose}>{t('common.cancel')}</ActionButton>
        <ActionButton
          danger
          disabled={remove.isPending}
          onClick={() => {
            void remove
              .mutateAsync()
              .then(async () => {
                await refresh();
                notify('success', t('notice.parentRemoved'));
                onClose();
              })
              .catch(() => undefined);
          }}
        >
          {t('parents.removeSubmit')}
        </ActionButton>
      </div>
    </Dialog>
  );
}

function ProfileView({ detail, tree, me }: { detail: PersonDetail; tree: TreeResponse; me: AuthUser }) {
  const [open, setOpen] = useState<Open>(null);
  const { person, permissions } = detail;
  // The profile lists both families, so it also asks for the view this account is not following (when needed).
  const adoptedPerson = detail.parents.adoptive !== null;
  const otherView = me.lineageView === 'adoptive' ? 'birth' : 'adoptive';
  // Always asked: a parent's list of children includes the ones adopted away, who are only in the other view.
  const other = useFamilyAround(person.id, otherView);
  const bothTree = mergeTrees(tree, other.data);
  const people = peopleById(bothTree);
  const setLineage = useSetLineage();
  const admin = isAdmin(me);
  const close = () => setOpen(null);
  const nameOf = (id: string) => {
    const found = people.get(id);
    return found ? personName(found) : t('person.unknown');
  };

  // Adoptive family first, then the birth family; a person with only a birth set has just "Parents".
  const families = (['adoptive', 'birth'] as LinkKind[]).flatMap((kind) => {
    const set = detail.parents[kind];
    return set
      ? [
          {
            kind,
            set,
            parents: parentIdsOf(set, bothTree.unions)
              .map((id) => people.get(id))
              .filter((p): p is Person => p !== undefined),
          },
        ]
      : [];
  });
  const siblings = siblingsOf(tree, person.id);
  const withLinks = (links: ChildLink[]) =>
    links.flatMap((link) => {
      const child = people.get(link.id);
      return child ? [{ child, link }] : [];
    });
  const singleChildren = withLinks(detail.singleParentChildren);

  const blocked = reasonFor(me);
  const editReason = permissions.edit ? undefined : blocked;
  const addReason = admin || permissions.addChild ? undefined : blocked;

  return (
    <div className="stack">
      <section className="card">
        <div className="profile-head">
          <div>
            <h1>{personName(person)}</h1>
            <div className="muted">{lifespan(person)}</div>
            <div className="pills">
              <span className={`pill ${person.deceased ? 'gray' : 'ok'}`}>
                {person.deceased ? t('person.deceased') : t('person.living')}
              </span>
              {me.personId === person.id ? <span className="pill">{t('person.you')}</span> : null}
            </div>
          </div>
          <div className="actions wrap">
            <ActionButton disabledReason={editReason} onClick={() => setOpen({ kind: 'edit' })}>
              {t('profile.edit')}
            </ActionButton>
            <ActionButton disabledReason={addReason} onClick={() => setOpen({ kind: 'add' })}>
              {t('profile.addRelative')}
            </ActionButton>
            {permissions.delete ? (
              <ActionButton danger onClick={() => setOpen({ kind: 'delete' })}>
                {t('profile.delete')}
              </ActionButton>
            ) : null}
          </div>
        </div>
        <h2 className="sr-only">{t('profile.facts')}</h2>
        <dl className="facts">
          <dt>{t('person.givenName')}</dt>
          <dd>{person.givenName}</dd>
          <dt>{t('person.surname')}</dt>
          <dd>{person.surname}</dd>
          <dt>{t('person.born')}</dt>
          <dd>{formatDate(person.birth) || t('person.notRecorded')}</dd>
          <dt>{person.deceased ? t('person.died') : t('person.status')}</dt>
          <dd>{person.deceased ? formatDate(person.death) || t('person.notRecorded') : t('person.living')}</dd>
          <dt>{t('person.gender')}</dt>
          <dd>{person.gender ? t(`person.gender.${person.gender}`) : t('person.gender.unknown')}</dd>
          <dt>{t('person.account')}</dt>
          <dd>{detail.hasAccount ? t('person.accountLinked') : t('person.accountNone')}</dd>
        </dl>
      </section>

      {adoptedPerson ? (
        <section className="notice info adoption-banner" aria-label={t('profile.family.adoptive')}>
          <p>{t(`adoption.banner.${me.lineageView}`, { name: person.givenName })}</p>
          <p className="muted">{t('adoption.bannerNote')}</p>
          <ActionButton small disabled={setLineage.isPending} onClick={() => setLineage.mutate(otherView)}>
            {setLineage.isPending ? t('adoption.switching') : t(`adoption.switch.${otherView}`)}
          </ActionButton>
        </section>
      ) : null}

      <Section title={t('profile.parents')}>
        {families.length === 0 ? <p className="muted">{t('profile.noParents')}</p> : null}
        {families.map(({ kind, set, parents }) => (
          <div key={kind} className="family-block">
            {adoptedPerson ? <h3>{t(`profile.family.${kind}`)}</h3> : null}
            <ul className="plain">
              {parents.map((parent) => (
                <li key={parent.id}>
                  <PersonLink person={parent} label={parentLabel(kind, adoptedPerson, parent.gender)} />{' '}
                  {admin ? (
                    <ActionButton small onClick={() => setOpen({ kind: 'removeParent', parent })}>
                      {t('parents.remove', { name: personName(parent) })}
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
            {kind === 'adoptive' || set.link ? (
              <p className="muted">
                {set.link ? `${formatDate(set.link)} ` : ''}
                {admin ? (
                  <ActionButton small onClick={() => setOpen({ kind: 'editLink', linkKind: kind })}>
                    {t('link.edit')}
                  </ActionButton>
                ) : null}
              </p>
            ) : null}
          </div>
        ))}
        {adoptedPerson && !detail.parents.birth ? (
          <div className="family-block">
            <h3>{t('profile.family.birth')}</h3>
            <p className="muted">{t('profile.family.notRecorded')}</p>
          </div>
        ) : null}
      </Section>

      <Section title={t('profile.partners')}>
        {detail.unions.length === 0 ? <p className="muted">{t('profile.noPartners')}</p> : null}
        <div className="stack">
          {detail.unions.map((union) => {
            const partnerId = union.partnerIds.find((id) => id !== person.id) ?? union.partnerIds[0];
            const partner = people.get(partnerId);
            const canEdit = canEditUnion(me, union);
            const children = withLinks(union.children);
            return (
              <article
                key={union.id}
                className="card inner"
                aria-label={t('union.cardLabel', { name: nameOf(partnerId) })}
              >
                <div className="profile-head">
                  <div>
                    <h3>
                      {unionLabel(union.status, partner?.gender ?? null, partner?.deceased ?? false)}:{' '}
                      {partner ? <PersonLink person={partner} /> : t('person.unknown')}
                    </h3>
                  </div>
                  <span className="pill">{statusName(union.status)}</span>
                </div>
                <dl className="facts">
                  <dt>{t('union.start')}</dt>
                  <dd>{formatDate(union.start) || t('person.notRecorded')}</dd>
                  {union.end ? (
                    <>
                      <dt>{t(`union.end.${union.status as 'divorced' | 'separated' | 'annulment'}`)}</dt>
                      <dd>{formatDate(union.end)}</dd>
                    </>
                  ) : null}
                  <dt>{t('union.childrenTogether')}</dt>
                  <dd>
                    {children.length ? (
                      <ul className="plain">
                        {children.map(({ child, link }) => (
                          <li key={child.id}>
                            <PersonLink person={child} label={childLabelText(link, child)} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted">{t('union.noChildren')}</span>
                    )}
                  </dd>
                </dl>
                <div className="actions wrap">
                  <ActionButton
                    small
                    disabledReason={canEdit ? undefined : blocked}
                    onClick={() => setOpen({ kind: 'editUnion', union })}
                  >
                    {t('union.edit')}
                  </ActionButton>
                  {admin ? (
                    <ActionButton small danger onClick={() => setOpen({ kind: 'deleteUnion', union })}>
                      {t('union.delete')}
                    </ActionButton>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </Section>

      {singleChildren.length > 0 ? (
        <Section title={t('profile.singleParentChildren')}>
          <p className="muted">{t('profile.singleParentHelp')}</p>
          <ul className="plain">
            {singleChildren.map(({ child, link }) => (
              <li key={child.id}>
                <PersonLink person={child} label={childLabelText(link, child)} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={t('profile.siblings')}>
        {siblings.full.length + siblings.half.length === 0 ? <p className="muted">{t('profile.noSiblings')}</p> : null}
        {siblings.full.length > 0 ? (
          <ul className="plain" aria-label={t('profile.fullSiblings')}>
            {siblings.full.map((sibling) => (
              <li key={sibling.id}>
                <PersonLink person={sibling} label={relativeLabel('sibling', sibling.gender)} />
              </li>
            ))}
          </ul>
        ) : null}
        {siblings.half.length > 0 ? (
          <>
            <h3>{t('profile.halfSiblings')}</h3>
            <ul className="plain" aria-label={t('profile.halfSiblings')}>
              {siblings.half.map((sibling) => (
                <li key={sibling.id}>
                  <PersonLink person={sibling} label={relativeLabel('halfSibling', sibling.gender)} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Section>

      {open?.kind === 'edit' ? <EditPersonDialog person={person} onClose={close} /> : null}
      {open?.kind === 'add' ? <AddRelativeDialog detail={detail} tree={bothTree} me={me} onClose={close} /> : null}
      {open?.kind === 'editLink' ? (
        <EditLinkDialog
          child={person}
          kind={open.linkKind}
          parentNames={parentIdsOf(detail.parents[open.linkKind], bothTree.unions).map(nameOf).join(' & ')}
          current={detail.parents[open.linkKind]?.link ?? null}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'delete' ? <DeletePersonDialog person={person} onClose={close} /> : null}
      {open?.kind === 'editUnion' ? (
        <EditUnionDialog
          union={open.union}
          names={[nameOf(open.union.partnerIds[0]), nameOf(open.union.partnerIds[1])]}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'deleteUnion' ? (
        <DeleteUnionDialog
          union={open.union}
          names={[nameOf(open.union.partnerIds[0]), nameOf(open.union.partnerIds[1])]}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'removeParent' ? (
        <RemoveParentDialog child={person} parent={open.parent} onClose={close} />
      ) : null}
    </div>
  );
}

export function ProfilePage() {
  const { id } = useParams();
  const me = useSession(false).data?.user;
  const detail = usePersonDetail(id);
  const around = useFamilyAround(id);
  if (!me) return null;
  if (detail.isPending || around.isPending) return <Loading />;
  if (detail.isError || around.isError) {
    const error = detail.error ?? around.error;
    return (
      <div className="stack">
        <ErrorState error={error} onRetry={() => void (detail.isError ? detail.refetch() : around.refetch())} />
        <p>
          <Link to="/people">{t('profile.backToPeople')}</Link>
        </p>
      </div>
    );
  }
  return <ProfileView key={detail.data.person.id} detail={detail.data} tree={around.data} me={me} />;
}
