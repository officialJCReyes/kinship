// SPDX-License-Identifier: AGPL-3.0-or-later
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from './i18n.js';

export interface Notice {
  id: number;
  kind: 'success' | 'warning';
  text: string;
}

interface NoticeApi {
  notices: Notice[];
  /** Show a message at the top of the page until it is dismissed. Warnings never block anything. */
  notify: (kind: Notice['kind'], text: string) => void;
  dismiss: (id: number) => void;
}

const NoticeContext = createContext<NoticeApi | null>(null);
let counter = 0;

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const notify = useCallback((kind: Notice['kind'], text: string) => {
    counter += 1;
    const id = counter;
    setNotices((current) => [...current.filter((notice) => notice.text !== text), { id, kind, text }]);
  }, []);
  const dismiss = useCallback((id: number) => setNotices((current) => current.filter((n) => n.id !== id)), []);
  const value = useMemo(() => ({ notices, notify, dismiss }), [notices, notify, dismiss]);
  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>;
}

export function useNotices(): NoticeApi {
  const value = useContext(NoticeContext);
  if (!value) throw new Error('useNotices needs a NoticeProvider');
  return value;
}

/** The messages, at the top of the main area. Warnings are announced politely and never take focus. */
export function NoticeList() {
  const { notices, dismiss } = useNotices();
  if (notices.length === 0) return null;
  return (
    <div className="notice-list" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.id} className={`notice ${notice.kind}`}>
          <span>{notice.text}</span>
          <button className="button small" type="button" onClick={() => dismiss(notice.id)}>
            {t('common.dismiss')}
          </button>
        </div>
      ))}
    </div>
  );
}
