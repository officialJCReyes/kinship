// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A double-click (or double-tap) on a person in a chart opens the side panel, even when it is collapsed (backlog 14). The
// chart's own click events are used for mouse and touch alike (a browser's dblclick is unreliable on touch, and in the
// Pedigree, Fan and Descendants views the first click re-roots the chart, so the second one lands on a new drawing).
// So the rule is about the pointer, not the card: a second click within DOUBLE_MS of the first and within DOUBLE_SLOP px
// of where the first one was. It then opens the panel for the person of the FIRST click, whatever is under the pointer now.

/** How soon the second click must follow the first, in ms. */
export const DOUBLE_MS = 400;
/** How far from the first click the second may land, in px. */
export const DOUBLE_SLOP = 10;

export interface ChartClick {
  id: string;
  /** performance.now() of the click. */
  at: number;
  x: number;
  y: number;
}

/** Where a click happened on the screen. A keyboard activation has none and never makes a double. */
export interface ClickPoint {
  x: number;
  y: number;
}

/**
 * The point of a click from a real pointer, or none. A click that a screen reader or other assistive technology sends, or
 * one made by a script, has `detail` 0 (and often no position): it is a single activation, never half of a double.
 */
export function pointOf(event: { detail: number; clientX: number; clientY: number }): ClickPoint | undefined {
  return event.detail >= 1 ? { x: event.clientX, y: event.clientY } : undefined;
}

/** Is this click the second of a double? Then it opens the panel for `first.id`. */
export function isSecondClick(
  first: ChartClick | null,
  at: number,
  point: ClickPoint | undefined,
): first is ChartClick {
  if (!first || !point) return false;
  return at - first.at <= DOUBLE_MS && Math.hypot(point.x - first.x, point.y - first.y) <= DOUBLE_SLOP;
}
