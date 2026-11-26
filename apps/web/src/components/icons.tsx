// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Small line icons for icon-only buttons (from the approved mockup). Decorative: the button carries the name.

const lines = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** A person card: Open profile. */
export function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" {...lines} aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2.2" />
      <path d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h4M14.5 13.5h3" />
    </svg>
  );
}

/** A pencil: Edit details. */
export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" {...lines} aria-hidden="true" focusable="false">
      <path d="M4 20l1-4L16.5 4.5a2 2 0 013 3L8 19l-4 1z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}

/** A person with a plus: Add relative. */
export function AddPersonIcon() {
  return (
    <svg viewBox="0 0 24 24" {...lines} aria-hidden="true" focusable="false">
      <circle cx="9.5" cy="8.5" r="3.5" />
      <path d="M3 20c.8-3.6 3.2-5.5 6.5-5.5S15.2 16.4 16 20M18 6v6M15 9h6" />
    </svg>
  );
}

/** A magnifier: Research (an outbound search). */
export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" {...lines} strokeWidth={1.8} aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5.5 5.5" />
    </svg>
  );
}
