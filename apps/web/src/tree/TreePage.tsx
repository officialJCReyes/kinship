// SPDX-License-Identifier: AGPL-3.0-or-later
import { useDisplay } from '../lib/display.js';
import { displayName } from '../lib/names.js';
import type { LineageView, Person, UnionWithChildren } from '@kinship/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useSession } from '../auth.js';
import { ErrorState, Loading } from '../components/States.js';
import { TreeSearch } from './TreeSearch.js';
import { PersonPicker } from '../components/PersonPicker.js';
import { t } from '../i18n.js';
import { canEditUnion } from '../people/permissions.js';
import { ancestorsQuery, chartQuery, descendantsQuery, familyQuery } from '../people/queries.js';
import { EditUnionDialog } from '../people/RelationshipDialogs.js';

import type { Leaf } from './family.js';
import { isSecondClick } from './doubleActivate.js';
import type { ChartClick, ClickPoint } from './doubleActivate.js';
import { prefersReducedMotion } from './motion.js';
import { recallRoot, rememberRoot } from './remember.js';
import { FanCanvas } from './FanCanvas.js';
import { TreeCanvas } from './TreeCanvas.js';
import { TreePanel } from './TreePanel.js';
import { AVAILABLE_VIEWS, entryAddress, parseTreeView, treeViewQuery, viewState } from './treeView.js';
import type { TreeViewName } from './treeView.js';
import { descendantsModel, familyModel, fanModel, pedigreeModel } from './viewModels.js';
import type { ChartModel } from './viewModels.js';
import { ChartSettings } from './ChartSettings.js';
import { ViewSwitcher } from './ViewSwitcher.js';

/** /tree: the chart rooted on you, or (for an account linked to nobody) a page to choose who to start from. */
export function TreeIndexPage() {
  const me = useSession(false).data?.user;
  const navigate = useNavigate();
  const [picked, setPicked] = useState<Person | null>(null);
  if (!me) return null;
  if (me.personId) return <Navigate to={entryAddress(me.personId, me.treeDefaultView)} replace />;
  const last = recallRoot();
  if (last) return <Navigate to={entryAddress(last, me.treeDefaultView)} replace />;
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
            onClick={() => picked && void navigate(entryAddress(picked.id, me.treeDefaultView))}
          >
            {t('tree.choose.go')}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * /tree/:id, and /tree/:id?of=:personId for the flipped family view. ?sel= is the selected person.
 * /tree/:id?view=pedigree|fan|descendants&gen=N is one of the views that follow one person (ADR 0026).
 */
export function TreePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const me = useSession(false).data?.user;
  const { view, gen } = parseTreeView(params);
  // What the account's name and † choices draw into a model (a layout holds the names it measured): a new model when they change.
  const display = useDisplay();
  const displayKey = `${display.nameForm}|${display.showPrefix}|${display.showSuffix}|${display.showDeceasedMark}`;
  const isFamily = view === 'family';
  // The family view and the selection belong to the Family tree; the other views are about one person, who is the root.
  const of = isFamily ? params.get('of') : null;
  const sel = isFamily ? params.get('sel') : null;
  // A family view can follow one family for the whole flip: ?of=…&lineage=birth (or adoptive).
  const rawLineage = isFamily ? params.get('lineage') : null;
  const lineage: LineageView | undefined = rawLineage === 'birth' || rawLineage === 'adoptive' ? rawLineage : undefined;
  const [editing, setEditing] = useState<UnionWithChildren | null>(null);
  const [flip, setFlip] = useState<'out' | 'in' | null>(null);
  // The search chose someone who is drawn: ask the chart to scroll to them and the panel to open.
  const [found, setFound] = useState<{ id: string; n: number } | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const main = useQuery({ ...chartQuery(id, me?.showExtendedRelatives ?? false), enabled: isFamily });
  const family = useQuery({ ...familyQuery(of ?? '', lineage), enabled: of !== null });
  const ancestors = useQuery({ ...ancestorsQuery(id, gen), enabled: view === 'pedigree' || view === 'fan' });
  const descendants = useQuery({ ...descendantsQuery(id, gen), enabled: view === 'descendants' });
  const active = isFamily ? main : view === 'descendants' ? descendants : ancestors;
  useEffect(() => {
    if (active.isSuccess) rememberRoot(id);
  }, [active.isSuccess, id]);

  const current = useMemo<ChartModel | null>(() => {
    if (isFamily) return familyModel({ id, of, lineage, main: main.data, family: family.data });
    if (view === 'pedigree') return ancestors.data ? pedigreeModel(ancestors.data, id, gen) : null;
    if (view === 'fan') return ancestors.data ? fanModel(ancestors.data, id, gen) : null;
    if (view === 'descendants') return descendants.data ? descendantsModel(descendants.data, id, gen) : null;
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayKey: the models read the display store
  }, [isFamily, view, id, gen, of, lineage, main.data, family.data, ancestors.data, descendants.data, displayKey]);
  // The chart on screen stays until the next one has arrived, so choosing a view or a person does not blink to empty.
  // (Staying in the Family tree keeps its own loading state, as it always had.)
  const [kept, setKept] = useState<ChartModel | null>(null);
  if (current && current !== kept) setKept(current);
  const chart = current ?? (!isFamily || kept?.view !== 'family' ? kept : null);
  const busy = chart !== null && chart !== current;

  const focalId = chart?.focalId ?? id;
  const shown = chart?.shown;
  const people = useMemo(() => chart?.people ?? new Map<string, Person>(), [chart]);
  const chartFamily = chart?.view === 'family';

  const selectedId = chartFamily ? (sel ?? focalId) : focalId;
  // Read by Shift+Enter's handler without making it (and so every card) change with each selection.
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  /** The chart rooted on a person, in the view the address names. */
  const rootUrl = useCallback(
    (personId: string, keep?: string) => {
      const query = [treeViewQuery({ view, gen }), keep ?? ''].filter(Boolean).join('&');
      return `/tree/${personId}${query ? `?${query}` : ''}`;
    },
    [view, gen],
  );
  const select = useCallback(
    (personId: string) => {
      // In the Family tree a click selects; in the other views it makes that person the root, as the views are about one person.
      if (!chartFamily) return void navigate(rootUrl(personId));
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('sel', personId);
        return next;
      });
    },
    [chartFamily, navigate, rootUrl, setParams],
  );

  // A double-click (or double-tap) on a person, or Shift+Enter, opens the side panel even when it is collapsed, without
  // changing the remembered collapse choice (backlog 14), as choosing someone in the search does. The first click has already
  // selected (or, outside the Family tree, re-rooted on) that person, so the second only opens the panel. It is told from a
  // single click by time and place (doubleActivate.ts), and it always opens the FIRST click's person: after a re-root another
  // card may be under the pointer.
  const [opened, setOpened] = useState(0);
  const lastClick = useRef<ChartClick | null>(null);
  const activate = useCallback(
    (personId: string, point?: ClickPoint) => {
      const at = performance.now();
      const first = lastClick.current;
      // In the Family tree nothing moves, so a double-click is on one person; in the other views the first click re-rooted
      // the chart, so the second may land on whoever is drawn there now.
      if (isSecondClick(first, at, point) && (!chartFamily || first.id === personId)) {
        lastClick.current = null;
        setOpened((n) => n + 1);
        return;
      }
      lastClick.current = point ? { id: personId, at, ...point } : null;
      select(personId);
    },
    [select, chartFamily],
  );
  const openPanel = useCallback(
    (personId: string) => {
      lastClick.current = null;
      if (personId !== selectedIdRef.current) select(personId);
      setOpened((n) => n + 1);
    },
    [select],
  );

  // A person chosen in the chart's search. In the Family tree someone drawn is selected and brought into view (no change
  // of zoom); someone not drawn becomes the new root, selected. In the other views the person always becomes the root.
  const find = useCallback(
    (person: Person) => {
      if (!isFamily) {
        void navigate(rootUrl(person.id));
      } else if (people.has(person.id)) {
        select(person.id);
        setFound((previous) => ({ id: person.id, n: (previous?.n ?? 0) + 1 }));
      } else {
        void navigate(`/tree/${person.id}?sel=${encodeURIComponent(person.id)}`);
      }
    },
    [isFamily, people, select, navigate, rootUrl, setFound],
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

  // The switcher: a new view is about the person selected now, and a family view goes back to the normal chart.
  const switchView = useCallback(
    (next: TreeViewName) => {
      const query = treeViewQuery(viewState(next));
      void navigate(`/tree/${sel ?? of ?? id}${query ? `?${query}` : ''}`);
    },
    [navigate, sel, of, id],
  );
  const switchGen = useCallback(
    (next: number) => void navigate(`/tree/${id}?${treeViewQuery({ view, gen: next })}`),
    [navigate, id, view],
  );

  const unionsById = chart?.unionsById;
  const canEdit = useCallback(
    (unionId: string) => {
      const union = unionsById?.get(unionId);
      return Boolean(union && canEditUnion(me, union));
    },
    [me, unionsById],
  );
  const openUnion = useCallback(
    (unionId: string) => {
      const union = unionsById?.get(unionId);
      if (!union || !chart) return;
      const link = chart.layout.links.find((l) => l.unionId === unionId);
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
    [unionsById, chart, setEditing, shown],
  );

  if (!me) return null;
  const failure = active.error ?? (of ? family.error : null);
  if (failure) {
    return (
      <div className="page-width">
        <ErrorState error={failure} onRetry={() => void (active.isError ? active.refetch() : family.refetch())} />
      </div>
    );
  }
  if (!chart || !shown) {
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
  const topLeft = (
    <>
      {of && owner && chartFamily ? (
        <span className="tree-label">
          {lineage
            ? t(`tree.familyOf.${lineage}`, { name: owner.givenName })
            : t('tree.familyOf', { name: owner.givenName })}
        </span>
      ) : null}
      <TreeSearch onChoose={find} />
      <span className="tree-count">
        {t('tree.count', {
          shown: shown.people.filter((p) => !p.isPlaceholder).length,
          total: shown.totalPeople,
        })}
      </span>
    </>
  );
  const topRight = (
    <>
      {me.personId && me.personId !== id ? (
        <button className="button" type="button" onClick={() => void navigate(rootUrl(me.personId!))}>
          {t('tree.centerOnMe')}
        </button>
      ) : null}
      <div className="tree-tools">
        {AVAILABLE_VIEWS.length > 1 ? (
          <ViewSwitcher view={view} gen={gen} views={AVAILABLE_VIEWS} onView={switchView} onGen={switchGen} />
        ) : null}
        <ChartSettings user={me} />
      </div>
    </>
  );
  return (
    <div className="tree-page" aria-busy={busy || undefined}>
      <h1 className="sr-only">{t('tree.title')}</h1>
      <TreePanel
        personId={selectedId}
        fallback={people.get(selectedId)}
        me={me}
        otherFamily={chart.otherLeaves.get(selectedId)}
        onOpenOther={openLeaf}
        expandSignal={(found?.n ?? 0) + opened}
      />
      <div className={`tree-stage${flip ? ` flip-${flip}` : ''}`}>
        {chart.fan ? (
          <FanCanvas
            key={chart.key}
            layout={chart.fan}
            people={people}
            selectedId={selectedId}
            onSelect={activate}
            onOpen={openPanel}
            topLeft={topLeft}
            topRight={topRight}
            wheel={me.treeWheel}
          />
        ) : (
          <TreeCanvas
            key={chart.key}
            layout={chart.layout}
            people={people}
            focalId={focalId}
            selectedId={selectedId}
            leaves={chart.leaves}
            otherLeaves={chart.otherLeaves}
            parents={chart.parents}
            children={chart.children}
            canEditUnion={canEdit}
            onSelect={activate}
            onOpen={openPanel}
            onLeaf={openLeaf}
            onCouple={openUnion}
            revealRequest={found}
            view={chart.view}
            relativesHidden={chartFamily && (!me.showExtendedRelatives || of !== null)}
            wheel={me.treeWheel}
            topLeft={topLeft}
            topRight={topRight}
          />
        )}
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
