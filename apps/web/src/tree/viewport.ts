// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pan and zoom arithmetic for the chart, kept apart from the component so it can be tested. A view is a
// scale `k` and an offset: a chart point (cx, cy) is on screen at (x + cx * k, y + cy * k).

export interface View {
  k: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 2.5;

export const clampScale = (k: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));

/** Zoom by `factor` keeping the chart point under the screen point (px, py) where it is. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const k = clampScale(view.k * factor);
  const real = k / view.k;
  return { k, x: px - (px - view.x) * real, y: py - (py - view.y) * real };
}

/** The view that shows the whole chart, centred, with a little room around it. */
export function fitView(content: { width: number; height: number }, box: { width: number; height: number }): View {
  const pad = 16;
  const k = clampScale(
    Math.min(
      (box.width - pad * 2) / Math.max(content.width, 1),
      (box.height - pad * 2) / Math.max(content.height, 1),
      1,
    ),
  );
  return { k, x: (box.width - content.width * k) / 2, y: (box.height - content.height * k) / 2 };
}

/** The view that puts a chart point in the middle of the box at scale k. */
export function centerOn(point: { x: number; y: number }, k: number, box: { width: number; height: number }): View {
  const scale = clampScale(k);
  return { k: scale, x: box.width / 2 - point.x * scale, y: box.height / 2 - point.y * scale };
}

/** The Family tree opens on the whole chart only when it is drawn at least this large (below it the card text is small). */
export const OPEN_FIT_MIN_SCALE = 0.7;

/**
 * Where the Family tree starts: the whole chart when it fits at a zoom of 0.7 or more, otherwise a readable zoom (0.7) centred
 * on the person it is about, so a wide chart opens on the home person and the viewer pans from there (ADR 0027, which raised the
 * limit from 0.45). The Pedigree, Fan and Descendants views fit themselves instead (ADR 0026).
 */
export function initialView(
  content: { width: number; height: number },
  box: { width: number; height: number },
  focus: { x: number; y: number } | undefined,
): View {
  const fit = fitView(content, box);
  if (fit.k >= OPEN_FIT_MIN_SCALE || !focus) return fit;
  return centerOn(focus, OPEN_FIT_MIN_SCALE, box);
}

/** The smallest pan that brings a chart rectangle fully into the box (with a margin); the view if it already is. */
export function reveal(
  view: View,
  rect: { x: number; y: number; width: number; height: number },
  box: { width: number; height: number },
  margin = 24,
): View {
  const left = view.x + rect.x * view.k;
  const top = view.y + rect.y * view.k;
  const right = left + rect.width * view.k;
  const bottom = top + rect.height * view.k;
  let { x, y } = view;
  if (left < margin) x += margin - left;
  else if (right > box.width - margin) x -= right - (box.width - margin);
  if (top < margin) y += margin - top;
  else if (bottom > box.height - margin) y -= bottom - (box.height - margin);
  return { k: view.k, x, y };
}

export const transformOf = (view: View): string => `translate(${view.x} ${view.y}) scale(${view.k})`;

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
