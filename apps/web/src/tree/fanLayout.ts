// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Fan: the blood ancestors of one person as a half circle, one ring for each generation. The left half is the
// father's side and the right half the mother's. Rings 1 and 2 have room for horizontal text; from ring 3 on the text
// runs along the radius. A pure function of the tree response, the number of generations and the text measurer, so the
// same data always gives the same chart (ADR 0026).
import type { Person, TreeResponse } from '@kinship/shared';
import { t } from '../i18n.js';
import { displayName, displaySurname } from '../lib/names.js';
import { lifespan } from '../lib/people.js';
import { fitName, measureText } from './cardText.js';
import type { Measure, NameFit } from './cardText.js';
import { parentsIn } from './family.js';
import type { NavigationKey } from './layout.js';
import { parentSlots } from './pedigreeLayout.js';

/** The circle for the person in the middle. */
export const FAN_CENTRE_RADIUS = 60;
/** The thickness of a ring (a little over the mockup's 88: it lets the outer rings keep whole names). */
export const FAN_RING = 96;
export const FAN_MARGIN = 24;
/** Rings up to this one have horizontal text; beyond it the text runs along the radius. */
export const FAN_HORIZONTAL_RINGS = 2;
/** The size radial names start at, and the smallest they may be before they are shortened. */
export const FAN_RADIAL_SIZE = 11;
export const FAN_RADIAL_FLOOR = 9;
const COLUMN_TITLES = [
  'tree.pedigree.column.0',
  'tree.pedigree.column.1',
  'tree.pedigree.column.2',
  'tree.pedigree.column.3',
  'tree.pedigree.column.4',
] as const;

export interface FanText {
  mode: 'horizontal' | 'radial';
  /** The middle of the text block. */
  x: number;
  y: number;
  /** Degrees: 0 for horizontal text, along the radius (never upside down) for the others. */
  rotate: number;
  name: NameFit;
  /** True when the name had to be shortened to fit (the full name is in the tooltip and the accessible name). */
  shortened: boolean;
  years: string;
}

export interface FanWedge {
  key: string;
  ring: number;
  index: number;
  /** Null for a place where an ancestor is missing: drawn as a dashed outline. */
  id: string | null;
  side: 'father' | 'mother';
  path: string;
  text: FanText | null;
}

export interface FanLayout {
  width: number;
  height: number;
  cx: number;
  cy: number;
  rings: number;
  wedges: FanWedge[];
  centre: { id: string; name: NameFit; years: string } | null;
  /** The people drawn, in the order the keyboard moves through them. */
  navigate: (id: string, key: NavigationKey) => string | undefined;
}

export interface FanResult {
  layout: FanLayout;
  ids: Set<string>;
}

const nameOf = (person: Person) => displayName(person) + (person.deceased ? ' †' : '');

/** "Nova Estelle Hallworth-Fernandez de la Mora" becomes "Nova H.": the first given name and the first letter of the surname. */
export function shortName(person: Person): string {
  const given = person.givenName.trim().split(/\s+/)[0] ?? '';
  const surname = displaySurname(person).trim();
  const initial = Array.from(surname.replace(/^(de la|del|de|van|von|der|la|le)\s+/i, ''))[0];
  return `${given}${initial ? ` ${initial.toUpperCase()}.` : ''}${person.deceased ? ' †' : ''}`;
}

/**
 * A name along a ring: whole on up to three lines, stepping the type down to FAN_RADIAL_FLOOR. Only if it still does not
 * fit there is it shortened (to "Nova H.", then cut with an ellipsis): this is the one place a name is ever cut
 * (ADR 0026).
 */
export function fitRadialName(
  person: Person,
  width: number,
  measure: Measure = measureText,
): { fit: NameFit; shortened: boolean } {
  const fits = (fit: NameFit) => fit.size >= FAN_RADIAL_FLOOR;
  const whole = fitName(nameOf(person), width, measure, 3, FAN_RADIAL_SIZE);
  if (fits(whole)) return { fit: whole, shortened: false };
  const short = fitName(shortName(person), width, measure, 3, FAN_RADIAL_FLOOR);
  if (fits(short)) return { fit: short, shortened: true };
  let text = Array.from(shortName(person));
  while (text.length > 1) {
    text = text.slice(0, -1);
    const cut = fitName(`${text.join('').trimEnd()}…`, width, measure, 3, FAN_RADIAL_FLOOR);
    if (fits(cut)) return { fit: cut, shortened: true };
  }
  return { fit: fitName('…', width, measure, 3, FAN_RADIAL_FLOOR), shortened: true };
}

export function layoutFan(tree: TreeResponse, rootId: string, gen: number, measure: Measure = measureText): FanResult {
  const people = new Map(tree.people.map((p) => [p.id, p as Person]));
  const parentsOf = (id: string): Person[] =>
    parentsIn(tree, tree.parentage[id])
      .map((p) => people.get(p))
      .filter((p): p is Person => p !== undefined);

  const rings = gen - 1; // the person is the middle, not a ring
  const cx = FAN_CENTRE_RADIUS + rings * FAN_RING + FAN_MARGIN;
  const cy = cx;
  const point = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy - r * Math.sin(a)).toFixed(1)}`;
  const inner = (ring: number) => FAN_CENTRE_RADIUS + (ring - 1) * FAN_RING;
  const wedgePath = (ring: number, index: number): string => {
    const n = 2 ** ring;
    const r1 = inner(ring);
    const r2 = r1 + FAN_RING;
    const a1 = Math.PI * (1 - index / n);
    const a2 = Math.PI * (1 - (index + 1) / n);
    return `M${point(r1, a1)}L${point(r2, a1)}A${r2} ${r2} 0 0 1 ${point(r2, a2)}L${point(r1, a2)}A${r1} ${r1} 0 0 0 ${point(r1, a1)}Z`;
  };

  const wedges: FanWedge[] = [];
  const seat = new Map<string, { ring: number; index: number }>();
  const byPlace = new Map<string, string>(); // "ring:index" -> id
  const ids = new Set<string>();

  const textFor = (person: Person, ring: number, index: number): FanText => {
    const n = 2 ** ring;
    const angle = Math.PI * (1 - (index + 0.5) / n);
    const radius = inner(ring) + FAN_RING / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy - radius * Math.sin(angle);
    const years = lifespan(person);
    if (ring <= FAN_HORIZONTAL_RINGS) {
      return {
        mode: 'horizontal',
        x,
        y,
        rotate: 0,
        name: fitName(nameOf(person), FAN_RING - 12, measure, 3, 12),
        shortened: false,
        years,
      };
    }
    // Along the radius, read from the middle outwards on the right half and from the outside inwards on the left half,
    // so no name is ever upside down.
    const degrees = (-angle * 180) / Math.PI + (angle > Math.PI / 2 ? 180 : 0);
    const { fit, shortened } = fitRadialName(person, FAN_RING - 14, measure);
    return { mode: 'radial', x, y, rotate: Math.round(degrees * 10) / 10, name: fit, shortened, years };
  };

  const place = (person: Person, ring: number, index: number) => {
    ids.add(person.id);
    seat.set(person.id, { ring, index });
    byPlace.set(`${ring}:${index}`, person.id);
    wedges.push({
      key: `${ring}:${index}`,
      ring,
      index,
      id: person.id,
      side: index < 2 ** (ring - 1) ? 'father' : 'mother',
      path: wedgePath(ring, index),
      text: textFor(person, ring, index),
    });
    if (ring + 1 > rings) return;
    parentSlots(parentsOf(person.id)).forEach((parent, j) => reach(parent, ring + 1, 2 * index + j));
  };
  /** A parent's wedge, or a dashed one where there is no parent drawn. */
  const reach = (parent: Person | null, ring: number, index: number) => {
    if (parent) {
      if (ids.has(parent.id)) return; // the same person twice (a cousin marriage): drawn once, at the first place
      place(parent, ring, index);
    } else {
      wedges.push({
        key: `${ring}:${index}`,
        ring,
        index,
        id: null,
        side: index < 2 ** (ring - 1) ? 'father' : 'mother',
        path: wedgePath(ring, index),
        text: null,
      });
    }
  };

  const root = people.get(rootId);
  let centre: FanLayout['centre'] = null;
  if (root) {
    ids.add(root.id);
    seat.set(root.id, { ring: 0, index: 0 });
    centre = {
      id: root.id,
      name: fitName(nameOf(root), 2 * (FAN_CENTRE_RADIUS - 3) - 22, measure, 3, 13),
      years: lifespan(root),
    };
    if (rings >= 1) parentSlots(parentsOf(root.id)).forEach((parent, j) => reach(parent, 1, j));
  }
  wedges.sort((a, b) => a.ring - b.ring || a.index - b.index);

  const navigate = (id: string, key: NavigationKey): string | undefined => {
    const at = seat.get(id);
    if (!at) return undefined;
    const idAt = (ring: number, index: number) => byPlace.get(`${ring}:${index}`);
    if (at.ring === 0) {
      return key === 'ArrowUp' ? (idAt(1, 0) ?? idAt(1, 1)) : undefined;
    }
    if (key === 'ArrowUp') return idAt(at.ring + 1, 2 * at.index) ?? idAt(at.ring + 1, 2 * at.index + 1);
    if (key === 'ArrowDown') return at.ring === 1 ? root?.id : idAt(at.ring - 1, Math.floor(at.index / 2));
    // Along the ring, past any empty place.
    const step = key === 'ArrowRight' ? 1 : -1;
    for (let i = at.index + step; i >= 0 && i < 2 ** at.ring; i += step) {
      const found = idAt(at.ring, i);
      if (found) return found;
    }
    return undefined;
  };

  return {
    layout: {
      width: 2 * cx,
      height: cy + FAN_CENTRE_RADIUS + FAN_MARGIN,
      cx,
      cy,
      rings,
      wedges,
      centre,
      navigate,
    },
    ids,
  };
}

/** What a ring is called to a screen reader: "Parents", "Grandparents"... */
export function ringName(ring: number): string {
  return t(COLUMN_TITLES[ring] ?? COLUMN_TITLES[4]);
}
