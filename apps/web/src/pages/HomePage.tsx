// SPDX-License-Identifier: AGPL-3.0-or-later
import { useSession } from '../auth.js';
import { t } from '../i18n.js';

export function HomePage() {
  const session = useSession(true);
  const me = session.data;
  if (!me) return null;
  return (
    <section className="card">
      <h1>{t('home.welcome', { name: me.user.displayName })}</h1>
      <p>{me.treeName ? t('home.tree', { tree: me.treeName }) : t('home.treeUnnamed')}</p>
      <p className="muted">{t('home.comingNext')}</p>
    </section>
  );
}
