// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { useLogout, useSession, useSetupStatus } from './auth.js';
import { t } from './i18n.js';
import { DEFAULT_DISPLAY, setDisplay, useDisplay } from './lib/display.js';
import { applyTheme } from './lib/theme.js';
import { AboutPage } from './pages/AboutPage.js';
import { HomePage } from './pages/HomePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { NoticeList, NoticeProvider } from './notices.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { PeoplePage } from './pages/PeoplePage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { SetupPage } from './pages/SetupPage.js';
import { TreeIndexPage, TreePage } from './tree/TreePage.js';

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
  // The account's date format and surname choice feed the display store (signed out: the defaults). The page content
  // is keyed by them, so changing one remounts the page once, memoized chart nodes included.
  const dateFormat = session.data?.user.dateFormat ?? DEFAULT_DISPLAY.dateFormat;
  const surnameChoice = session.data?.user.surnameChoice ?? DEFAULT_DISPLAY.surnameChoice;
  useLayoutEffect(() => setDisplay({ dateFormat, surnameChoice }), [dateFormat, surnameChoice]);
  const display = useDisplay();
  // The account's color scheme and theme: applied to the page and written to the browser's mirror (signed out, the
  // mirror from the last visit stays, so the login page keeps the look).
  const colorScheme = session.data?.user.colorScheme;
  const theme = session.data?.user.theme;
  useLayoutEffect(() => {
    if (colorScheme && theme) applyTheme({ colorScheme, theme });
  }, [colorScheme, theme]);
  // The tree chart is the one page that fills the window; every other page stays centred at 880 px.
  const fullWidth = /^\/tree\/[^/]+/.test(useLocation().pathname);
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
              <NavLink to="/tree">{t('nav.tree')}</NavLink>
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
      <main id="main" className={fullWidth ? 'tree-main' : 'page-width'}>
        <NoticeList />
        <Routes key={`${display.dateFormat}|${display.surnameChoice}`}>
          <Route path="/setup" element={<SetupRoute />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<RequireSignIn />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/tree" element={<TreeIndexPage />} />
            <Route path="/tree/:id" element={<TreePage />} />
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
