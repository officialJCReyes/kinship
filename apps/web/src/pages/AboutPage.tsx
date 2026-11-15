// SPDX-License-Identifier: AGPL-3.0-or-later
import { LICENSE_ID, SOURCE_URL } from '@kinship/shared';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth, fetchVersion } from '../api.js';
import { t } from '../i18n.js';

function StatusText({ state }: { state: 'checking' | 'ok' | 'databaseDown' | 'apiDown' }) {
  const key = {
    checking: 'about.status.checking',
    ok: 'about.status.ok',
    databaseDown: 'about.status.databaseDown',
    apiDown: 'about.status.apiDown',
  } as const;
  return (
    <span className={`status status-${state}`} role="status">
      {t(key[state])}
    </span>
  );
}

export function AboutPage() {
  const version = useQuery({ queryKey: ['api', 'version'], queryFn: ({ signal }) => fetchVersion(signal) });
  const health = useQuery({ queryKey: ['api', 'health'], queryFn: ({ signal }) => fetchHealth(signal) });

  const healthState = health.isPending
    ? 'checking'
    : health.isError
      ? 'apiDown'
      : health.data.status === 'ok'
        ? 'ok'
        : 'databaseDown';

  return (
    <section className="card">
      <h1>{t('about.title')}</h1>
      <dl className="facts">
        <dt>{t('about.webVersion')}</dt>
        <dd className="mono">{__WEB_VERSION__}</dd>

        <dt>{t('about.apiVersion')}</dt>
        <dd className="mono">
          {version.isPending ? t('about.loading') : version.isError ? t('about.loadError') : version.data.version}
        </dd>

        <dt>{t('about.build')}</dt>
        <dd className="mono">{version.isSuccess ? version.data.commit : __WEB_COMMIT__}</dd>

        <dt>{t('about.license')}</dt>
        <dd>{LICENSE_ID}</dd>

        <dt>{t('about.sourceCode')}</dt>
        <dd>
          <a href={SOURCE_URL} target="_blank" rel="noopener">
            {SOURCE_URL.replace('https://', '')}
          </a>
        </dd>

        <dt>{t('about.status')}</dt>
        <dd>
          <StatusText state={healthState} />
        </dd>
      </dl>
      <p className="muted">{t('about.freeSoftware')}</p>
    </section>
  );
}
