// SPDX-License-Identifier: AGPL-3.0-or-later
import { WORDMARK_KIN, WORDMARK_SHIP } from '../brand/logo-paths.js';

/**
 * The KinShip logo (sailboat mark and wordmark), drawn inline so it costs no request and follows light or dark through
 * the --logo-* tokens in styles.css (never the color scheme). It is decorative: the visible text next to it, or the
 * accessible name of the link around it, names the product. The logo itself is not AGPL-licensed (TRADEMARK.md).
 */
export function Logo({ height }: { height: number }) {
  return (
    <svg
      className="logo"
      viewBox="0 0 483.4 180"
      height={height}
      width={(height * 483.4) / 180}
      aria-hidden="true"
      focusable="false"
    >
      <g transform="scale(0.9)">
        <path d="M100 28 V128" stroke="var(--logo-ink)" strokeWidth="7" strokeLinecap="round" fill="none" />
        <path d="M106 30 C150 52 166 92 150 122 Q140 126 106 124 Z" fill="var(--logo-sail)" />
        <path
          d="M106 108 L138 92 M106 86 L132 70 M106 64 L122 54"
          stroke="var(--logo-detail)"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M94 56 C70 80 62 104 66 122 L94 122 Z" fill="var(--amber)" />
        <path d="M30 134 H170 Q164 166 124 170 H76 Q36 166 30 134 Z" fill="var(--logo-ink)" />
        <circle cx="74" cy="150" r="5" fill="var(--logo-detail)" />
        <circle cx="126" cy="150" r="5" fill="var(--logo-detail)" />
        <circle cx="100" cy="141" r="3.5" stroke="var(--logo-detail)" strokeWidth="3" fill="none" />
        <path
          d="M100 145 V161 M94 149 H106 M90 154 Q92 162 100 162 Q108 162 110 154"
          stroke="var(--logo-detail)"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M34 186 q16.5 -9 33 0 t33 0 t33 0 t33 0"
          stroke="var(--logo-sail)"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
        />
      </g>
      <path fill="var(--logo-word)" d={WORDMARK_KIN} />
      <path fill="var(--logo-sail)" d={WORDMARK_SHIP} />
    </svg>
  );
}
