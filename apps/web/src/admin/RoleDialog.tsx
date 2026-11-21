// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountSummary, MessageKey, Role } from '@kinship/shared';
import { useState } from 'react';
import * as api from '../api.js';
import { Dialog } from '../components/Dialog.js';
import { t } from '../i18n.js';
import { errorMessage } from '../lib/errors.js';

/**
 * Change an account's role (Admin → Users, ADR 0029). A group of radio buttons with only the roles this admin may set, the
 * current one marked. Save stays off until the choice differs. A Member with no linked person is warned (they could only read
 * the tree). The server checks every rule again and says when the role changed in the meantime.
 */
export function RoleDialog({
  account,
  onDone,
  onClose,
}: {
  account: AccountSummary;
  onDone: (role: Role) => void;
  onClose: () => void;
}) {
  const name = account.displayName ?? account.email;
  const [role, setRole] = useState<Role>(account.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.changeAccountRole(account.id, { role, currentRole: account.role });
      onDone(role);
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('users.role.title', { name })} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (role !== account.role) void save();
        }}
      >
        {error ? (
          <div className="alert" role="alert">
            {errorMessage(error)}
          </div>
        ) : null}
        <fieldset className="choice">
          <legend>{t('users.role.legend')}</legend>
          {account.allowedRoles.map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="role"
                value={value}
                checked={role === value}
                onChange={() => setRole(value)}
                aria-describedby={`role-desc-${value}`}
              />{' '}
              {t(`role.${value}` as MessageKey)}
              {value === account.role ? <span className="muted"> {t('users.role.current')}</span> : null}
              <span id={`role-desc-${value}`} className="muted field-help" style={{ display: 'block' }}>
                {t(`users.role.desc.${value}` as MessageKey)}
              </span>
            </label>
          ))}
        </fieldset>
        {role === 'member' && account.person === null ? (
          <div className="notice warning" role="note">
            {t('users.role.noPerson')}
          </div>
        ) : null}
        <p className="muted">{t('users.role.immediate')}</p>
        <div className="actions">
          <button className="button" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="button primary" type="submit" disabled={busy || role === account.role}>
            {t('users.role.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
