// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountSummary, LinkCreated, MessageKey } from '@kinship/shared';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import * as api from '../api.js';
import { useSession } from '../auth.js';
import { InviteDialog } from '../admin/InviteDialog.js';
import { LinkDialog } from '../admin/LinkDialog.js';
import { DeleteAccountDialog } from '../admin/DeleteAccountDialog.js';
import { LinkPersonDialog } from '../admin/LinkPersonDialog.js';
import { RoleDialog } from '../admin/RoleDialog.js';
import type { ShownLink } from '../admin/LinkDialog.js';
import { useAccounts, useRefreshAccounts } from '../admin/queries.js';
import { ActionButton } from '../components/ActionButton.js';
import { Dialog } from '../components/Dialog.js';
import { RowMenu, rowMenuButtonId } from '../components/RowMenu.js';
import { EmptyState, ErrorState, Loading } from '../components/States.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';
import { passwordTrace } from '../lib/password-trace.js';
import { formatMoment } from '../lib/timestamps.js';
import { useNotices } from '../notices.js';

const STATUS_CLASS = { active: 'pill ok', invited: 'pill', expired: 'pill gray', disabled: 'pill gray' } as const;

/** What a row's button is about to do to a link, kept while its confirmation or request is open. */
type Pending =
  | { kind: 'revoke'; linkId: string; name: string }
  | { kind: 'disable'; account: AccountSummary }
  | { kind: 'unlink'; accountId: string; name: string; person: { id: string; name: string } }
  | { kind: 'busy' }
  | null;

/** Focus goes back to the row's person button once a dialog is gone and the list has re-rendered. */
const personButtonId = (accountId: string) => `person-action-${accountId}`;
const focusPersonButton = (accountId: string) =>
  window.setTimeout(() => document.getElementById(personButtonId(accountId))?.focus(), 0);

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
  const [linking, setLinking] = useState<AccountSummary | null>(null);
  const [changingRole, setChangingRole] = useState<AccountSummary | null>(null);
  const [deleting, setDeleting] = useState<AccountSummary | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
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

  const unlink = (accountId: string, name: string, personId: string) =>
    run(async () => {
      await api.unlinkAccountPerson(accountId, personId);
      await refresh();
      notify('success', t('users.unlink.done', { name }));
      focusPersonButton(accountId);
    });

  const disable = (account: AccountSummary) =>
    run(async () => {
      await api.disableAccount(account.id);
      await refresh();
      notify('success', t('users.disable.done', { name: nameOf(account) }));
      focusMenuButton(account.id);
    });
  const enable = (account: AccountSummary) =>
    run(async () => {
      await api.enableAccount(account.id);
      await refresh();
      notify('success', t('users.enable.done', { name: nameOf(account) }));
      focusMenuButton(account.id);
    });

  const focusMenuButton = (accountId: string) =>
    window.setTimeout(() => document.getElementById(rowMenuButtonId(accountId))?.focus(), 0);

  const closeDisable = () => {
    if (pending?.kind === 'disable') focusMenuButton(pending.account.id);
    setPending(null);
  };

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

  // Link, change and unlink an account's person (accounts only; an invitation is linked when it is made).
  const personActions = (account: AccountSummary) => {
    if (account.kind !== 'account') return null;
    const name = nameOf(account);
    const reason = account.canLinkPerson ? undefined : t('users.cannotManage');
    const person = account.person;
    return (
      <div className="actions wrap">
        <ActionButton
          small
          id={personButtonId(account.id)}
          disabled={busy}
          disabledReason={reason}
          aria-label={t(person ? 'users.link.changeFor' : 'users.link.actionFor', { name })}
          onClick={() => setLinking(account)}
        >
          {t(person ? 'users.link.change' : 'users.link.action')}
        </ActionButton>
        {person ? (
          <ActionButton
            small
            danger
            disabled={busy}
            disabledReason={reason}
            aria-label={t('users.link.unlinkFor', { name, person: person.name })}
            onClick={() => setPending({ kind: 'unlink', accountId: account.id, name, person })}
          >
            {t('users.link.unlink')}
          </ActionButton>
        ) : null}
      </div>
    );
  };

  // The row menu: what else an admin may do to an account. An unavailable item stays and says why.
  const rowMenu = (account: AccountSummary) => {
    if (account.kind !== 'account') return null;
    const name = nameOf(account);
    // Why disable, enable or delete is unavailable for this row.
    const unavailable = (row: AccountSummary) =>
      row.id === me.id
        ? t('users.cannot.self')
        : row.lastSuperAdmin
          ? t('users.cannot.lastSuperAdmin')
          : t('users.cannotManage');
    const roleReason =
      account.allowedRoles.length > 0
        ? undefined
        : account.id === me.id
          ? t('users.cannot.self')
          : account.role === 'superadmin'
            ? t('users.cannot.superAdminRole')
            : t('users.cannotManage');
    return (
      <RowMenu
        id={account.id}
        label={t('users.menu.for', { name })}
        disabled={busy}
        items={[
          {
            key: 'role',
            label: t('users.menu.changeRole'),
            disabledReason: roleReason,
            onSelect: () => setChangingRole(account),
          },
          account.status === 'disabled'
            ? {
                key: 'enable',
                label: t('users.menu.enable'),
                disabledReason: account.canDisable ? undefined : unavailable(account),
                onSelect: () => void enable(account),
              }
            : {
                key: 'disable',
                label: t('users.menu.disable'),
                disabledReason: account.canDisable ? undefined : unavailable(account),
                onSelect: () => setPending({ kind: 'disable', account }),
              },
          {
            key: 'delete',
            label: t('users.menu.delete'),
            danger: true,
            disabledReason: account.canDelete
              ? undefined
              : account.status !== 'disabled' && account.canDisable
                ? t('users.cannot.deleteActive')
                : unavailable(account),
            onSelect: () => setDeleting(account),
          },
        ]}
      />
    );
  };

  return (
    <section className="card">
      <div className="profile-head">
        <h1 ref={heading} tabIndex={-1}>
          {t('users.title')}
        </h1>
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
                    {personActions(account)}
                  </td>
                  <td>{t(`role.${account.role}` as MessageKey)}</td>
                  <td>
                    <RowStatus account={account} />
                    {account.disabledAt ? (
                      <div className="muted small-text">
                        {t('users.disabledOn', { date: formatMoment(account.disabledAt) })}
                      </div>
                    ) : null}
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
                  <td>
                    {actions(account)}
                    {rowMenu(account)}
                  </td>
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
      {linking ? (
        <LinkPersonDialog
          account={linking}
          takenPersonIds={takenPersonIds}
          onClose={() => {
            const id = linking.id;
            setLinking(null);
            focusPersonButton(id);
          }}
          onDone={(personName) => {
            const id = linking.id;
            setLinking(null);
            void refresh();
            notify('success', t('users.link.done', { name: nameOf(linking), person: personName }));
            focusPersonButton(id);
          }}
        />
      ) : null}
      {changingRole ? (
        <RoleDialog
          account={changingRole}
          onClose={() => {
            const id = changingRole.id;
            setChangingRole(null);
            focusMenuButton(id);
          }}
          onDone={(role) => {
            const id = changingRole.id;
            const name = nameOf(changingRole);
            setChangingRole(null);
            void refresh();
            notify('success', t('users.role.done', { name, role: t(`role.${role}` as MessageKey) }));
            focusMenuButton(id);
          }}
        />
      ) : null}
      {shown ? <LinkDialog shown={shown} onClose={() => setShown(null)} /> : null}
      {pending?.kind === 'unlink' ? (
        <Dialog title={t('users.unlink.title', { name: pending.name })} onClose={() => setPending(null)}>
          <p>{t('users.unlink.body', { name: pending.name, person: pending.person.name })}</p>
          <div className="actions">
            <button className="button" type="button" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="button danger"
              type="button"
              onClick={() => void unlink(pending.accountId, pending.name, pending.person.id)}
            >
              {t('users.unlink.confirm')}
            </button>
          </div>
        </Dialog>
      ) : null}
      {pending?.kind === 'disable' ? (
        <Dialog title={t('users.disable.title', { name: nameOf(pending.account) })} onClose={closeDisable}>
          <p>{t('users.disable.body', { name: nameOf(pending.account) })}</p>
          <div className="actions">
            <button className="button" type="button" onClick={closeDisable}>
              {t('common.cancel')}
            </button>
            <button className="button danger" type="button" onClick={() => void disable(pending.account)}>
              {t('users.disable.confirm')}
            </button>
          </div>
        </Dialog>
      ) : null}
      {deleting ? (
        <DeleteAccountDialog
          account={deleting}
          onClose={() => {
            const id = deleting.id;
            setDeleting(null);
            focusMenuButton(id);
          }}
          onDone={() => {
            const name = nameOf(deleting);
            setDeleting(null);
            void refresh();
            notify('success', t('users.delete.done', { name }));
            // the row is gone: focus goes to the page heading
            window.setTimeout(() => heading.current?.focus(), 0);
          }}
        />
      ) : null}
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
