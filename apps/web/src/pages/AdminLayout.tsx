// SPDX-License-Identifier: AGPL-3.0-or-later
import { NavLink, Outlet } from 'react-router';
import { useSession } from '../auth.js';
import { Loading } from '../components/States.js';
import { UpdateBanner } from '../components/UpdateBanner.js';
import { t } from '../i18n.js';
import { isAdmin } from '../people/permissions.js';
import { NotFoundPage } from './NotFoundPage.js';

/**
 * Everything under /admin. A Member or a User gets the not-found page (the API refuses them anyway), so the address does
 * not even say that an admin area exists. The tabs are Users; Storage & email, Emails and Backups (SuperAdmin only); and
 * Updates (a Family Admin sees only a note there). Emails comes right after Storage & email (prompt 12; the mockup puts it later).
 */
export function AdminLayout() {
  const session = useSession(false);
  if (session.isPending) return <Loading />;
  if (!isAdmin(session.data?.user)) return <NotFoundPage />;
  return (
    <div className="stack">
      <nav className="tabs" aria-label={t('admin.sections')}>
        <NavLink to="/admin/users">{t('admin.tab.users')}</NavLink>
        {session.data?.user.role === 'superadmin' ? (
          <>
            <NavLink to="/admin/storage">{t('admin.tab.storage')}</NavLink>
            <NavLink to="/admin/emails">{t('admin.tab.emails')}</NavLink>
            <NavLink to="/admin/backups">{t('admin.tab.backups')}</NavLink>
          </>
        ) : null}
        <NavLink to="/admin/updates">{t('admin.tab.updates')}</NavLink>
      </nav>
      {/* The update notice heads every Admin page, for the SuperAdmin only (the server refuses anyone else). */}
      {session.data?.user.role === 'superadmin' ? <UpdateBanner /> : null}
      <Outlet />
    </div>
  );
}
