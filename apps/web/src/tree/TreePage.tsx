// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName } from '../lib/names.js';
import type { LineageView, Person, UnionWithChildren } from '@kinship/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useSession } from '../auth.js';
import { ErrorState, Loading } from '../components/States.js';
import { PersonPicker } from '../components/PersonPicker.js';
import { t } from '../i18n.js';
import { canEditUnion } from '../people/permissions.js';
import { chartQuery, familyQuery } from '../people/queries.js';
import { EditUnionDialog } from '../people/RelationshipDialogs.js';

import { familyView, findLeaves, findOtherLeaves } from './family.js';
import type { Leaf } from './family.js';
import { layoutTree, relationsOf } from './layout.js';
import { prefersReducedMotion } from './motion.js';
import { recallRoot, rememberRoot } from './remember.js';
import { TreeCanvas } from './TreeCanvas.js';
import { TreePanel } from './TreePanel.js';

/** /tree: the chart rooted on you, or (for an account linked to nobody) a page to choose who to start from. */
export function TreeIndexPage() {
  const me = useSession(false).data?.user;
  const navigate = useNavigate();
  const [picked, setPicked] = useState<Person | null>(null);
  if (!me) return null;
  if (me.personId) return <Navigate to={`/tree/${me.personId}`} replace />;
  const last = recallRoot();
  if (last) return <Navigate to={`/tree/${last}`} replace />;
  return (
    <div className="page-width choose-root">
      <section className="card stack">
        <h1>{t('tree.choose.title')}</h1>
        <p>{t('tree.choose.body')}</p>
        <PersonPicker label={t('tree.choose.label')} value={picked} onChange={setPicked} />
        <div className="actions">
          <button
            className="button primary"
            type="button"
            disabled={!picked}
            onClick={() => picked && void navigate(`/tree/${picked.id}`)}
          >
            {t('tree.choose.go')}
          </button>
        </div>
      </section>
    </div>
  );
}

/** /tree/:id, and /tree/:id?of=:personId for the flipped family view. ?sel= is the selected person. */
export function TreePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const me = useSession(false).data?.user;
  const of = params.get('of');
  const sel = params.get('sel');
  // A family view can follow one family for the whole flip: ?of=…&lineage=birth (or adoptive).
  const rawLineage = params.get('lineage');
  const lineage: LineageView | undefined = rawLineage === 'birth' || rawLineage === 'adoptive' ? rawLineage : undefined;
  const [editing, setEditing] = useState<UnionWithChildren | null>(null);
  const [flip, setFlip] = useState<'out' | 'in' | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const main = useQuery(chartQuery(id));
  const family = useQuery({ ...familyQuery(of ?? '', lineage), enabled: of !== null });
  useEffect(() => {
    if (main.isSuccess) rememberRoot(id);
  }, [main.isSuccess, id]);

  const focalId = of ?? id;
  const familyData = family.data;
  const shown = useMemo(
    () => (of ? (familyData ? familyView(familyData, of) : undefined) : main.data),
    [of, familyData, main.data],
  );
  const people = useMemo(() => new Map((shown?.people ?? []).map((p) => [p.id, p as Person])), [shown]);
  const layout = useMemo(
    () =>
      shown ? layoutTree({ focalId, people: shown.people, unions: shown.unions, parentage: shown.parentage }) : null,
    [shown, focalId],
  );
  const relations = useMemo(() => (shown ? relationsOf(shown) : null), [shown]);
  const leaves = useMemo(
    () =>
      new Map(
        (shown ? findLeaves(shown, focalId, main.data, of !== null, of !== null ? lineage : undefined) : []).map(
          (leaf) => [leaf.personId, leaf],
        ),
      ),
    [shown, focalId, main.data, of, lineage],
  );
  const otherLeaves = useMemo(
    () => new Map((shown ? findOtherLeaves(shown, main.data, of !== null) : []).map((leaf) => [leaf.personId, leaf])),
    [shown, main.data, of],
  );
  const unionsById = useMemo(() => new Map((shown?.unions ?? []).map((u) => [u.id, u])), [shown]);

  const selectedId = sel ?? focalId;
  const select = useCallback(
    (personId: string) =>
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('sel', personId);
        return next;
      }),
    [setParams],
  );

  // A turn of about half a second, then the other chart; with reduced motion the other chart is just there.
  const turnTo = useCallback(
    async (go: () => void, prefetchFamilyOf?: string, prefetchLineage?: LineageView) => {
      if (prefetchFamilyOf) {
        await client.prefetchQuery(familyQuery(prefetchFamilyOf, prefetchLineage)).catch(() => undefined);
      }
      if (prefersReducedMotion()) return go();
      setFlip('out');
      timers.current.push(
        window.setTimeout(() => {
          go();
          setFlip('in');
          timers.current.push(window.setTimeout(() => setFlip(null), 260));
        }, 250),
      );
    },
    [client, setFlip],
  );
  const openLeaf = useCallback(
    (leaf: Leaf) => {
      const keep = sel ? `sel=${encodeURIComponent(sel)}` : '';
      const withKeep = (query: string) => (keep ? `${query}${query ? '&' : ''}${keep}` : query);
      const target = leaf.target;
      if (target.kind === 'root') {
        void navigate(`/tree/${target.personId}${keep ? `?${keep}` : ''}`);
      } else if (target.kind === 'main') {
        void turnTo(() => void navigate(`/tree/${id}${keep ? `?${keep}` : ''}`));
      } else {
        const query = `of=${encodeURIComponent(target.personId)}${target.lineage ? `&lineage=${target.lineage}` : ''}`;
        void turnTo(() => void navigate(`/tree/${id}?${withKeep(query)}`), target.personId, target.lineage);
      }
    },
    [navigate, id, sel, turnTo],
  );

  const canEdit = useCallback(
    (unionId: string) => {
      const union = unionsById.get(unionId);
      return Boolean(union && canEditUnion(me, union));
    },
    [me, unionsById],
  );
  const openUnion = useCallback(
    (unionId: string) => {
      const union = unionsById.get(unionId);
      if (!union || !layout) return;
      const link = layout.links.find((l) => l.unionId === unionId);
      setEditing({
        ...union,
        children: (link?.childIds ?? []).map((id) => ({
          id,
          kind: shown?.parentage[id]?.kind ?? 'birth',
          link: null,
          adopted: false,
        })),
      });
    },
    [unionsById, layout, setEditing, shown],
  );

  if (!me) return null;
  const failure = main.error ?? (of ? family.error : null);
  if (failure) {
    return (
      <div className="page-width">
        <ErrorState error={failure} onRetry={() => void (main.isError ? main.refetch() : family.refetch())} />
      </div>
    );
  }
  if (!shown || !layout || !relations) {
    return (
      <div className="page-width">
        <Loading />
      </div>
    );
  }

  const owner = people.get(focalId);
  const names = editing
    ? (editing.partnerIds.map((p) => (people.get(p) ? displayName(people.get(p)!) : t('person.unknown'))) as [
        string,
        string,
      ])
    : null;
  return (
    <div className="tree-page">
      <h1 className="sr-only">{t('tree.title')}</h1>
      <TreePanel
        personId={selectedId}
        fallback={people.get(selectedId)}
        me={me}
        otherFamily={otherLeaves.get(selectedId)}
        onOpenOther={openLeaf}
      />
      <div className={`tree-stage${flip ? ` flip-${flip}` : ''}`}>
        <TreeCanvas
          key={`${id}|${of ?? ''}|${lineage ?? ''}`}
          layout={layout}
          people={people}
          focalId={focalId}
          selectedId={selectedId}
          leaves={leaves}
          otherLeaves={otherLeaves}
          parents={relations.parents}
          children={relations.children}
          canEditUnion={canEdit}
          onSelect={select}
          onLeaf={openLeaf}
          onCouple={openUnion}
          topLeft={
            of && owner ? (
              <span className="tree-label">
                {lineage
                  ? t(`tree.familyOf.${lineage}`, { name: owner.givenName })
                  : t('tree.familyOf', { name: owner.givenName })}
              </span>
            ) : null
          }
          topRight={
            me.personId && me.personId !== id ? (
              <button className="button" type="button" onClick={() => void navigate(`/tree/${me.personId}`)}>
                {t('tree.centerOnMe')}
              </button>
            ) : null
          }
        />
      </div>
      {editing && names ? (
        <EditUnionDialog
          union={editing}
          names={names}
          partners={editing.partnerIds.map((p) => people.get(p))}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
