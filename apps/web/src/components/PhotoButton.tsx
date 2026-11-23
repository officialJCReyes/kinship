// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ButtonHTMLAttributes, Ref } from 'react';

/** An outlined camera, drawn like the calendar button's icon (line, round caps, the button's own text colour). */
export function CameraIcon({ size = 18 }: { size?: number }) {
  return (
    <svg className="line-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </svg>
  );
}

/**
 * The camera button in the corner of a person's large avatar: the one way to set a profile photo. It looks like the app's other
 * icon buttons (the calendar button beside a date field): the same border, radius and colour tokens, an outlined icon. `label` is
 * its accessible name (and its tooltip); every other button attribute (onClick, aria-haspopup, aria-expanded...) passes through.
 */
export function PhotoButton({
  label,
  className,
  ref,
  ...button
}: { label: string; ref?: Ref<HTMLButtonElement> } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
>) {
  return (
    <button
      ref={ref}
      type="button"
      className={`button icon-button photo-button${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      {...button}
    >
      <CameraIcon />
    </button>
  );
}

/** Three outlined dots: "more actions", in the same line style. */
export function MoreIcon({ size = 18 }: { size?: number }) {
  return (
    <svg className="line-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="2.2" />
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="19" cy="12" r="2.2" />
    </svg>
  );
}

/** The "Photo actions" button on a thumbnail: the same icon button as the camera, with the "more" icon. */
export function PhotoActionsButton({
  label,
  className,
  ref,
  ...button
}: { label: string; ref?: Ref<HTMLButtonElement> } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
>) {
  return (
    <button
      ref={ref}
      type="button"
      className={`button icon-button photo-actions-button${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      {...button}
    >
      <MoreIcon />
    </button>
  );
}
