// SPDX-License-Identifier: AGPL-3.0-or-later
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from './i18n.js';

export interface Notice {
  id: number;
  kind: 'success' | 'warning';
  text: string;
  /** A success notice is fading out (the last moment before it is removed). */
  fading?: boolean;
}

interface NoticeApi {
  notices: Notice[];
  /**
   * Show a message. A success is a small pill that goes away by itself after `SUCCESS_MS`; a warning is a bar at the top
   * of the page that stays until it is dismissed. Neither ever takes focus or blocks anything.
   */
  notify: (kind: Notice['kind'], text: string) => void;
  dismiss: (id: number) => void;
  /** Stop a success notice's timer while the pointer or keyboard focus is on it, and start it again afterwards. */
  hold: (id: number) => void;
  release: (id: number) => void;
}

export const SUCCESS_MS = 5000;
/** How long before it goes that the pill starts to fade. */
export const FADE_MS = 400;

const NoticeContext = createContext<NoticeApi | null>(null);
let counter = 0;

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>[]>());

  const clear = useCallback((id: number) => {
    for (const handle of timers.current.get(id) ?? []) clearTimeout(handle);
    timers.current.delete(id);
  }, []);
  const dismiss = useCallback(
    (id: number) => {
      clear(id);
      setNotices((current) => current.filter((n) => n.id !== id));
    },
    [clear],
  );
  const start = useCallback(
    (id: number) => {
      clear(id);
      const fade = setTimeout(
        () => setNotices((current) => current.map((n) => (n.id === id ? { ...n, fading: true } : n))),
        SUCCESS_MS - FADE_MS,
      );
      const gone = setTimeout(() => dismiss(id), SUCCESS_MS);
      timers.current.set(id, [fade, gone]);
    },
    [clear, dismiss],
  );
  const notify = useCallback(
    (kind: Notice['kind'], text: string) => {
      counter += 1;
      const id = counter;
      setNotices((current) => {
        for (const old of current) if (old.text === text) clear(old.id);
        return [...current.filter((notice) => notice.text !== text), { id, kind, text }];
      });
      if (kind === 'success') start(id);
    },
    [clear, start],
  );
  const hold = useCallback(
    (id: number) => {
      clear(id);
      setNotices((current) => current.map((n) => (n.id === id ? { ...n, fading: false } : n)));
    },
    [clear],
  );
  const release = useCallback(
    (id: number) => {
      start(id);
    },
    [start],
  );

  // Timers never outlive the provider.
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const handles of all.values()) for (const handle of handles) clearTimeout(handle);
      all.clear();
    };
  }, []);

  const value = useMemo(() => ({ notices, notify, dismiss, hold, release }), [notices, notify, dismiss, hold, release]);
  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>;
}

export function useNotices(): NoticeApi {
  const value = useContext(NoticeContext);
  if (!value) throw new Error('useNotices needs a NoticeProvider');
  return value;
}

/**
 * The messages. The live region stays mounted even when it is empty, so what appears in it is announced politely.
 * Successes are small pills fixed at the top centre; warnings are bars at the top of the main area with a Dismiss
 * button. Nothing here moves focus.
 */
export function NoticeList() {
  const { notices, dismiss, hold, release } = useNotices();
  const bars = notices.filter((notice) => notice.kind !== 'success');
  const pills = notices.filter((notice) => notice.kind === 'success');
  return (
    <div className="notice-region" role="status" aria-live="polite">
      {bars.length > 0 ? (
        <div className="notice-list">
          {bars.map((notice) => (
            <div key={notice.id} className={`notice ${notice.kind}`}>
              <span>{notice.text}</span>
              <button className="button small" type="button" onClick={() => dismiss(notice.id)}>
                {t('common.dismiss')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="notice-pills">
        {pills.map((notice) => (
          <div
            key={notice.id}
            className={`notice-pill${notice.fading ? ' fading' : ''}`}
            data-testid="notice-pill"
            onMouseEnter={() => hold(notice.id)}
            onMouseLeave={() => release(notice.id)}
            onFocus={() => hold(notice.id)}
            onBlur={() => release(notice.id)}
          >
            {notice.text}
          </div>
        ))}
      </div>
    </div>
  );
}
