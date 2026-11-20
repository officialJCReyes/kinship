// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../i18n.js';

/** Zoom in, zoom out and "fit the whole chart", bottom right of every chart. */
export function ZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return (
    <div className="zoom" role="group" aria-label={t('tree.zoomControls')} data-nopan>
      <button
        className="button"
        type="button"
        onClick={onZoomIn}
        aria-label={t('tree.zoomIn')}
        title={t('tree.zoomIn')}
      >
        +
      </button>
      <button
        className="button"
        type="button"
        onClick={onZoomOut}
        aria-label={t('tree.zoomOut')}
        title={t('tree.zoomOut')}
      >
        −
      </button>
      <button className="button" type="button" onClick={onFit} aria-label={t('tree.fit')} title={t('tree.fit')}>
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
  );
}
