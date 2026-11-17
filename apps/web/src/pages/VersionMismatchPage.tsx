// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../i18n.js';
import type { Mismatch } from '../lib/version-mismatch.js';

/** Replaces the whole app while the web container and the api are on different versions. Nothing else works until they match. */
export function VersionMismatchPage({ mismatch }: { mismatch: Mismatch }) {
  const unknown = t('updates.mismatch.unknownVersion');
  return (
    <main className="page-width">
      <section className="card stack" role="alert">
        <h1>{t('updates.mismatch.title')}</h1>
        <p>{t('updates.mismatch.body', { web: mismatch.web || unknown, api: mismatch.api || unknown })}</p>
        <p>{t('updates.mismatch.fix')}</p>
        <div className="row">
          <button type="button" className="button primary" onClick={() => window.location.reload()}>
            {t('common.retry')}
          </button>
        </div>
      </section>
    </main>
  );
}
