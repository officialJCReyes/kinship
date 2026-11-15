// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from 'react-router';
import { t } from '../i18n.js';

export function NotFoundPage() {
  return (
    <section className="card">
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <p>
        <Link to="/about">{t('notFound.back')}</Link>
      </p>
    </section>
  );
}
