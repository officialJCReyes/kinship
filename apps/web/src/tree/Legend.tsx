// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react';
import { Link } from 'react-router';
import { t } from '../i18n.js';
import { recallLegendOpen, rememberLegendOpen } from './remember.js';
import type { TreeViewName } from './treeView.js';

function Leaf() {
  return (
    <svg width="14" height="16" viewBox="-10 -22 20 24" aria-hidden="true" className="legend-leaf">
      <path className="blade" d="M0 0C-8-2-9-13 0-19C9-13 8-2 0 0Z" />
    </svg>
  );
}

/**
 * What the lines and colours mean: one row per thing, a few rows for each view (the last one is in every view). Hidden at first
 * behind its small "Legend" button; the person's choice to open or close it is remembered (remember.ts), so moving to another
 * person, view or family view never opens it again.
 */
export function Legend({
  view = 'family',
  deceasedMark = true,
  relativesHidden = false,
}: {
  view?: TreeViewName;
  deceasedMark?: boolean;
  /** The Family tree is not drawing aunts, uncles and cousins (the setting is off, or this is a family view). */
  relativesHidden?: boolean;
}) {
  const cards = view !== 'fan';
  const [open, setOpen] = useState(recallLegendOpen);
  return (
    <details className="legend" open={open}>
      <summary
        onClick={(event) => {
          // Toggled here, on the click (Enter and Space on a summary are clicks too), not on the later "toggle" event: the chart
          // can draw its legend again in between, and the choice must be stored whatever happens next.
          event.preventDefault();
          setOpen(!open);
          rememberLegendOpen(!open);
        }}
      >
        {t('tree.legend.title')}
      </summary>
      <div role="group" aria-label={t('tree.legend.title')} className="legend-rows">
        {view === 'family' ? (
          <>
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
          </>
        ) : null}
        {view === 'fan' ? (
          <div className="legend-row">
            <span className="swatch side-father" aria-hidden="true" />
            <span>{t('tree.legend.fatherSide')}</span>
            <span className="swatch side-mother" aria-hidden="true" />
            <span>{t('tree.legend.motherSide')}</span>
          </div>
        ) : null}
        <div className="legend-row">
          {cards ? (
            <>
              <span className="swatch male" aria-hidden="true" />
              <span>{t('person.gender.male')}</span>
              <span className="swatch female" aria-hidden="true" />
              <span>{t('person.gender.female')}</span>
              <span className="swatch other" aria-hidden="true" />
              <span>{t('tree.legend.genderOther')}</span>
            </>
          ) : null}
          {deceasedMark ? (
            <>
              <span aria-hidden="true">†</span>
              <span>{t('tree.legend.deceased')}</span>
            </>
          ) : null}
        </div>
        {view === 'fan' ? (
          <div className="legend-row">
            <span className="swatch missing" aria-hidden="true" />
            <span>{t('tree.legend.fanMissing')}</span>
          </div>
        ) : (
          <div className="legend-row">
            <span className="swatch placeholder" aria-hidden="true" />
            <span>{t('tree.legend.placeholder')}</span>
          </div>
        )}
        {view === 'family' ? (
          <>
            <div className="legend-row">
              <Leaf />
              <span>{t('tree.legend.leaf')}</span>
            </div>
            <div className="legend-row">
              <Leaf />
              <span>{t('tree.legend.other')}</span>
            </div>
          </>
        ) : (
          <div className="legend-row">
            <span>{t(`tree.legend.${view}`)}</span>
          </div>
        )}
        {view === 'family' && relativesHidden ? (
          <div className="legend-row">
            <span>{t('tree.legend.relativesHidden')}</span>
          </div>
        ) : null}
        <div className="legend-row">
          <span>
            {t('tree.legend.search')
              .split('{finder}')
              .flatMap((part, index) =>
                index === 0
                  ? [part]
                  : [
                      <Link key="finder" to="/relationship">
                        {t('tree.legend.finderLink')}
                      </Link>,
                      part,
                    ],
              )}
          </span>
        </div>
      </div>
    </details>
  );
}
