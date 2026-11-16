// SPDX-License-Identifier: AGPL-3.0-or-later
import { NavLink, Outlet } from 'react-router';
import { useSession } from '../auth.js';
import { Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { isAdmin } from '../people/permissions.js';
import { NotFoundPage } from './NotFoundPage.js';

/**
 * Everything under /admin. A Member or a User gets the not-found page (the API refuses them anyway), so the address does
 * not even say that an admin area exists. A tab bar with only "Users" for now.
 */
export function AdminLayout() {
  const session = useSession(false);
  if (session.isPending) return <Loading />;
  if (!isAdmin(session.data?.user)) return <NotFoundPage />;
  return (
    <div className="stack">
      <nav className="tabs" aria-label={t('admin.sections')}>
        <NavLink to="/admin/users">{t('admin.tab.users')}</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
