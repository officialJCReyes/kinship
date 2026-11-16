// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountSummary, LinkCreated, MessageKey } from '@kinship/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import * as api from '../api.js';
import { useSession } from '../auth.js';
import { InviteDialog } from '../admin/InviteDialog.js';
import { LinkDialog } from '../admin/LinkDialog.js';
import type { ShownLink } from '../admin/LinkDialog.js';
import { useAccounts, useRefreshAccounts } from '../admin/queries.js';
import { ActionButton } from '../components/ActionButton.js';
import { Dialog } from '../components/Dialog.js';
import { EmptyState, ErrorState, Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';
import { passwordTrace } from '../lib/password-trace.js';
import { formatMoment } from '../lib/timestamps.js';
import { useNotices } from '../notices.js';

const STATUS_CLASS = { active: 'pill ok', invited: 'pill', expired: 'pill gray' } as const;

/** What a row's button is about to do to a link, kept while its confirmation or request is open. */
type Pending = { kind: 'revoke'; linkId: string; name: string } | { kind: 'busy' } | null;

function RowStatus({ account }: { account: AccountSummary }) {
  return <span className={STATUS_CLASS[account.status]}>{t(`users.status.${account.status}` as MessageKey)}</span>;
}

/**
 * Admin → Users. Accounts and invitations that have not been accepted, and what an admin may do about each: invite someone,
 * make a new link (the old one stops working), revoke a link, and make a set-password link for someone locked out. Role
 * editing, a Sign-in column, deactivating and deleting accounts are not here yet.
 */
export function AdminUsersPage() {
  const me = useSession(false).data?.user;
  const accounts = useAccounts();
  const refresh = useRefreshAccounts();
  const { notify } = useNotices();
  const [inviting, setInviting] = useState(false);
  const [shown, setShown] = useState<ShownLink | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [failure, setFailure] = useState<unknown>(null);

  if (!me) return <Loading />;
  const rows = accounts.data?.accounts ?? [];
  const takenPersonIds = rows.flatMap((row) => (row.person ? [row.person.id] : []));

  const show = (created: LinkCreated, who: string, replaced: boolean) => {
    setShown({ created, who, replaced });
    void refresh();
  };

  // The tokens in these answers go straight into the dialog's state (see LinkDialog), not into any cache.
  const run = async (work: () => Promise<void>) => {
    setFailure(null);
    setPending({ kind: 'busy' });
    try {
      await work();
    } catch (error) {
      setFailure(error);
      void refresh();
    } finally {
      setPending(null);
    }
  };
  const makeNew = (linkId: string, who: string) => run(async () => show(await api.regenerateLink(linkId), who, true));
  const makeSetPassword = (account: AccountSummary) =>
    run(async () => show(await api.createSetPasswordLink(account.id), account.displayName ?? account.email, false));
  const revoke = (linkId: string) =>
    run(async () => {
      await api.revokeLink(linkId);
      await refresh();
      notify('success', t('users.revoked'));
    });

  const busy = pending?.kind === 'busy';
  const nameOf = (account: AccountSummary) => account.displayName ?? account.email;

  const actions = (account: AccountSummary) => {
    const name = nameOf(account);
    if (account.kind === 'invitation' && account.invitation) {
      const link = account.invitation;
      const reason = link.canManage ? undefined : t('users.cannotManage');
      return (
        <div className="actions wrap">
          <ActionButton
            small
            disabled={busy}
            disabledReason={reason}
            aria-label={t('users.action.newLinkFor', { name })}
            onClick={() => void makeNew(link.id, account.email)}
          >
            {t('users.action.newLink')}
          </ActionButton>
          <ActionButton
            small
            danger
            disabled={busy}
            disabledReason={reason}
            aria-label={t('users.action.revokeFor', { name })}
            onClick={() => setPending({ kind: 'revoke', linkId: link.id, name })}
          >
            {t('users.action.revoke')}
          </ActionButton>
        </div>
      );
    }
    if (!account.canSetPasswordLink) return null;
    const link = account.setPasswordLink;
    if (link?.canManage) {
      return (
        <div className="actions wrap">
          <ActionButton
            small
            disabled={busy}
            aria-label={t('users.action.newLinkFor', { name })}
            onClick={() => void makeNew(link.id, name)}
          >
            {t('users.action.newLink')}
          </ActionButton>
          <ActionButton
            small
            danger
            disabled={busy}
            aria-label={t('users.action.revokeFor', { name })}
            onClick={() => setPending({ kind: 'revoke', linkId: link.id, name })}
          >
            {t('users.action.revoke')}
          </ActionButton>
        </div>
      );
    }
    if (link) return null;
    return (
      <div className="actions wrap">
        <ActionButton
          small
          disabled={busy}
          aria-label={t('users.action.setPasswordFor', { name })}
          onClick={() => void makeSetPassword(account)}
        >
          {t('users.action.setPassword')}
        </ActionButton>
      </div>
    );
  };

  return (
    <section className="card">
      <div className="profile-head">
        <h1>{t('users.title')}</h1>
        <ActionButton primary onClick={() => setInviting(true)}>
          {t('users.invite')}
        </ActionButton>
      </div>
      <p className="muted">{t('users.intro')}</p>
      {failure ? (
        <div className="alert" role="alert">
          {errorMessage(failure)}
        </div>
      ) : null}
      {accounts.isPending ? <Loading /> : null}
      {accounts.isError ? <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} /> : null}
      {accounts.isSuccess && rows.every((row) => row.id === me.id) ? <EmptyState>{t('users.alone')}</EmptyState> : null}
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table" aria-label={t('users.list')}>
            <thead>
              <tr>
                <th scope="col">{t('users.col.name')}</th>
                <th scope="col">{t('users.col.person')}</th>
                <th scope="col">{t('users.col.role')}</th>
                <th scope="col">{t('users.col.status')}</th>
                <th scope="col">{t('users.col.lastSignIn')}</th>
                <th scope="col">{t('users.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((account) => (
                <tr key={`${account.kind}-${account.id}`}>
                  <th scope="row">
                    <div>
                      {account.displayName ?? <span className="muted">{t('users.invitation')}</span>}
                      {account.id === me.id ? <span className="muted"> ({t('users.you')})</span> : null}
                    </div>
                    <div className="muted small-text">{account.email}</div>
                    {account.invitedBy ? (
                      <div className="muted small-text">{t('users.invitedBy', { name: account.invitedBy })}</div>
                    ) : null}
                    {account.invitation?.note ? (
                      <div className="muted small-text">{t('users.noteLabel', { note: account.invitation.note })}</div>
                    ) : null}
                    {account.kind === 'account' ? (
                      <div className="muted small-text">
                        {passwordTrace(account.passwordChangedAt, account.passwordChangedVia)}
                      </div>
                    ) : null}
                  </th>
                  <td>
                    {account.person ? (
                      <Link to={`/people/${account.person.id}`}>{account.person.name}</Link>
                    ) : (
                      <span className="muted">{t('users.notLinked')}</span>
                    )}
                  </td>
                  <td>{t(`role.${account.role}` as MessageKey)}</td>
                  <td>
                    <RowStatus account={account} />
                    {account.invitation ? (
                      <div className="muted small-text">
                        {account.invitation.expired
                          ? t('users.invitationExpired', { date: formatMoment(account.invitation.expiresAt) })
                          : t('users.invitationExpires', { date: formatMoment(account.invitation.expiresAt) })}
                      </div>
                    ) : null}
                    {account.setPasswordLink ? (
                      <div className="muted small-text">
                        {account.setPasswordLink.expired
                          ? t('users.setPasswordExpired', { date: formatMoment(account.setPasswordLink.expiresAt) })
                          : t('users.setPasswordOpen', { date: formatMoment(account.setPasswordLink.expiresAt) })}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {account.kind === 'account' ? (
                      account.lastSignInAt ? (
                        formatMoment(account.lastSignInAt)
                      ) : (
                        <span className="muted">{t('users.never')}</span>
                      )
                    ) : (
                      ''
                    )}
                  </td>
                  <td>{actions(account)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {inviting ? (
        <InviteDialog
          me={me}
          takenPersonIds={takenPersonIds}
          onClose={() => setInviting(false)}
          onCreated={(created, email) => {
            setInviting(false);
            show(created, email, false);
          }}
        />
      ) : null}
      {shown ? <LinkDialog shown={shown} onClose={() => setShown(null)} /> : null}
      {pending?.kind === 'revoke' ? (
        <Dialog title={t('users.revoke.title')} onClose={() => setPending(null)}>
          <p>{t('users.revoke.body', { name: pending.name })}</p>
          <div className="actions">
            <button className="button" type="button" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
            <button className="button danger" type="button" onClick={() => void revoke(pending.linkId)}>
              {t('users.revoke.confirm')}
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
