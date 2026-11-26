// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The person panel's More menu (step 49): Copy link to this person, Change photo, and for admins, after a line, Delete
// person. Only actions that already exist elsewhere; nothing new is done here.
//   - Copy link puts the person's absolute profile address on the clipboard and says "Link copied" in a polite live region.
//     When the browser refuses (no clipboard on a plain-http address, or permission denied), a dialog shows the address
//     selected, to copy by hand.
//   - Change photo opens the avatar's camera menu (the same Upload, Choose and Remove). Unavailable, with the reason, for
//     someone who cannot edit the person.
//   - Delete person is the profile's delete dialog; afterwards the tree stays on the tree (the caller decides where).
import type { AuthUser, Person } from '@kinship/shared';
import { useEffect, useState } from 'react';
import { Dialog } from '../components/Dialog.js';
import { IconButton } from '../components/IconButton.js';
import { MoreIcon } from '../components/icons.js';
import { RowMenu, rowMenuButtonId } from '../components/RowMenu.js';
import type { RowMenuItem } from '../components/RowMenu.js';
import { t } from '../i18n.js';
import { displayName } from '../lib/names.js';
import { isAdmin } from '../people/permissions.js';
import { DeletePersonDialog } from '../people/RelationshipDialogs.js';

/** How long "Link copied" stays on screen. */
export const COPIED_MS = 4000;

/** The person's profile page as an absolute address, to paste anywhere. */
export function personLink(personId: string, origin = window.location.origin): string {
  return new URL(`/people/${encodeURIComponent(personId)}`, origin).href;
}

/** The id of the avatar's camera button (ProfilePhotoControl's menu), which Change photo opens. */
export const photoMenuButtonId = (personId: string) => rowMenuButtonId(`photo-${personId}`);

export function PanelMore({
  person,
  me,
  canEdit,
  editBlocked,
  onDeleted,
}: {
  person: Person;
  me: AuthUser;
  /** permissions.edit from the API, or null while it loads. */
  canEdit: boolean | null;
  /** Why someone who cannot edit cannot (shown on Change photo). */
  editBlocked: string;
  onDeleted: () => void;
}) {
  const [status, setStatus] = useState('');
  const [fallback, setFallback] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const name = displayName(person);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(''), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const copyLink = async () => {
    const address = personLink(person.id);
    setStatus('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(address);
      setStatus(t('tree.panel.linkCopied'));
    } catch {
      setFallback(address);
    }
  };

  const items: RowMenuItem[] = [{ key: 'copy', label: t('tree.panel.copyLink'), onSelect: () => void copyLink() }];
  if (!person.isPlaceholder) {
    items.push({
      key: 'photo',
      label: t('tree.panel.changePhoto'),
      // The camera menu is drawn once this menu has closed, and takes the focus.
      onSelect: () => document.getElementById(photoMenuButtonId(person.id))?.click(),
      disabledReason: canEdit === null ? t('tree.panel.loading') : canEdit ? undefined : editBlocked,
    });
  }
  if (isAdmin(me)) {
    items.push({
      key: 'delete',
      label: t('profile.delete'),
      onSelect: () => setDeleting(true),
      danger: true,
      divider: true,
    });
  }

  return (
    <>
      <RowMenu
        id={`panel-more-${person.id}`}
        label={t('tree.panel.more')}
        items={items}
        trigger={({ label, ...props }) => <IconButton {...props} label={label} icon={<MoreIcon />} />}
      />
      <span role="status" aria-live="polite" className="panel-status muted">
        {status}
      </span>
      {fallback ? (
        <Dialog title={t('tree.panel.copyLinkFallback.title', { name })} onClose={() => setFallback(null)}>
          <div className="stack">
            <p>{t('tree.panel.copyLinkFallback.help')}</p>
            <div className="field">
              <label htmlFor="panel-link-address">{t('tree.panel.copyLinkFallback.label')}</label>
              <input
                id="panel-link-address"
                className="link-address"
                readOnly
                data-autofocus
                value={fallback}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          </div>
        </Dialog>
      ) : null}
      {deleting ? (
        <DeletePersonDialog person={person} onClose={() => setDeleting(false)} onDeleted={onDeleted} />
      ) : null}
    </>
  );
}
