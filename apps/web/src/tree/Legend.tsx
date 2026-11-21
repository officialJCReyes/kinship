// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../i18n.js';
import type { TreeViewName } from './treeView.js';

function Leaf() {
  return (
    <svg width="14" height="16" viewBox="-10 -22 20 24" aria-hidden="true" className="legend-leaf">
      <path className="blade" d="M0 0C-8-2-9-13 0-19C9-13 8-2 0 0Z" />
    </svg>
  );
}

/** What the lines and colours mean: one row per thing, a few rows for each view (the last one is in every view). */
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
  return (
    <details className="legend" open>
      <summary>{t('tree.legend.title')}</summary>
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
          <span>{t('tree.legend.search')}</span>
        </div>
      </div>
    </details>
  );
}
