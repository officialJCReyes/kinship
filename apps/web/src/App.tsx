// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { useLogout, useSession, useSetupStatus } from './auth.js';
import { t } from './i18n.js';
import { AboutPage } from './pages/AboutPage.js';
import { HomePage } from './pages/HomePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { NoticeList, NoticeProvider } from './notices.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { PeoplePage } from './pages/PeoplePage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { SetupPage } from './pages/SetupPage.js';

function Loading() {
  return (
    <p className="muted" role="status">
      {t('common.loading')}
    </p>
  );
}

/** Everything that needs a signed-in person. Until setup is done, everything goes to /setup. */
function RequireSignIn() {
  const setup = useSetupStatus();
  const session = useSession(setup.data?.needsSetup === false);
  const location = useLocation();
  if (setup.isPending) return <Loading />;
  if (setup.isError) return <p role="alert">{t('common.cannotReachApi')}</p>;
  if (setup.data.needsSetup) return <Navigate to="/setup" replace />;
  if (session.isPending) return <Loading />;
  if (!session.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** /login: for people who are not signed in. Until setup is done, it goes to /setup. */
function LoginRoute() {
  const setup = useSetupStatus();
  const session = useSession(setup.data?.needsSetup === false);
  if (setup.isPending) return <Loading />;
  if (setup.isError) return <p role="alert">{t('common.cannotReachApi')}</p>;
  if (setup.data.needsSetup) return <Navigate to="/setup" replace />;
  if (session.isPending) return <Loading />;
  if (session.data) return <Navigate to="/" replace />;
  return <LoginPage />;
}

/** /setup: only while the install has no accounts. Afterwards it goes to /login. */
function SetupRoute() {
  const setup = useSetupStatus();
  const session = useSession(setup.data?.needsSetup === false);
  if (setup.isPending) return <Loading />;
  if (setup.isError) return <p role="alert">{t('common.cannotReachApi')}</p>;
  if (setup.data.needsSetup) return <SetupPage />;
  // Just finished setup (signed in) or setup was already done earlier.
  if (session.isPending) return <Loading />;
  return <Navigate to={session.data ? '/' : '/login'} replace />;
}

function AccountBar(): ReactNode {
  const session = useSession(false);
  const logout = useLogout();
  const me = session.data;
  if (!me) return null;
  return (
    <div className="account-bar">
      <span className="muted" title={me.user.email}>
        {t('account.signedInAs', { name: me.user.displayName })}
      </span>
      <button className="button" type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
        {logout.isPending ? t('account.signingOut') : t('account.signOut')}
      </button>
    </div>
  );
}

export function App() {
  const session = useSession(false);
  const signedIn = Boolean(session.data);
  const personId = session.data?.user.personId ?? null;
  return (
    <NoticeProvider>
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <header className="site-header">
        <div className="page-width site-header-inner">
          <Link to="/" className="wordmark">
            {t('app.name')}
          </Link>
          {signedIn ? (
            <nav aria-label={t('nav.main')}>
              <NavLink to="/" end>
                {t('nav.home')}
              </NavLink>
              <NavLink to="/people" end>
                {t('nav.people')}
              </NavLink>
              {personId ? <NavLink to={`/people/${personId}`}>{t('nav.myProfile')}</NavLink> : null}
              <NavLink to="/about">{t('nav.about')}</NavLink>
            </nav>
          ) : null}
          <AccountBar />
        </div>
      </header>
      <main id="main" className="page-width">
        <NoticeList />
        <Routes>
          <Route path="/setup" element={<SetupRoute />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<RequireSignIn />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/people/:id" element={<ProfilePage />} />
            <Route path="/about" element={<AboutPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </NoticeProvider>
  );
}
