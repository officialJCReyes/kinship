// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link, NavLink, Navigate, Route, Routes } from 'react-router';
import { t } from './i18n.js';
import { AboutPage } from './pages/AboutPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <header className="site-header">
        <div className="page-width site-header-inner">
          <Link to="/" className="wordmark">
            {t('app.name')}
          </Link>
          <nav aria-label={t('nav.main')}>
            <NavLink to="/about">{t('nav.about')}</NavLink>
          </nav>
        </div>
      </header>
      <main id="main" className="page-width">
        <Routes>
          <Route path="/" element={<Navigate to="/about" replace />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </>
  );
}
