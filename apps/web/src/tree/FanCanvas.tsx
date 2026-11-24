// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Fan chart: wedges instead of cards. It shares the viewport (pan, zoom, fit) with the Family tree canvas; every wedge
// is a button with the person's whole name in its tooltip and accessible name, however much of it the wedge has room for.
import { useDisplay } from '../lib/display.js';
import { displayName } from '../lib/names.js';
import type { Person } from '@kinship/shared';
import { useCallback, useId, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { t } from '../i18n.js';
import { nodeLabel } from './family.js';
import { ringName } from './fanLayout.js';
import type { FanLayout, FanText, FanWedge } from './fanLayout.js';
import { Legend } from './Legend.js';
import { pointOf } from './doubleActivate.js';
import type { ClickPoint } from './doubleActivate.js';
import { useChartViewport, ZOOM_STEP } from './useChartViewport.js';
import type { WheelMode } from './viewport.js';
import { ZoomControls } from './ZoomControls.js';

const YEARS_SIZE = 10;

function WedgeText({ text }: { text: FanText }) {
  const { name } = text;
  const block = name.lines.length * name.lineHeight + (text.years ? YEARS_SIZE + 3 : 0);
  const first = -block / 2;
  const content = (
    <>
      <text className="name" style={{ fontSize: name.size }} textAnchor="middle" data-lines={name.lines.length}>
        {name.lines.map((line, i) => (
          <tspan key={i} x={0} y={first + i * name.lineHeight + name.size * 0.82}>
            {line}
          </tspan>
        ))}
      </text>
      {text.years ? (
        <text
          className="years"
          style={{ fontSize: YEARS_SIZE }}
          textAnchor="middle"
          x={0}
          y={first + name.lines.length * name.lineHeight + YEARS_SIZE}
        >
          {text.years}
        </text>
      ) : null}
    </>
  );
  return (
    <g
      transform={`translate(${text.x.toFixed(1)} ${text.y.toFixed(1)})${text.rotate ? ` rotate(${text.rotate})` : ''}`}
    >
      {content}
    </g>
  );
}

function sideName(wedge: FanWedge): string {
  return t(wedge.side === 'father' ? 'tree.fan.fatherSide' : 'tree.fan.motherSide');
}

export interface FanCanvasProps {
  layout: FanLayout;
  people: ReadonlyMap<string, Person>;
  selectedId: string;
  /** A click on a person (with where it was, so the page can tell a double-click) or Enter or Space (with none). */
  onSelect: (id: string, point?: ClickPoint) => void;
  /** Shift+Enter on a person: select and open the side panel (backlog 14). */
  onOpen?: (id: string) => void;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /** What a plain mouse wheel does (the account's setting). */
  wheel?: WheelMode;
}

export function FanCanvas({ layout, people, selectedId, onSelect, onOpen, topLeft, topRight, wheel }: FanCanvasProps) {
  const display = useDisplay();
  const helpId = useId();
  const { wrap, svg, viewport, fit, zoomBy, showRect, pointerHandlers } = useChartViewport({
    content: { width: layout.width, height: layout.height },
    start: 'fit',
    wheel: wheel ?? 'zoom',
  });
  const [focusId, setFocusId] = useState(selectedId);
  const focusableId =
    layout.centre && (focusId === layout.centre.id || layout.wedges.some((w) => w.id === focusId))
      ? focusId
      : (layout.centre?.id ?? '');

  /** Where a person is drawn, for scrolling them into view. */
  const centreOf = useCallback(
    (id: string) => {
      if (layout.centre?.id === id) return { x: layout.cx, y: layout.cy };
      const wedge = layout.wedges.find((w) => w.id === id);
      return wedge?.text ? { x: wedge.text.x, y: wedge.text.y } : undefined;
    },
    [layout],
  );
  const focusNode = useCallback(
    (id: string) => {
      const at = centreOf(id);
      if (at) showRect({ x: at.x - 60, y: at.y - 50, width: 120, height: 100 });
      wrap.current?.querySelector<SVGElement>(`[data-node="${CSS.escape(id)}"]`)?.focus();
    },
    [centreOf, showRect, wrap],
  );
  const onKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key === '+' || event.key === '=') return void (event.preventDefault(), zoomBy(ZOOM_STEP));
    if (event.key === '-' || event.key === '_') return void (event.preventDefault(), zoomBy(1 / ZOOM_STEP));
    if (event.key === '0') return void (event.preventDefault(), fit());
    const id = (event.target as Element).closest('[data-node]')?.getAttribute('data-node');
    if (!id) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (event.key === 'Enter' && event.shiftKey && onOpen) onOpen(id);
      else onSelect(id);
    } else if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown'
    ) {
      event.preventDefault();
      const next = layout.navigate(id, event.key);
      if (next) focusNode(next);
    }
  };

  const labelFor = (id: string, wedge?: FanWedge): string => {
    const person = people.get(id);
    if (!person) return '';
    return wedge ? `${nodeLabel(person)}${t('tree.node.separator')}${sideName(wedge)}` : nodeLabel(person);
  };
  const rings = Array.from({ length: layout.rings }, (_, i) => i + 1);
  const selectedPerson = people.get(selectedId);

  return (
    <div className="tree-canvas fan-canvas" ref={wrap}>
      <p id={helpId} className="sr-only">
        {t('tree.fan.help')}
      </p>
      <svg
        ref={svg}
        role="group"
        aria-label={t('tree.fan.chartLabel')}
        aria-describedby={helpId}
        {...pointerHandlers}
        onKeyDown={onKeyDown}
      >
        <g ref={viewport}>
          {rings.map((ring) => (
            <g key={ring} role="group" aria-label={ringName(ring)} className="fan-ring">
              {layout.wedges
                .filter((w) => w.ring === ring)
                .map((wedge) =>
                  wedge.id === null ? (
                    <path key={wedge.key} className={`fan-missing ${wedge.side}`} d={wedge.path} aria-hidden="true" />
                  ) : (
                    <g
                      key={wedge.key}
                      className={`fan-wedge ${wedge.side}${people.get(wedge.id)?.deceased ? ' deceased' : ''}${wedge.id === selectedId ? ' selected' : ''}`}
                      data-node={wedge.id}
                      role="button"
                      tabIndex={wedge.id === focusableId ? 0 : -1}
                      aria-label={labelFor(wedge.id, wedge)}
                      aria-pressed={wedge.id === selectedId}
                      onClick={(event) => onSelect(wedge.id!, pointOf(event))}
                      onFocus={() => setFocusId(wedge.id!)}
                    >
                      <title>{displayNameOf(people.get(wedge.id))}</title>
                      <path d={wedge.path} />
                      {wedge.text ? <WedgeText text={wedge.text} /> : null}
                    </g>
                  ),
                )}
            </g>
          ))}
          {layout.centre ? (
            <g
              className={`fan-wedge fan-centre${layout.centre.id === selectedId ? ' selected' : ''}`}
              data-node={layout.centre.id}
              role="button"
              tabIndex={layout.centre.id === focusableId ? 0 : -1}
              aria-label={labelFor(layout.centre.id)}
              aria-pressed={layout.centre.id === selectedId}
              onClick={(event) => onSelect(layout.centre!.id, pointOf(event))}
              onFocus={() => setFocusId(layout.centre!.id)}
            >
              <title>{displayNameOf(people.get(layout.centre.id))}</title>
              <circle cx={layout.cx} cy={layout.cy} r={57} />
              <WedgeText
                text={{
                  mode: 'horizontal',
                  x: layout.cx,
                  y: layout.cy,
                  rotate: 0,
                  name: layout.centre.name,
                  shortened: false,
                  years: layout.centre.years,
                }}
              />
            </g>
          ) : null}
        </g>
      </svg>
      <div className="tree-overlay top-left">{topLeft}</div>
      <div className="tree-overlay top-right">{topRight}</div>
      <Legend view="fan" deceasedMark={display.showDeceasedMark} />
      <ZoomControls onZoomIn={() => zoomBy(ZOOM_STEP)} onZoomOut={() => zoomBy(1 / ZOOM_STEP)} onFit={fit} />
      <div className="sr-only" role="status" aria-live="polite">
        {selectedPerson ? t('tree.selected', { name: displayName(selectedPerson) }) : ''}
      </div>
    </div>
  );
}

const displayNameOf = (person: Person | undefined): string => (person ? displayName(person) : '');
