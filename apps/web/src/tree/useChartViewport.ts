// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pan, zoom, fit and "draw only what is near the window" for a chart, shared by the Family tree canvas and the
// Fan canvas. Panning and zooming move one <g> without a React render; the region that is drawn is looked at again
// when the pointer stops (ADR 0006).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { prefersReducedMotion } from './motion.js';
import { distance, fitView, initialView, reveal, transformOf, wheelView, zoomAt } from './viewport.js';
import type { View, WheelMode } from './viewport.js';

const DRAG_THRESHOLD = 4;
export const ZOOM_STEP = 1.25;
/** Below this zoom a box is drawn without its text and glyph: nothing inside it could be read. */
export const SIMPLE_BELOW = 0.3;

export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  simple: boolean;
}

/** What to draw for a view: the window with a margin around it (kept while the window stays inside it). */
export function regionFor(v: View, b: { width: number; height: number }, prev: Region | null): Region {
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

export interface ChartViewportOptions {
  /** The size of everything that is drawn. */
  content: { width: number; height: number };
  /** The person the chart is about, in chart coordinates (the Family tree zooms on them when it is too big to fit). */
  focus?: { x: number; y: number } | undefined;
  /**
   * 'family': the whole chart when it is readable, otherwise a readable zoom on `focus` (ADR 0006).
   * 'fit': always the whole chart (the Pedigree, Fan and Descendants views fit themselves, ADR 0026).
   */
  start: 'family' | 'fit';
  /** What a plain mouse wheel does: zoom (the default) or move the chart. Ctrl and a pinch always zoom. */
  wheel?: WheelMode;
}

export function useChartViewport({ content, focus, start, wheel = 'zoom' }: ChartViewportOptions) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const viewport = useRef<SVGGElement>(null);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const frame = useRef<number>(0);
  const cullTimer = useRef(0);
  const firstView = (box: { width: number; height: number }): View =>
    start === 'fit' ? fitView(content, box) : initialView(content, box, focus);
  // What is drawn: the window plus a margin, and whether the boxes are drawn in full. Panning moves one <g> without
  // touching this; it is looked at again when the pointer stops (so only what is near the window is in the page).
  const [region, setRegion] = useState<Region>(() => {
    // Before the first paint, guess the window from the page size so the first render is already trimmed.
    const guess = { width: Math.max(window.innerWidth - 300, 400), height: Math.max(window.innerHeight - 60, 300) };
    return regionFor(firstView(guess), guess, null);
  });

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
  /** Draw what is in the window now, without waiting for the pointer to stop. */
  const drawNow = useCallback(() => {
    window.clearTimeout(cullTimer.current);
    cullNow();
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
    () => animateTo(fitView({ width: content.width, height: content.height }, box())),
    [animateTo, content.width, content.height, box],
  );
  const zoomBy = useCallback(
    (factor: number) => {
      const b = box();
      animateTo(zoomAt(view.current, factor, b.width / 2, b.height / 2));
    },
    [animateTo, box],
  );
  /** The smallest pan that brings a chart rectangle into the window (the zoom is not changed). */
  const showRect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => apply(reveal(view.current, rect, box())),
    [apply, box],
  );

  // The first view for this chart (the canvas is remounted for a different chart, so this runs once per chart).
  useLayoutEffect(() => {
    apply(firstView(box()));
    cullNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The wheel: zoom around the pointer, or (in scroll mode) move the chart; Ctrl and a trackpad pinch always zoom. A native
  // listener, because React's wheel is passive. The mode is read from a ref, so a change of setting does not add it again.
  const wheelMode = useRef<WheelMode>(wheel);
  useEffect(() => {
    wheelMode.current = wheel;
  }, [wheel]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelAnimationFrame(frame.current);
      const rect = el.getBoundingClientRect();
      apply(
        wheelView(
          view.current,
          event,
          wheelMode.current,
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          box(),
        ),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [apply, box]);

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
  const onClickCapture = (event: ReactMouseEvent) => {
    if (suppressClick.current) {
      event.stopPropagation();
      event.preventDefault();
    }
  };

  const inView = useCallback(
    (x0: number, y0: number, x1: number, y1: number) =>
      x1 >= region.x0 && x0 <= region.x1 && y1 >= region.y0 && y0 <= region.y1,
    [region],
  );

  return {
    wrap,
    svg,
    viewport,
    region,
    simple: region.simple,
    inView,
    apply,
    fit,
    zoomBy,
    showRect,
    drawNow,
    /** Handlers for the chart's <svg>. */
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onClickCapture,
    },
  };
}
