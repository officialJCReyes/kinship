// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLayoutEffect } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { useSession, useSetupStatus } from './auth.js';
import { AccountMenu } from './components/AccountMenu.js';
import { Logo } from './components/Logo.js';
import { WhatsNewHost } from './components/WhatsNew.js';
import { VersionMismatchPage } from './pages/VersionMismatchPage.js';
import { leaveMaintenance, useMaintenance } from './lib/maintenance.js';
import { MaintenancePage } from './pages/MaintenancePage.js';
import { useVersionMismatch } from './lib/version-mismatch.js';
import { t } from './i18n.js';
import { DEFAULT_DISPLAY, setDisplay, useDisplay } from './lib/display.js';
import { applyTheme } from './lib/theme.js';
import { AboutPage } from './pages/AboutPage.js';
import { AdminLayout } from './pages/AdminLayout.js';
import { AdminBackupsPage } from './pages/AdminBackupsPage.js';
import { AdminEmailsPage } from './pages/AdminEmailsPage.js';
import { AdminStoragePage } from './pages/AdminStoragePage.js';
import { AdminUpdatesPage } from './pages/AdminUpdatesPage.js';
import { AdminUsersPage } from './pages/AdminUsersPage.js';
import { HomePage } from './pages/HomePage.js';
import { LinkPage } from './pages/LinkPage.js';
import { RelationshipPage } from './pages/RelationshipPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { NoticeList, NoticeProvider } from './notices.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { PeoplePage } from './pages/PeoplePage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { MediaPage } from './pages/MediaPage.js';
import { SetupPage } from './pages/SetupPage.js';
import { TreeIndexPage, TreePage } from './tree/TreePage.js';
import { entryAddress } from './tree/treeView.js';

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
  return (
    <>
      <WhatsNewHost />
      <Outlet />
    </>
  );
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
  // Setup just finished: the wizard created the signed-in person's own place on the tree, so go there.
  const personId = session.data?.user.personId;
  return (
    <Navigate
      to={session.data ? (personId ? entryAddress(personId, session.data.user.treeDefaultView) : '/') : '/login'}
      replace
    />
  );
}

export function App() {
  const mismatch = useVersionMismatch();
  const maintenance = useMaintenance();
  const session = useSession(false);
  const signedIn = Boolean(session.data);
  // The account's date format and name choices feed the display store (signed out: the defaults). The page content
  // is keyed by them, so changing one remounts the page once, memoized chart nodes included.
  const dateFormat = session.data?.user.dateFormat ?? DEFAULT_DISPLAY.dateFormat;
  const nameForm = session.data?.user.nameForm ?? DEFAULT_DISPLAY.nameForm;
  const showPrefix = session.data?.user.showPrefix ?? DEFAULT_DISPLAY.showPrefix;
  const showSuffix = session.data?.user.showSuffix ?? DEFAULT_DISPLAY.showSuffix;
  const showDeceasedMark = session.data?.user.showDeceasedMark ?? DEFAULT_DISPLAY.showDeceasedMark;
  const weekStart = session.data?.user.weekStart ?? DEFAULT_DISPLAY.weekStart;
  useLayoutEffect(
    () => setDisplay({ dateFormat, nameForm, showPrefix, showSuffix, showDeceasedMark, weekStart }),
    [dateFormat, nameForm, showPrefix, showSuffix, showDeceasedMark, weekStart],
  );
  const display = useDisplay();
  // The account's color scheme and theme: applied to the page and written to the browser's mirror (signed out, the
  // mirror from the last visit stays, so the login page keeps the look).
  const colorScheme = session.data?.user.colorScheme;
  const theme = session.data?.user.theme;
  useLayoutEffect(() => {
    if (colorScheme && theme) applyTheme({ colorScheme, theme });
  }, [colorScheme, theme]);
  // The tree chart is the one page that fills the window; every other page stays centred at 880 px.
  const pathname = useLocation().pathname;
  const fullWidth = /^\/tree\/[^/]+/.test(pathname);
  const onFinder = pathname === '/relationship';
  // Under the Family tree tab: the chart and the relationship finder.
  const showTreeSections = signedIn && (onFinder || pathname === '/tree' || pathname.startsWith('/tree/'));
  // My settings is not remounted by the changes made on it (the focus would be lost); every other page is.
  const onSettings = pathname === '/settings';
  // The tree is not remounted by the name and † choices either: the chart's settings panel changes them while it is open, and
  // the chart redraws what it must by itself (TreePage), keeping the panel, the focus and the view.
  const onTree = fullWidth;
  // The web and the api are on different versions: nothing else works, so say so on a page of its own.
  // The site is paused for a restore: nothing else works, so say so on a page of its own (ADR 0031).
  if (maintenance) return <MaintenancePage onLeave={leaveMaintenance} />;
  if (mismatch) return <VersionMismatchPage mismatch={mismatch} />;
  return (
    <NoticeProvider>
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <header className="site-header">
        <div className="page-width site-header-inner">
          <Link to="/" className="brand" aria-label={t('app.homeLink')}>
            <Logo height={38} />
          </Link>
          {signedIn ? (
            <nav aria-label={t('nav.main')}>
              <NavLink to="/" end>
                {t('nav.home')}
              </NavLink>
              <Link to="/tree" aria-current={showTreeSections ? 'page' : undefined}>
                {t('nav.tree')}
              </Link>
              <NavLink to="/people" end>
                {t('nav.people')}
              </NavLink>
              <NavLink to="/media" end>
                {t('nav.media')}
              </NavLink>
            </nav>
          ) : null}
          {session.data ? <AccountMenu user={session.data.user} /> : null}
        </div>
      </header>
      {showTreeSections ? (
        <nav className="subnav" aria-label={t('nav.treeSections')}>
          <div className="page-width subnav-inner">
            <Link to="/tree" aria-current={onFinder ? undefined : 'page'}>
              {t('nav.chart')}
            </Link>
            <NavLink to="/relationship">{t('nav.relationship')}</NavLink>
          </div>
        </nav>
      ) : null}
      <main id="main" className={fullWidth ? 'tree-main' : 'page-width'}>
        <NoticeList />
        <Routes
          key={
            onSettings
              ? 'settings'
              : onTree
                ? display.dateFormat
                : `${display.dateFormat}|${display.nameForm}|${display.showPrefix}|${display.showSuffix}|${display.showDeceasedMark}`
          }
        >
          <Route path="/setup" element={<SetupRoute />} />
          <Route path="/login" element={<LoginRoute />} />
          {/* Invitations and set-password links: for people who are not signed in, so outside RequireSignIn. */}
          <Route path="/invite" element={<LinkPage />} />
          <Route path="/reset" element={<LinkPage />} />
          <Route element={<RequireSignIn />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/tree" element={<TreeIndexPage />} />
            <Route path="/tree/:id" element={<TreePage />} />
            <Route path="/relationship" element={<RelationshipPage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/media" element={<MediaPage />} />
            <Route path="/people/:id" element={<ProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="/admin/users" replace />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="storage" element={<AdminStoragePage />} />
              <Route path="emails" element={<AdminEmailsPage />} />
              <Route path="emails/:id" element={<AdminEmailsPage />} />
              <Route path="backups" element={<AdminBackupsPage />} />
              <Route path="updates" element={<AdminUpdatesPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </NoticeProvider>
  );
}
