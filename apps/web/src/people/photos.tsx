// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Photos on a profile (ADR 0034): the Photos card, the viewer (date taken, set as profile photo, remove, delete), the choice of a
// file, and the profile picture's upload button. Every file goes to the API, which decides what it is and strips what it carries.
import type { MediaInfo, Person } from '@kinship/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import * as api from '../api.js';
import { ActionButton } from '../components/ActionButton.js';
import { Dialog } from '../components/Dialog.js';
import { t } from '../i18n.js';
import { formatDate, isValidDateText } from '../lib/dates.js';
import { displayName } from '../lib/names.js';
import { checkPhotoFile, PHOTO_ACCEPT, photoErrorMessage, photoUrl } from '../lib/photos.js';
import { useNotices } from '../notices.js';
import { peopleKey, useRefreshPeople } from './queries.js';

export function usePersonPhotos(personId: string) {
  return useQuery({
    queryKey: [...peopleKey, 'photos', personId],
    queryFn: ({ signal }) => api.fetchPersonPhotos(personId, signal),
  });
}

function PhotoError({ message }: { message: string | null }) {
  return message ? (
    <div className="alert" role="alert">
      {message}
    </div>
  ) : null;
}

/** What was just uploaded, waiting for its date taken to be confirmed. */
interface Uploaded {
  photo: MediaInfo;
  suggestedTakenOn: string | null;
}

/**
 * Choosing and uploading a photo. `pick` checks the file in the browser first (type and size, so a wrong choice never leaves the
 * machine), sends it, optionally makes it the profile photo, and hands back the new photo so its date taken can be asked.
 */
export function usePhotoUpload(person: Person, { asProfile }: { asProfile: boolean }) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const [problem, setProblem] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File): Promise<Uploaded> => {
      const result = await api.uploadPhoto(person.id, file);
      if (asProfile) await api.updatePerson(person.id, { photoMediaId: result.photo.id });
      return result;
    },
  });
  const pick = (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    const early = checkPhotoFile(file);
    if (early) {
      setProblem(t(early));
      return;
    }
    upload.mutate(file, {
      onSuccess: async (result) => {
        await refresh();
        notify('success', t(asProfile ? 'photo.notice.profileSet' : 'photo.notice.added'));
        setUploaded(result);
      },
      onError: (error) => setProblem(photoErrorMessage(error)),
    });
  };
  return { pick, pending: upload.isPending, problem, uploaded, clearUploaded: () => setUploaded(null) };
}

/** A hidden file input with a button in front of it, so a keyboard, a screen reader and a touch screen can all choose a file. */
function FilePicker({
  label,
  busy,
  onFile,
  className,
  children,
}: {
  label: string;
  busy: boolean;
  onFile: (file: File | undefined) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFile(event.target.files?.[0]);
    // The same file can be chosen again after a failure.
    event.target.value = '';
  };
  return (
    <>
      <button type="button" className={className ?? 'button'} disabled={busy} onClick={() => input.current?.click()}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        aria-label={label}
        className="sr-only"
        tabIndex={-1}
        onChange={onChange}
      />
    </>
  );
}

/** The round "change photo" button on the profile picture. */
export function AvatarUpload({ person, hasPhoto }: { person: Person; hasPhoto: boolean }) {
  const { pick, pending, problem, uploaded, clearUploaded } = usePhotoUpload(person, { asProfile: true });
  const label = t(hasPhoto ? 'photo.avatar.change' : 'photo.avatar.add');
  return (
    <>
      <span className="avatar-upload" title={label}>
        <FilePicker label={label} busy={pending} onFile={pick} className="avatar-upload-button">
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          <span className="sr-only">{label}</span>
        </FilePicker>
      </span>
      {problem ? <PhotoError message={problem} /> : null}
      {uploaded ? <TakenOnDialog uploaded={uploaded} onClose={clearUploaded} /> : null}
    </>
  );
}

/** The date taken field: a year, a month or a day as typed (it is not a birth date, so there is no "about" or "before"). */
function TakenOnField({
  value,
  onChange,
  invalid,
  suggested,
}: {
  value: string;
  onChange: (text: string) => void;
  invalid: boolean;
  suggested: string | null;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label htmlFor={id}>{t('photo.takenOn')}</label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        placeholder={t('date.placeholder')}
        value={value}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
      />
      <div id={hintId} className={invalid ? 'error' : 'muted small'} role={invalid ? 'alert' : undefined}>
        {invalid ? t('photo.takenOn.invalid') : t('photo.takenOn.hint')}
      </div>
      {suggested ? (
        <div className="muted small">
          {t('photo.takenOn.suggested', { date: formatDate({ value: suggested, precision: 'exactly' }) })}
        </div>
      ) : null}
    </div>
  );
}

function useSaveTakenOn(photo: MediaInfo) {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: (takenOn: string | null) => api.updateMedia(photo.id, { takenOn }),
    onSuccess: () => refresh(),
  });
}

/** Right after an upload: the photo is saved; this asks for the date taken, with what the picture itself said filled in. */
export function TakenOnDialog({ uploaded, onClose }: { uploaded: Uploaded; onClose: () => void }) {
  const { photo, suggestedTakenOn } = uploaded;
  const [text, setText] = useState(suggestedTakenOn ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useSaveTakenOn(photo);
  const typed = text.trim();
  const invalid = typed !== '' && !isValidDateText(typed);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    save.mutate(typed === '' ? null : typed, { onSuccess: onClose });
  };
  return (
    <Dialog title={t('photo.added.title')} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <img className="photo-full" src={photoUrl(photo.id, 'full')} alt="" />
        <p>{t('photo.added.body')}</p>
        <TakenOnField value={text} onChange={setText} invalid={invalid && submitted} suggested={suggestedTakenOn} />
        <PhotoError message={save.isError ? photoErrorMessage(save.error) : null} />
        <div className="actions">
          <ActionButton onClick={onClose}>{t('photo.takenOn.skip')}</ActionButton>
          <button className="button primary" type="submit" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('photo.takenOn.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type Confirm = 'remove' | 'delete' | null;

/** One photo, full size, with what can be done to it. */
function PhotoDialog({
  photo,
  person,
  isProfile,
  canEditPerson,
  onClose,
}: {
  photo: MediaInfo;
  person: Person;
  isProfile: boolean;
  canEditPerson: boolean;
  onClose: () => void;
}) {
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [text, setText] = useState(photo.takenOn ?? '');
  const [editing, setEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const save = useSaveTakenOn(photo);
  const name = displayName(person);
  const typed = text.trim();
  const invalid = typed !== '' && !isValidDateText(typed);

  const setProfile = useMutation({ mutationFn: () => api.updatePerson(person.id, { photoMediaId: photo.id }) });
  const remove = useMutation({ mutationFn: () => api.removePhotoFromPerson(person.id, photo.id) });
  const destroy = useMutation({ mutationFn: () => api.deleteMedia(photo.id) });
  const failure = [setProfile, remove, destroy, save].find((m) => m.isError)?.error;

  const done = async (notice: string) => {
    await refresh();
    notify('success', notice);
    onClose();
  };

  if (confirm) {
    const isDelete = confirm === 'delete';
    const mutation = isDelete ? destroy : remove;
    return (
      <Dialog title={t(isDelete ? 'photo.delete.title' : 'photo.removeFromPerson.title', { name })} onClose={onClose}>
        <p>{t(isDelete ? 'photo.delete.body' : 'photo.removeFromPerson.body', { name })}</p>
        <PhotoError message={mutation.isError ? photoErrorMessage(mutation.error) : null} />
        <div className="actions">
          <ActionButton onClick={() => setConfirm(null)}>{t('common.cancel')}</ActionButton>
          <ActionButton
            danger
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate(undefined, {
                onSuccess: () => void done(isDelete ? t('photo.notice.deleted') : t('photo.notice.removed', { name })),
              })
            }
          >
            {isDelete ? t('photo.delete.submit') : t('photo.removeFromPerson', { name })}
          </ActionButton>
        </div>
      </Dialog>
    );
  }

  const saveDate = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    save.mutate(typed === '' ? null : typed, { onSuccess: () => setEditing(false) });
  };

  return (
    <Dialog title={t('photo.viewer.title', { name })} onClose={onClose}>
      <div className="photo-dialog">
        <img className="photo-full" src={photoUrl(photo.id, 'full')} alt="" />
        <div className="photo-dialog-facts">
          {editing ? (
            <form onSubmit={saveDate} noValidate>
              <TakenOnField value={text} onChange={setText} invalid={invalid && submitted} suggested={null} />
              <div className="actions">
                <ActionButton
                  onClick={() => {
                    setEditing(false);
                    setText(photo.takenOn ?? '');
                  }}
                >
                  {t('common.cancel')}
                </ActionButton>
                <button className="button primary" type="submit" disabled={save.isPending}>
                  {save.isPending ? t('common.saving') : t('photo.takenOn.save')}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <strong>{t('photo.takenOn')}: </strong>
              {photo.takenOn
                ? formatDate({ value: photo.takenOn, precision: 'exactly' })
                : t('photo.takenOn.none')}{' '}
              {photo.permissions.edit ? (
                <ActionButton small onClick={() => setEditing(true)}>
                  {t('photo.takenOn.edit')}
                </ActionButton>
              ) : null}
            </div>
          )}
          {isProfile ? <div className="muted">{t('photo.isProfile')}</div> : null}
        </div>
        <PhotoError message={failure ? photoErrorMessage(failure) : null} />
        <div className="actions wrap">
          {canEditPerson && !isProfile ? (
            <ActionButton
              disabled={setProfile.isPending}
              onClick={() => setProfile.mutate(undefined, { onSuccess: () => void done(t('photo.notice.profileSet')) })}
            >
              {t('photo.setProfile')}
            </ActionButton>
          ) : null}
          {canEditPerson ? (
            <ActionButton onClick={() => setConfirm('remove')}>{t('photo.removeFromPerson', { name })}</ActionButton>
          ) : null}
          {photo.permissions.delete ? (
            <ActionButton danger onClick={() => setConfirm('delete')}>
              {t('photo.delete')}
            </ActionButton>
          ) : null}
          <ActionButton primary onClick={onClose}>
            {t('photo.viewer.close')}
          </ActionButton>
        </div>
      </div>
    </Dialog>
  );
}

/** The Photos card on a profile. */
export function PhotosCard({ person, canEdit }: { person: Person; canEdit: boolean }) {
  const photos = usePersonPhotos(person.id);
  const { pick, pending, problem, uploaded, clearUploaded } = usePhotoUpload(person, { asProfile: false });
  const [open, setOpen] = useState<string | null>(null);
  const items = photos.data?.items ?? [];
  const current = items.find((item) => item.id === open) ?? null;
  const name = displayName(person);
  return (
    <section className="card stack" aria-labelledby="photos-title">
      <div className="profile-head">
        <div>
          <h2 id="photos-title">{t('photo.card.title')}</h2>
          <p className="muted small">{t('photo.card.help', { name })}</p>
        </div>
        {canEdit ? (
          <FilePicker label={t('photo.input.label')} busy={pending} onFile={pick}>
            {pending ? t('photo.uploading') : t('photo.add')}
          </FilePicker>
        ) : null}
      </div>
      <PhotoError message={problem} />
      {photos.isError ? <p className="muted">{photoErrorMessage(photos.error)}</p> : null}
      {photos.isSuccess && items.length === 0 ? (
        <p className="muted">{t(canEdit ? 'photo.card.emptyCanAdd' : 'photo.card.empty')}</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="photo-grid" aria-label={t('photo.card.title')}>
          {items.map((item, index) => {
            const profile = person.photoMediaId === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`photo-tile${profile ? ' is-profile' : ''}`}
                  aria-label={t('photo.open', {
                    n: index + 1,
                    count: items.length,
                    profile: profile ? t('photo.open.profile') : '',
                  })}
                  onClick={() => setOpen(item.id)}
                >
                  <img src={photoUrl(item.id, 'avatar')} alt="" loading="lazy" decoding="async" />
                  {profile ? (
                    <span className="photo-badge" aria-hidden="true">
                      ★
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {current ? (
        <PhotoDialog
          photo={current}
          person={person}
          isProfile={person.photoMediaId === current.id}
          canEditPerson={canEdit}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {uploaded ? <TakenOnDialog uploaded={uploaded} onClose={clearUploaded} /> : null}
    </section>
  );
}
