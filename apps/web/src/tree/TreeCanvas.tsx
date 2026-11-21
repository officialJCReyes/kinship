// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName } from '../lib/names.js';
import type { Person, UnionStatus } from '@kinship/shared';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { t } from '../i18n.js';
import { useDisplay } from '../lib/display.js';
import { lifespan } from '../lib/people.js';
import { statusName } from '../lib/labels.js';
import { fitName, measureText } from './cardText.js';
import { initials, leafLabel, nodeLabel, otherLeafLabel } from './family.js';
import type { Leaf } from './family.js';
import { NODE_H, NODE_W } from './layout.js';
import type { Layout, PlacedCouple, PlacedLink, PlacedNode } from './layout.js';
import { Legend } from './Legend.js';
import { ZoomControls } from './ZoomControls.js';
import type { TreeViewName } from './treeView.js';
import { useChartViewport, ZOOM_STEP } from './useChartViewport.js';

/** Solid line for people who are together, dotted for a relationship that ended or is not a marriage. */
export const SOLID_STATUSES: readonly UnionStatus[] = ['married', 'engaged', 'partner', 'widowed'];
export const isSolid = (status: UnionStatus): boolean => SOLID_STATUSES.includes(status);

/** The rectangle a link covers (its children and the line down to them), for deciding whether to draw it. */
function linkBounds(
  layout: Layout,
  coupleById: ReadonlyMap<string, PlacedCouple>,
  link: PlacedLink,
): [number, number, number, number] {
  if (link.bounds) return link.bounds;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of link.childIds) {
    const n = layout.byId.get(id)!;
    x0 = Math.min(x0, n.x);
    x1 = Math.max(x1, n.x);
    y0 = Math.min(y0, n.y);
    y1 = Math.max(y1, n.y);
  }
  const parents = link.unionId ? coupleById.get(link.unionId) : undefined;
  const parent = link.parentId ? layout.byId.get(link.parentId) : undefined;
  const hx = parents?.hangX ?? parent?.x ?? x0;
  const hy = parents?.hangY ?? (parent ? parent.y + NODE_H : y0);
  return [Math.min(x0, hx), Math.min(y0, hy), Math.max(x1, hx), Math.max(y1, hy)];
}

// ------------------------------------------------------------------ nodes

/** Where the name starts and the room it has: right of the avatar, and a margin on the right. */
const NAME_X = 48;
const NAME_WIDTH = NODE_W - NAME_X - 10;
/** The dates line: font size, line height and the gap above it. */
const YEARS_LINE = 14;
const YEARS_GAP = 3;

/** Smaller than the name: the Descendants view lists partners under the dates, on up to two lines. */
const NOTE_SIZE = 11;
const NOTE_LINES = 2;

interface NodeProps {
  node: PlacedNode;
  /** The card's height: NODE_H, or more where there is a note. */
  height: number;
  person: Person;
  selected: boolean;
  focusable: boolean;
  leaf: Leaf | undefined;
  /** The second leaf (the person's other family), on the left. */
  otherLeaf: Leaf | undefined;
  /** Zoomed far out: just the box, since nothing inside it can be read. */
  simple: boolean;
  /** Draw † after the name of someone who has died (the account's choice in the chart settings). */
  mark: boolean;
  /** Changes with the account's name choices, so a card is drawn again when one of them does (the cards are memoized). */
  names: string;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onLeaf: (leaf: Leaf) => void;
}

const TreeNode = memo(function TreeNode({
  node,
  height,
  person,
  selected,
  focusable,
  leaf,
  otherLeaf,
  simple,
  mark,
  onSelect,
  onFocus,
  onLeaf,
}: NodeProps) {
  const full = displayName(person);
  const label = nodeLabel(person);
  // The whole name, wrapped on up to three lines (smaller type if it needs it), never cut. A no-break space keeps the
  // deceased mark with the last word.
  const fit = useMemo(
    () => fitName(full + (person.deceased && mark ? '\u00a0†' : ''), NAME_WIDTH),
    [full, person.deceased, mark],
  );
  // A placeholder has no sex to show: it is drawn neutral and dashed, whatever gender the database keeps for its label.
  const gender = person.isPlaceholder
    ? 'placeholder'
    : person.gender === 'male' || person.gender === 'female'
      ? person.gender
      : 'other';
  const years = lifespan(person);
  const noteFit = useMemo(
    () => (node.note ? fitName(node.note, NAME_WIDTH, measureText, NOTE_LINES, NOTE_SIZE) : null),
    [node.note],
  );
  // The name and the dates line are centred together as one block; the dates line is always counted, so a card with no
  // dates is the same height and its name sits where it would.
  const top = (NODE_H - (fit.lines.length * fit.lineHeight + YEARS_GAP + YEARS_LINE)) / 2;
  return (
    <g transform={`translate(${node.x - NODE_W / 2} ${node.y})`}>
      <g
        className={`tnode ${gender}${person.deceased ? ' deceased' : ''}${selected ? ' selected' : ''}`}
        data-node={person.id}
        role="button"
        tabIndex={focusable ? 0 : -1}
        aria-label={label}
        aria-pressed={selected}
        onClick={() => onSelect(person.id)}
        onFocus={() => onFocus(person.id)}
      >
        <title>{full}</title>
        <rect className="ring" x={-5} y={-5} width={NODE_W + 10} height={height + 10} rx={14} />
        <rect className="box" width={NODE_W} height={height} rx={10} />
        {simple ? null : (
          <>
            <circle className="avatar" cx={25} cy={NODE_H / 2} r={15} />
            {person.isPlaceholder ? (
              <path className="plus" d={`M25 ${NODE_H / 2 - 6}V${NODE_H / 2 + 6}M19 ${NODE_H / 2}H31`} />
            ) : (
              <text className="ini" x={25} y={NODE_H / 2 + 4} textAnchor="middle">
                {initials(person)}
              </text>
            )}
            <text className="name" x={NAME_X} style={{ fontSize: fit.size }} data-lines={fit.lines.length}>
              {fit.lines.map((line, index) => (
                <tspan key={index} x={NAME_X} y={top + index * fit.lineHeight + fit.size * 0.82}>
                  {line}
                </tspan>
              ))}
            </text>
            <text
              className="years"
              x={NAME_X}
              y={top + fit.lines.length * fit.lineHeight + YEARS_GAP + YEARS_LINE * 0.75}
            >
              {years}
            </text>
            {noteFit ? (
              <text className="note" x={NAME_X} style={{ fontSize: noteFit.size }}>
                {noteFit.lines.map((line, index) => (
                  <tspan key={index} x={NAME_X} y={NODE_H - 2 + index * noteFit.lineHeight + noteFit.size * 0.8}>
                    {line}
                  </tspan>
                ))}
              </text>
            ) : null}
          </>
        )}
      </g>
      {leaf ? (
        <g
          className="leaf"
          data-nopan
          data-leaf={person.id}
          role="button"
          tabIndex={-1}
          aria-label={leafLabel(person, leaf.count)}
          transform={`translate(${NODE_W - 36} 0)`}
          onClick={(event) => {
            event.stopPropagation();
            onLeaf(leaf);
          }}
        >
          <title>{leafLabel(person, leaf.count)}</title>
          <circle className="hit" cx={0} cy={-9} r={16} />
          <path className="stem" d="M0 0V-4" />
          <g transform="translate(0 -3) scale(0.5)">
            <path className="blade" d="M0 0C-17-5-19-27 0-38C19-27 17-5 0 0Z" />
            <path className="vein" d="M0-4V-30M0-14L-7-21M0-20L7-27" />
          </g>
        </g>
      ) : null}
      {otherLeaf?.family ? (
        <g
          className="leaf other"
          data-nopan
          data-leaf-other={person.id}
          role="button"
          tabIndex={-1}
          aria-label={otherLeafLabel(person, otherLeaf.family, otherLeaf.count ?? 0)}
          transform="translate(36 0)"
          onClick={(event) => {
            event.stopPropagation();
            onLeaf(otherLeaf);
          }}
        >
          <title>{otherLeafLabel(person, otherLeaf.family, otherLeaf.count ?? 0)}</title>
          <circle className="hit" cx={0} cy={-9} r={16} />
          <path className="stem" d="M0 0V-4" />
          <g transform="translate(0 -3) scale(0.5)">
            <path className="blade" d="M0 0C-17-5-19-27 0-38C19-27 17-5 0 0Z" />
            <path className="vein" d="M0-4V-30M0-14L-7-21M0-20L7-27" />
          </g>
        </g>
      ) : null}
    </g>
  );
});

// ------------------------------------------------------------------ couple lines

interface CoupleProps {
  couple: PlacedCouple;
  title: string;
  editable: boolean;
  onOpen: (unionId: string) => void;
}

const CoupleLine = memo(function CoupleLine({ couple, title, editable, onOpen }: CoupleProps) {
  const solid = isSolid(couple.status);
  return (
    <g className={`couple ${solid ? 'solid' : 'dotted'}`} aria-hidden="true" data-union={couple.unionId}>
      <path className="line" data-line={solid ? 'solid' : 'dotted'} d={couple.d} />
      <path
        className={`hit${editable ? ' editable' : ''}`}
        d={couple.d}
        onClick={editable ? () => onOpen(couple.unionId) : undefined}
      >
        <title>{title}</title>
      </path>
    </g>
  );
});

// ------------------------------------------------------------------ the canvas

export interface TreeCanvasProps {
  layout: Layout;
  people: ReadonlyMap<string, Person>;
  focalId: string;
  selectedId: string;
  leaves: ReadonlyMap<string, Leaf>;
  otherLeaves: ReadonlyMap<string, Leaf>;
  parents: ReadonlyMap<string, string[]>;
  children: ReadonlyMap<string, string[]>;
  canEditUnion: (unionId: string) => boolean;
  onSelect: (id: string) => void;
  onLeaf: (leaf: Leaf) => void;
  onCouple: (unionId: string) => void;
  /** Scroll this person into view (no zoom change) when `n` changes: the chart's search chose someone already drawn. */
  revealRequest?: { id: string; n: number } | null;
  /** Which view this is: it sets the first view of the chart and the legend. The default is the Family tree. */
  view?: TreeViewName;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /** The legend says that aunts, uncles and cousins are not drawn. */
  relativesHidden?: boolean;
}

export function TreeCanvas(props: TreeCanvasProps) {
  const {
    layout,
    people,
    focalId,
    selectedId,
    leaves,
    otherLeaves,
    parents,
    children,
    canEditUnion,
    onSelect,
    onLeaf,
    onCouple,
    view = 'family',
  } = props;
  const helpId = useId();
  const display = useDisplay();
  const namesKey = `${display.nameForm}|${display.showPrefix}|${display.showSuffix}`;
  const nodeHeight = layout.nodeHeight ?? NODE_H;
  const focus = layout.byId.get(focalId);
  const { wrap, svg, viewport, simple, inView, fit, zoomBy, showRect, drawNow, pointerHandlers } = useChartViewport({
    content: { width: layout.width, height: layout.height },
    focus: focus && { x: focus.x, y: focus.y + NODE_H / 2 },
    start: view === 'family' ? 'family' : 'fit',
  });
  const [focusId, setFocusId] = useState(selectedId);
  const pendingFocus = useRef<{ id: string; selector: 'node' | 'leaf' | 'leaf-other' } | null>(null);

  // Keyboard: one tab stop (the focused box); arrows move along the row, to a parent and to a child.
  const focusNode = useCallback(
    (id: string, selector: 'node' | 'leaf' | 'leaf-other' = 'node') => {
      const placed = layout.byId.get(id);
      if (placed) showRect({ x: placed.x - NODE_W / 2, y: placed.y - 24, width: NODE_W, height: nodeHeight + 24 });
      const el = wrap.current?.querySelector<SVGElement>(`[data-${selector}="${CSS.escape(id)}"]`);
      if (el) el.focus();
      else {
        // Not drawn yet (it was off screen): draw what is now in view, then focus it.
        pendingFocus.current = { id, selector };
        drawNow();
      }
    },
    [layout, showRect, drawNow, wrap, nodeHeight],
  );
  // The search chose someone who is drawn: bring their card into view without changing the zoom (the same move as the
  // keyboard makes), and draw it if it was off screen.
  const revealN = props.revealRequest?.n;
  const revealId = props.revealRequest?.id;
  useEffect(() => {
    if (revealN === undefined || revealId === undefined) return;
    const placed = layout.byId.get(revealId);
    if (!placed) return;
    showRect({ x: placed.x - NODE_W / 2, y: placed.y - 24, width: NODE_W, height: nodeHeight + 24 });
    drawNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealN]);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const el = wrap.current?.querySelector<SVGElement>(`[data-${pending.selector}="${CSS.escape(pending.id)}"]`);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });
  const nearest = (from: PlacedNode, ids: readonly string[] | undefined): string | undefined => {
    let best: string | undefined;
    let bestDistance = Infinity;
    for (const id of ids ?? []) {
      const n = layout.byId.get(id);
      if (!n) continue;
      const d = Math.abs(n.x - from.x);
      if (d < bestDistance) {
        best = id;
        bestDistance = d;
      }
    }
    return best;
  };
  const onKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    const target = event.target as Element;
    const leafEl = target.closest('[data-leaf]');
    const otherEl = target.closest('[data-leaf-other]');
    const nodeEl = target.closest('[data-node]');
    const onAnyLeaf = Boolean(leafEl ?? otherEl);
    const id = leafEl
      ? leafEl.getAttribute('data-leaf')
      : otherEl
        ? otherEl.getAttribute('data-leaf-other')
        : nodeEl?.getAttribute('data-node');
    if (event.key === '+' || event.key === '=') return void (event.preventDefault(), zoomBy(ZOOM_STEP));
    if (event.key === '-' || event.key === '_') return void (event.preventDefault(), zoomBy(1 / ZOOM_STEP));
    if (event.key === '0') return void (event.preventDefault(), fit());
    if (!id) return;
    const placed = layout.byId.get(id);
    if (!placed) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (onAnyLeaf) {
        const leaf = (leafEl ? leaves : otherLeaves).get(id);
        if (leaf) onLeaf(leaf);
      } else {
        onSelect(id);
      }
      return;
    }
    if (layout.navigate) {
      // A view with its own idea of "next to": columns of ancestors or descendants.
      if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown'
      ) {
        event.preventDefault();
        const to = layout.navigate(id, event.key);
        if (to) focusNode(to);
      }
      return;
    }
    let next: string | undefined;
    let as: 'node' | 'leaf' | 'leaf-other' = 'node';
    const row = layout.rows[placed.row] ?? [];
    const at = row.indexOf(id);
    if (event.key === 'ArrowLeft' && !onAnyLeaf) next = row[at - 1];
    else if (event.key === 'ArrowRight' && !onAnyLeaf) next = row[at + 1];
    else if (event.key === 'ArrowUp') {
      if (onAnyLeaf) return;
      next = nearest(placed, parents.get(id));
      if (!next && leaves.has(id)) {
        next = id;
        as = 'leaf';
      } else if (!next && otherLeaves.has(id)) {
        next = id;
        as = 'leaf-other';
      }
    } else if (event.key === 'ArrowDown') {
      next = onAnyLeaf ? id : nearest(placed, children.get(id));
    } else if (onAnyLeaf && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      // Between a person's two leaves, when they have both.
      if (leafEl && otherLeaves.has(id)) [next, as] = [id, 'leaf-other'];
      else if (otherEl && leaves.has(id)) [next, as] = [id, 'leaf'];
    } else return;
    event.preventDefault();
    if (next) focusNode(next, as);
  };

  // Tell screen readers what was selected.
  const selectedPerson = people.get(selectedId);
  const announce = selectedPerson ? t('tree.selected', { name: displayName(selectedPerson) }) : '';

  const onFocusNode = useCallback((id: string) => setFocusId(id), []);
  const focusableId = layout.byId.has(focusId) ? focusId : layout.byId.has(selectedId) ? selectedId : focalId;

  const bounds = useMemo(() => {
    const coupleById = new Map(layout.couples.map((c) => [c.unionId, c]));
    return new Map(layout.links.map((link) => [link.key, linkBounds(layout, coupleById, link)]));
  }, [layout]);
  const nodes = useMemo(
    () =>
      layout.nodes.map((node) => {
        const near =
          node.id === focusableId ||
          node.id === selectedId ||
          inView(node.x - NODE_W / 2, node.y, node.x + NODE_W / 2, node.y + nodeHeight);
        if (!near) return null;
        const person = people.get(node.id);
        if (!person) return null;
        return (
          <TreeNode
            key={node.id}
            node={node}
            height={nodeHeight}
            person={person}
            selected={node.id === selectedId}
            focusable={node.id === focusableId}
            leaf={leaves.get(node.id)}
            otherLeaf={otherLeaves.get(node.id)}
            simple={simple}
            mark={display.showDeceasedMark}
            names={namesKey}
            onSelect={onSelect}
            onFocus={onFocusNode}
            onLeaf={onLeaf}
          />
        );
      }),
    [
      layout,
      people,
      selectedId,
      focusableId,
      leaves,
      otherLeaves,
      simple,
      display.showDeceasedMark,
      namesKey,
      inView,
      onSelect,
      onFocusNode,
      onLeaf,
      nodeHeight,
    ],
  );
  const couples = useMemo(
    () =>
      layout.couples.map((couple) => {
        if (!inView(couple.x1 - NODE_W / 2, couple.y - NODE_H, couple.x2 + NODE_W / 2, couple.y + NODE_H)) return null;
        const a = people.get(couple.left);
        const b = people.get(couple.right);
        const title = t('tree.couple', {
          status: statusName(couple.status),
          a: a ? displayName(a) : t('person.unknown'),
          b: b ? displayName(b) : t('person.unknown'),
        });
        return (
          <CoupleLine
            key={couple.unionId}
            couple={couple}
            title={title}
            editable={canEditUnion(couple.unionId)}
            onOpen={onCouple}
          />
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- namesKey: the couples' titles name people in the account's name form
    [layout, people, canEditUnion, onCouple, inView, namesKey],
  );

  return (
    <div className="tree-canvas" ref={wrap}>
      <p id={helpId} className="sr-only">
        {t('tree.chartHelp')}
      </p>
      <svg
        ref={svg}
        role="group"
        aria-label={t('tree.chartLabel')}
        aria-describedby={helpId}
        {...pointerHandlers}
        onKeyDown={onKeyDown}
      >
        <g ref={viewport}>
          <g className="links" aria-hidden="true">
            {layout.links.map((link) =>
              inView(...(bounds.get(link.key) ?? [0, 0, 0, 0])) ? (
                <path key={link.key} className="edge" d={link.d} />
              ) : null,
            )}
          </g>
          <g className="couples">{couples}</g>
          {layout.titles?.length || layout.slots?.length ? (
            <g className="extras" aria-hidden="true">
              {layout.titles?.map((title) => (
                <text key={title.key} className="column-title" x={title.x} y={title.y}>
                  {title.text}
                </text>
              ))}
              {layout.slots?.map((slot) =>
                inView(slot.x, slot.y, slot.x + NODE_W, slot.y + NODE_H) ? (
                  <g key={slot.key} className="empty-slot" transform={`translate(${slot.x} ${slot.y})`}>
                    <rect width={NODE_W} height={NODE_H} rx={10} />
                    {simple ? null : (
                      <text x={16} y={NODE_H / 2 + 4}>
                        {slot.label}
                      </text>
                    )}
                  </g>
                ) : null,
              )}
            </g>
          ) : null}
          <g className="nodes">{nodes}</g>
        </g>
      </svg>
      <div className="tree-overlay top-left">{props.topLeft}</div>
      <div className="tree-overlay top-right">{props.topRight}</div>
      <Legend view={view} deceasedMark={display.showDeceasedMark} relativesHidden={props.relativesHidden ?? false} />
      <ZoomControls onZoomIn={() => zoomBy(ZOOM_STEP)} onZoomOut={() => zoomBy(1 / ZOOM_STEP)} onFit={fit} />
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
