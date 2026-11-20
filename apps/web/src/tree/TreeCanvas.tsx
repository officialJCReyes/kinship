// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName } from '../lib/names.js';
import type { Person, UnionStatus } from '@kinship/shared';
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { t } from '../i18n.js';
import { lifespan } from '../lib/people.js';
import { statusName } from '../lib/labels.js';
import { fitName } from './cardText.js';
import { initials, leafLabel, nodeLabel, otherLeafLabel } from './family.js';
import type { Leaf } from './family.js';
import { NODE_H, NODE_W } from './layout.js';
import { prefersReducedMotion } from './motion.js';
import type { Layout, PlacedCouple, PlacedLink, PlacedNode } from './layout.js';
import { distance, fitView, initialView, reveal, transformOf, zoomAt } from './viewport.js';
import type { View } from './viewport.js';

/** Solid line for people who are together, dotted for a relationship that ended or is not a marriage. */
export const SOLID_STATUSES: readonly UnionStatus[] = ['married', 'engaged', 'partner', 'widowed'];
export const isSolid = (status: UnionStatus): boolean => SOLID_STATUSES.includes(status);

const DRAG_THRESHOLD = 4;
const ZOOM_STEP = 1.25;
/** Below this zoom a box is drawn without its text and glyph: nothing inside it could be read. */
const SIMPLE_BELOW = 0.3;

interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  simple: boolean;
}

/** What to draw for a view: the window with a margin around it (kept while the window stays inside it). */
function regionFor(v: View, b: { width: number; height: number }, prev: Region | null): Region {
  const x0 = -v.x / v.k;
  const y0 = -v.y / v.k;
  const x1 = x0 + b.width / v.k;
  const y1 = y0 + b.height / v.k;
  const simple = v.k < SIMPLE_BELOW;
  if (prev && prev.simple === simple && x0 >= prev.x0 && y0 >= prev.y0 && x1 <= prev.x1 && y1 <= prev.y1) return prev;
  const px = (x1 - x0) * 0.75;
  const py = (y1 - y0) * 0.75;
  return { x0: x0 - px, y0: y0 - py, x1: x1 + px, y1: y1 + py, simple };
}

/** The rectangle a link covers (its children and the line down to them), for deciding whether to draw it. */
function linkBounds(
  layout: Layout,
  coupleById: ReadonlyMap<string, PlacedCouple>,
  link: PlacedLink,
): [number, number, number, number] {
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

interface NodeProps {
  node: PlacedNode;
  person: Person;
  selected: boolean;
  focusable: boolean;
  leaf: Leaf | undefined;
  /** The second leaf (the person's other family), on the left. */
  otherLeaf: Leaf | undefined;
  /** Zoomed far out: just the box, since nothing inside it can be read. */
  simple: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onLeaf: (leaf: Leaf) => void;
}

const TreeNode = memo(function TreeNode({
  node,
  person,
  selected,
  focusable,
  leaf,
  otherLeaf,
  simple,
  onSelect,
  onFocus,
  onLeaf,
}: NodeProps) {
  const full = displayName(person);
  const label = nodeLabel(person);
  // The whole name, wrapped on up to three lines (smaller type if it needs it), never cut. A no-break space keeps the
  // deceased mark with the last word.
  const fit = useMemo(() => fitName(full + (person.deceased ? '\u00a0†' : ''), NAME_WIDTH), [full, person.deceased]);
  // A placeholder has no sex to show: it is drawn neutral and dashed, whatever gender the database keeps for its label.
  const gender = person.isPlaceholder
    ? 'placeholder'
    : person.gender === 'male' || person.gender === 'female'
      ? person.gender
      : 'other';
  const years = lifespan(person);
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
        <rect className="ring" x={-5} y={-5} width={NODE_W + 10} height={NODE_H + 10} rx={14} />
        <rect className="box" width={NODE_W} height={NODE_H} rx={10} />
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
  topLeft?: ReactNode;
  topRight?: ReactNode;
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
  } = props;
  const helpId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const viewport = useRef<SVGGElement>(null);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const frame = useRef<number>(0);
  const [focusId, setFocusId] = useState(selectedId);
  // What is drawn: the window plus a margin, and whether the boxes are drawn in full. Panning moves one <g> without
  // touching this; it is looked at again when the pointer stops (so only what is near the window is in the page).
  const [region, setRegion] = useState<Region>(() => {
    // Before the first paint, guess the window from the page size so the first render is already trimmed.
    const guess = { width: Math.max(window.innerWidth - 300, 400), height: Math.max(window.innerHeight - 60, 300) };
    const focus = layout.byId.get(focalId);
    const first = initialView(
      { width: layout.width, height: layout.height },
      guess,
      focus && { x: focus.x, y: focus.y + NODE_H / 2 },
    );
    return regionFor(first, guess, null);
  });
  const cullTimer = useRef(0);
  const pendingFocus = useRef<{ id: string; selector: 'node' | 'leaf' | 'leaf-other' } | null>(null);

  // clientWidth/Height, not getBoundingClientRect: the box is not distorted while the chart is turning.
  const box = useCallback(() => {
    const el = wrap.current;
    return {
      width: el && el.clientWidth > 0 ? el.clientWidth : 900,
      height: el && el.clientHeight > 0 ? el.clientHeight : 600,
    };
  }, []);

  const cullNow = useCallback(() => {
    const b = box();
    const v = view.current;
    setRegion((prev) => regionFor(v, b, prev));
  }, [box]);
  const scheduleCull = useCallback(() => {
    window.clearTimeout(cullTimer.current);
    cullTimer.current = window.setTimeout(cullNow, 90);
  }, [cullNow]);
  useEffect(() => () => window.clearTimeout(cullTimer.current), []);

  // Panning and zooming move one <g>; React is not involved, so nothing is re-rendered while the pointer moves.
  const apply = useCallback(
    (next: View) => {
      view.current = next;
      viewport.current?.setAttribute('transform', transformOf(next));
      scheduleCull();
    },
    [scheduleCull],
  );
  const animateTo = useCallback(
    (target: View) => {
      cancelAnimationFrame(frame.current);
      if (prefersReducedMotion()) {
        apply(target);
        return;
      }
      const from = view.current;
      const started = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - started) / 160);
        const e = 1 - (1 - p) ** 3;
        apply({
          k: from.k + (target.k - from.k) * e,
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
        });
        if (p < 1) frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    },
    [apply],
  );
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const fit = useCallback(
    () => animateTo(fitView({ width: layout.width, height: layout.height }, box())),
    [animateTo, layout.width, layout.height, box],
  );
  const zoomBy = useCallback(
    (factor: number) => {
      const b = box();
      animateTo(zoomAt(view.current, factor, b.width / 2, b.height / 2));
    },
    [animateTo, box],
  );

  // The first view for this chart (the canvas is remounted for a different root, so this runs once per chart).
  useLayoutEffect(() => {
    const focus = layout.byId.get(focalId);
    apply(
      initialView(
        { width: layout.width, height: layout.height },
        box(),
        focus && { x: focus.x, y: focus.y + NODE_H / 2 },
      ),
    );
    cullNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wheel and trackpad pinch zoom around the pointer. A native listener, because React's wheel is passive.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelAnimationFrame(frame.current);
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      apply(zoomAt(view.current, factor, event.clientX - rect.left, event.clientY - rect.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [apply]);

  // Drag to pan, two fingers to pinch. Press on a leaf (or any control) does nothing here, and the pointer is only
  // captured once the drag really starts, so that a click on a box or a leaf still arrives where it was aimed.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; startX: number; startY: number; origin: View; pinch: number } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as Element).closest('[data-nopan]')) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    cancelAnimationFrame(frame.current);
    const [first, second] = [...pointers.current.values()];
    gesture.current = {
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      origin: view.current,
      pinch: first && second ? distance(first, second) : 0,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [first, second] = [...pointers.current.values()];
    const rect = svg.current!.getBoundingClientRect();
    if (first && second) {
      const now = distance(first, second);
      if (g.pinch > 0) {
        const mid = { x: (first.x + second.x) / 2 - rect.left, y: (first.y + second.y) / 2 - rect.top };
        apply(zoomAt(view.current, now / g.pinch, mid.x, mid.y));
      }
      g.pinch = now;
      g.moved = true;
      return;
    }
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!g.moved) {
      g.moved = true;
      svg.current?.setPointerCapture?.(event.pointerId);
      wrap.current?.classList.add('panning');
    }
    apply({ k: g.origin.k, x: g.origin.x + dx, y: g.origin.y + dy });
  };
  const endPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (gesture.current?.moved) {
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    wrap.current?.classList.remove('panning');
    if (pointers.current.size === 0) gesture.current = null;
    else if (gesture.current) {
      const [rest] = [...pointers.current.values()];
      gesture.current = { ...gesture.current, startX: rest!.x, startY: rest!.y, origin: view.current, pinch: 0 };
    }
  };

  // Keyboard: one tab stop (the focused box); arrows move along the row, to a parent and to a child.
  const focusNode = useCallback(
    (id: string, selector: 'node' | 'leaf' | 'leaf-other' = 'node') => {
      const placed = layout.byId.get(id);
      if (placed) {
        apply(
          reveal(
            view.current,
            { x: placed.x - NODE_W / 2, y: placed.y - 24, width: NODE_W, height: NODE_H + 24 },
            box(),
          ),
        );
      }
      const el = wrap.current?.querySelector<SVGElement>(`[data-${selector}="${CSS.escape(id)}"]`);
      if (el) el.focus();
      else {
        // Not drawn yet (it was off screen): draw what is now in view, then focus it.
        pendingFocus.current = { id, selector };
        window.clearTimeout(cullTimer.current);
        cullNow();
      }
    },
    [layout, apply, box, cullNow],
  );
  // The search chose someone who is drawn: bring their card into view without changing the zoom (the same move as the
  // keyboard makes), and draw it if it was off screen.
  const revealN = props.revealRequest?.n;
  const revealId = props.revealRequest?.id;
  useEffect(() => {
    if (revealN === undefined || revealId === undefined) return;
    const placed = layout.byId.get(revealId);
    if (!placed) return;
    apply(
      reveal(view.current, { x: placed.x - NODE_W / 2, y: placed.y - 24, width: NODE_W, height: NODE_H + 24 }, box()),
    );
    cullNow();
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

  const onClickCapture = (event: React.MouseEvent) => {
    if (suppressClick.current) {
      event.stopPropagation();
      event.preventDefault();
    }
  };

  // Tell screen readers what was selected.
  const selectedPerson = people.get(selectedId);
  const announce = selectedPerson ? t('tree.selected', { name: displayName(selectedPerson) }) : '';

  const onFocusNode = useCallback((id: string) => setFocusId(id), []);
  const focusableId = layout.byId.has(focusId) ? focusId : layout.byId.has(selectedId) ? selectedId : focalId;

  const inView = useCallback(
    (x0: number, y0: number, x1: number, y1: number) =>
      x1 >= region.x0 && x0 <= region.x1 && y1 >= region.y0 && y0 <= region.y1,
    [region],
  );
  const simple = region.simple;
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
          inView(node.x - NODE_W / 2, node.y, node.x + NODE_W / 2, node.y + NODE_H);
        if (!near) return null;
        const person = people.get(node.id);
        if (!person) return null;
        return (
          <TreeNode
            key={node.id}
            node={node}
            person={person}
            selected={node.id === selectedId}
            focusable={node.id === focusableId}
            leaf={leaves.get(node.id)}
            otherLeaf={otherLeaves.get(node.id)}
            simple={simple}
            onSelect={onSelect}
            onFocus={onFocusNode}
            onLeaf={onLeaf}
          />
        );
      }),
    [layout, people, selectedId, focusableId, leaves, otherLeaves, simple, inView, onSelect, onFocusNode, onLeaf],
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
    [layout, people, canEditUnion, onCouple, inView],
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClickCapture={onClickCapture}
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
          <g className="nodes">{nodes}</g>
        </g>
      </svg>
      <div className="tree-overlay top-left">{props.topLeft}</div>
      <div className="tree-overlay top-right">{props.topRight}</div>
      <Legend />
      <div className="zoom" role="group" aria-label={t('tree.zoomControls')} data-nopan>
        <button
          className="button"
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          aria-label={t('tree.zoomIn')}
          title={t('tree.zoomIn')}
        >
          +
        </button>
        <button
          className="button"
          type="button"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          aria-label={t('tree.zoomOut')}
          title={t('tree.zoomOut')}
        >
          −
        </button>
        <button className="button" type="button" onClick={fit} aria-label={t('tree.fit')} title={t('tree.fit')}>
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <details className="legend" open>
      <summary>{t('tree.legend.title')}</summary>
      <div role="group" aria-label={t('tree.legend.title')} className="legend-rows">
        <div className="legend-row">
          <svg width="34" height="10" aria-hidden="true">
            <path d="M0 5H34" className="swatch-solid" />
          </svg>
          <span>{t('tree.legend.together')}</span>
        </div>
        <div className="legend-row">
          <svg width="34" height="10" aria-hidden="true">
            <path d="M2 5H34" className="swatch-dotted" />
          </svg>
          <span>{t('tree.legend.ended')}</span>
        </div>
        <div className="legend-row">
          <span className="swatch male" aria-hidden="true" />
          <span>{t('person.gender.male')}</span>
          <span className="swatch female" aria-hidden="true" />
          <span>{t('person.gender.female')}</span>
          <span className="swatch other" aria-hidden="true" />
          <span>{t('tree.legend.genderOther')}</span>
          <span aria-hidden="true">†</span>
          <span>{t('tree.legend.deceased')}</span>
        </div>
        <div className="legend-row">
          <span className="swatch placeholder" aria-hidden="true" />
          <span>{t('tree.legend.placeholder')}</span>
        </div>
        <div className="legend-row">
          <svg width="14" height="16" viewBox="-10 -22 20 24" aria-hidden="true" className="legend-leaf">
            <path className="blade" d="M0 0C-8-2-9-13 0-19C9-13 8-2 0 0Z" />
          </svg>
          <span>{t('tree.legend.leaf')}</span>
        </div>
        <div className="legend-row">
          <svg width="14" height="16" viewBox="-10 -22 20 24" aria-hidden="true" className="legend-leaf">
            <path className="blade" d="M0 0C-8-2-9-13 0-19C9-13 8-2 0 0Z" />
          </svg>
          <span>{t('tree.legend.other')}</span>
        </div>
      </div>
    </details>
  );
}
