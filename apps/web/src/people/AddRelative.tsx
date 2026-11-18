// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName } from '../lib/names.js';
import { LINK_KINDS } from '@kinship/shared';
import type {
  AuthUser,
  Gender,
  LinkKind,
  MessageKey,
  Person,
  PersonDetail,
  TreeResponse,
  UnionStatus,
} from '@kinship/shared';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import * as api from '../api.js';
import { ActionButton } from '../components/ActionButton.js';
import { DateInput } from '../components/DateInput.js';
import { Dialog } from '../components/Dialog.js';
import { PersonPicker } from '../components/PersonPicker.js';
import { SelectField } from '../components/SelectField.js';
import { t } from '../i18n.js';
import { emptyDateDraft, draftToInput } from '../lib/dates.js';
import type { DateDraft } from '../lib/dates.js';
import { errorMessage, warningTexts } from '../lib/errors.js';
import { statusName } from '../lib/labels.js';
import { lifespan, parentIdsOf, peopleById } from '../lib/people.js';
import { useNotices } from '../notices.js';
import { CreatedButNotLinked, createThenLink, newPartnerLink, sortedPair } from './relatives.js';
import type { Added } from './relatives.js';
import { isAdmin } from './permissions.js';
import { checkPersonDraft, emptyPersonDraft, PersonFields } from './PersonForm.js';
import type { PersonDraft } from './PersonForm.js';
import { usePersonDetail, useRefreshPeople } from './queries.js';
import { asksMarriedSurname, checkUnionDraft, emptyUnionDraft, MarriedSurnames, UnionFields } from './UnionForm.js';
import type { UnionDraft } from './UnionForm.js';

export type RelativeKind = 'father' | 'mother' | 'brother' | 'sister' | 'partner' | 'son' | 'daughter';

const GENDER_OF: Record<RelativeKind, Gender | ''> = {
  father: 'male',
  mother: 'female',
  brother: 'male',
  sister: 'female',
  partner: '',
  son: 'male',
  daughter: 'female',
};

interface Context {
  detail: PersonDetail;
  tree: TreeResponse;
  me: AuthUser;
}

/**
 * Which "Add father/mother" cards to offer: the parents that are missing. For an admin that is across both sets
 * (a person with two birth parents can still get adoptive parents); for everyone else, the birth set.
 */
export function missingParentCards(detail: PersonDetail, tree: TreeResponse, admin = false): RelativeKind[] {
  const people = peopleById(tree);
  const cards = new Set<RelativeKind>();
  for (const kind of admin ? LINK_KINDS : (['birth'] as const)) {
    const parentIds = parentIdsOf(detail.parents[kind], tree.unions);
    if (parentIds.length >= 2) continue;
    const existing = parentIds[0] ? people.get(parentIds[0]) : undefined;
    if (existing?.gender === 'male') cards.add('mother');
    else if (existing?.gender === 'female') cards.add('father');
    else {
      cards.add('father');
      cards.add('mother');
    }
  }
  return (['father', 'mother'] as const).filter((card) => cards.has(card));
}

function RelativeCard({
  kind,
  disabledReason,
  onPick,
  hint,
}: {
  kind: RelativeKind;
  disabledReason?: string | undefined;
  onPick: (kind: RelativeKind) => void;
  hint?: string;
}) {
  const side = GENDER_OF[kind] === 'male' ? 'm' : GENDER_OF[kind] === 'female' ? 'f' : 'n';
  return (
    <ActionButton className={`arcard ${side}`} disabledReason={disabledReason} onClick={() => onPick(kind)}>
      <b>{t(`addRelative.card.${kind}` as MessageKey)}</b>
      {hint ? <small>{hint}</small> : null}
    </ActionButton>
  );
}

/** Add relative: the person in the middle with "Add ..." cards around them, then a form for the one picked. */
export function AddRelativeDialog({ detail, tree, me, onClose }: Context & { onClose: () => void }) {
  const [kind, setKind] = useState<RelativeKind | null>(null);
  const person = detail.person;
  const admin = isAdmin(me);
  const parentCards = missingParentCards(detail, tree, admin);
  const askAdmin = t('addRelative.askAdmin');
  const adminOnly = admin ? undefined : askAdmin;
  // A brother or sister is for admins. With no parents on the tree, unknown parents are added for both (ADR 0019).
  const siblingReason = adminOnly;
  const childReason = admin || detail.permissions.addChild ? undefined : askAdmin;

  if (kind) {
    return (
      <Dialog
        title={t('addRelative.formTitle', {
          relative: t(`addRelative.relative.${kind}` as MessageKey),
          name: displayName(person),
        })}
        onClose={onClose}
      >
        <RelativeForm kind={kind} detail={detail} tree={tree} me={me} onBack={() => setKind(null)} onDone={onClose} />
      </Dialog>
    );
  }

  return (
    <Dialog title={t('addRelative.title', { name: displayName(person) })} onClose={onClose} full>
      <div className="arstage">
        {parentCards.length > 0 ? (
          <div className="arrow parents" data-testid="ar-parents">
            {parentCards.map((card) => (
              <RelativeCard key={card} kind={card} disabledReason={adminOnly} onPick={setKind} />
            ))}
          </div>
        ) : null}
        <div className="arrow middle">
          <div className="arcol">
            <RelativeCard kind="brother" disabledReason={siblingReason} onPick={setKind} />
            <RelativeCard kind="sister" disabledReason={siblingReason} onPick={setKind} />
          </div>
          <div className="arself" aria-label={displayName(person)}>
            <b>{displayName(person)}</b>
            <small>{lifespan(person)}</small>
          </div>
          <div className="arcol">
            <RelativeCard
              kind="partner"
              disabledReason={adminOnly}
              onPick={setKind}
              hint={t('addRelative.partnerHint')}
            />
          </div>
        </div>
        <div className="arrow children">
          <RelativeCard kind="son" disabledReason={childReason} onPick={setKind} />
          <RelativeCard kind="daughter" disabledReason={childReason} onPick={setKind} />
        </div>
      </div>
      <p className="muted center">{admin ? t('addRelative.adminNote') : t('addRelative.memberNote')}</p>
    </Dialog>
  );
}

type Mode = 'new' | 'existing';

function RelativeForm({
  kind,
  detail,
  tree,
  me,
  onBack,
  onDone,
}: Context & { kind: RelativeKind; onBack: () => void; onDone: () => void }) {
  const person = detail.person;
  const people = peopleById(tree);
  const refresh = useRefreshPeople();
  const { notify } = useNotices();
  const isParent = kind === 'father' || kind === 'mother';
  const isChild = kind === 'son' || kind === 'daughter';
  const isPartner = kind === 'partner';
  const isSibling = kind === 'brother' || kind === 'sister';
  const canPickExisting = isParent || isPartner;
  const admin = isAdmin(me);
  const setSize = (which: LinkKind) => parentIdsOf(detail.parents[which], tree.unions).length;
  // Which kind of parent-child link this adds. Only admins choose; a Member's children are always birth links.
  const unavailable = (which: LinkKind): string | undefined => {
    if (isParent && setSize(which) >= 2) return t('link.unavailable.full');
    if (isSibling && which === 'adoptive' && !detail.parents.adoptive) return t('link.unavailable.none');
    return undefined;
  };
  const [linkKind, setLinkKind] = useState<LinkKind>(() => {
    if (isSibling) return detail.parents.adoptive && !detail.parents.birth ? 'adoptive' : 'birth';
    if (isParent && setSize('birth') >= 2) return 'adoptive';
    return 'birth';
  });
  const [linkDate, setLinkDate] = useState<DateDraft>(emptyDateDraft);
  const linkInput = linkKind === 'adoptive' && admin ? draftToInput(linkDate) : null;
  const chosenSet = detail.parents[linkKind];
  const chosenKind: LinkKind = admin ? linkKind : 'birth';

  const [mode, setMode] = useState<Mode>('new');
  const [draft, setDraft] = useState<PersonDraft>(emptyPersonDraft(GENDER_OF[kind]));
  const [existing, setExisting] = useState<Person | null>(null);
  const [union, setUnion] = useState<UnionDraft>(emptyUnionDraft());
  // The person's own married surname, asked for next to a Married or Widowed partner (when they may be changed).
  const [ownMarried, setOwnMarried] = useState(person.marriedSurname ?? '');
  // The other parent of a new child: a relationship id, or '' for "not on the tree".
  const [otherParent, setOtherParent] = useState(detail.unions[0]?.id ?? '');
  const [chosenUnion, setChosenUnion] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const useExisting = canPickExisting && mode === 'existing';
  const { input, problems } = checkPersonDraft(draft);
  const unionChecked = checkUnionDraft(union);

  // Adding a second parent to a child who has one: do the two already have a relationship?
  const singleParentId = isParent ? (detail.parents[chosenKind]?.parentId ?? null) : null;
  const existingDetail = usePersonDetail(useExisting && singleParentId && existing ? existing.id : undefined);
  const sharedUnions = (existingDetail.data?.unions ?? []).filter(
    (candidate) => singleParentId !== null && candidate.partnerIds.includes(singleParentId),
  );
  const willCreateUnknown =
    singleParentId !== null &&
    (!useExisting || (existing !== null && existingDetail.isSuccess && sharedUnions.length === 0));
  const needsUnionChoice = useExisting && sharedUnions.length > 1;

  // What the server stored for a new partner relationship (it can differ from what was asked).
  const saved = useRef<UnionStatus | null>(null);
  const run = async (): Promise<Added | null> => {
    saved.current = null;
    if (isChild) {
      if (!input) return null;
      if (linkInput === undefined) return null;
      const result = await api.addChild(person.id, {
        child: input,
        ...(otherParent ? { unionId: otherParent } : {}),
        ...(admin ? { kind: chosenKind, ...(linkInput ? { link: linkInput } : {}) } : {}),
      });
      return { person: result.person, warnings: result.warnings };
    }
    if (isParent) {
      if (useExisting) {
        if (!existing || (needsUnionChoice && !chosenUnion) || linkInput === undefined) return null;
        const result = await api.addParent(person.id, {
          parentId: existing.id,
          kind: chosenKind,
          ...(linkInput ? { link: linkInput } : {}),
          ...(chosenUnion ? { unionId: chosenUnion } : {}),
        });
        return { person: existing, warnings: result.warnings };
      }
      if (!input || linkInput === undefined) return null;
      return createThenLink(
        input,
        async (parent) =>
          (
            await api.addParent(person.id, {
              parentId: parent.id,
              kind: chosenKind,
              ...(linkInput ? { link: linkInput } : {}),
            })
          ).warnings,
      );
    }
    if (isPartner) {
      if (!unionChecked.ok) return null;
      const link = { status: union.status, start: unionChecked.start, end: unionChecked.end };
      const saveOwnSurname = async () => {
        const next = ownMarried.trim();
        if (detail.permissions.edit && asksMarriedSurname(union.status) && next !== (person.marriedSurname ?? '')) {
          await api.updatePerson(person.id, { marriedSurname: next || null });
        }
      };
      if (useExisting) {
        if (!existing) return null;
        const created = await api.createUnion({ ...link, partnerIds: sortedPair(person.id, existing.id) });
        saved.current = created.union.status;
        await saveOwnSurname();
        return { person: existing, warnings: [] };
      }
      if (!input) return null;
      const added = await createThenLink(
        input,
        newPartnerLink(person.id, link, (status) => {
          saved.current = status;
        }),
      );
      await saveOwnSurname();
      return added;
    }
    // A brother or sister: one call, one transaction. The server adds unknown parents when there are none.
    if (!input || linkInput === undefined) return null;
    const result = await api.addSibling(person.id, {
      sibling: input,
      kind: chosenKind,
      ...(linkInput ? { link: linkInput } : {}),
    });
    return { person: result.person, warnings: result.warnings };
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    setPending(true);
    try {
      const added = await run();
      if (!added) return;
      await refresh();
      for (const text of warningTexts(added.warnings)) notify('warning', text);
      notify('success', t('notice.addedRelative', { name: displayName(added.person) }));
      if (isPartner && saved.current !== null && saved.current !== union.status)
        notify('success', t('notice.unionSavedWidowed'));
      onDone();
    } catch (caught) {
      setError(caught);
      // Whatever happened, the tree may have changed (a person that was created or removed again).
      void refresh();
    } finally {
      setPending(false);
    }
  };

  const partnerNames = (id: string) => {
    const other = detail.unions.find((u) => u.id === id)?.partnerIds.find((p) => p !== person.id);
    return other ? (people.get(other) ? displayName(people.get(other) as Person) : '') : '';
  };

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      {admin && (isParent || isChild || isSibling) ? (
        <fieldset className="choice">
          <legend>{t('link.type')}</legend>
          {LINK_KINDS.map((which) => (
            <label key={which} title={unavailable(which)}>
              <input
                type="radio"
                name="link-kind"
                checked={linkKind === which}
                disabled={unavailable(which) !== undefined}
                onChange={() => setLinkKind(which)}
              />{' '}
              {t(`link.kind.${which}`)}
            </label>
          ))}
          <p className="muted field-help">{t('link.typeHelp')}</p>
        </fieldset>
      ) : null}
      {admin && linkKind === 'adoptive' && (isParent || isChild || isSibling) ? (
        <DateInput label={t('link.date.adoptive')} draft={linkDate} onChange={setLinkDate} showError={submitted} />
      ) : null}

      {isSibling && !chosenSet && linkKind === 'birth' ? (
        <p className="muted" data-testid="placeholder-note">
          {t('addRelative.placeholderNote')}
        </p>
      ) : null}

      {canPickExisting ? (
        <fieldset className="choice">
          <legend>{t('addRelative.who')}</legend>
          <label>
            <input type="radio" name="mode" checked={mode === 'new'} onChange={() => setMode('new')} />{' '}
            {t('addRelative.whoNew')}
          </label>
          <label>
            <input type="radio" name="mode" checked={mode === 'existing'} onChange={() => setMode('existing')} />{' '}
            {t('addRelative.whoExisting')}
          </label>
        </fieldset>
      ) : null}

      {useExisting ? (
        <>
          <PersonPicker
            label={t('addRelative.pick')}
            value={existing}
            onChange={(value) => {
              setExisting(value);
              setChosenUnion('');
            }}
            excludeIds={[person.id, ...parentIdsOf(detail.parents[chosenKind], tree.unions)]}
          />
          {submitted && !existing ? (
            <div className="field-error" role="alert">
              {t('addRelative.pickRequired')}
            </div>
          ) : null}
        </>
      ) : (
        <PersonFields
          draft={draft}
          onChange={setDraft}
          showErrors={submitted}
          problems={problems}
          showMarriedSurname={isPartner && asksMarriedSurname(union.status)}
        />
      )}

      {isChild ? (
        <SelectField
          label={t('addRelative.otherParent')}
          value={otherParent}
          onChange={(event) => setOtherParent(event.target.value)}
          help={t('addRelative.otherParentHelp')}
        >
          {detail.unions.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {t('addRelative.otherParentOption', {
                name: partnerNames(candidate.id),
                status: statusName(candidate.status),
              })}
            </option>
          ))}
          <option value="">{t('addRelative.otherParentNone')}</option>
        </SelectField>
      ) : null}

      {isPartner ? <UnionFields draft={union} onChange={setUnion} showErrors={submitted} /> : null}
      {isPartner && detail.permissions.edit ? (
        <MarriedSurnames
          status={union.status}
          partners={[{ id: person.id, name: displayName(person), value: ownMarried }]}
          onChange={(_id, value) => setOwnMarried(value)}
        />
      ) : null}

      {needsUnionChoice ? (
        <SelectField
          label={t('addRelative.whichRelationship')}
          value={chosenUnion}
          onChange={(event) => setChosenUnion(event.target.value)}
          error={submitted && !chosenUnion ? t('error.union_ambiguous') : undefined}
        >
          <option value="">{t('addRelative.choose')}</option>
          {sharedUnions.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {statusName(candidate.status)}
              {candidate.start ? ` (${candidate.start.value})` : ''}
            </option>
          ))}
        </SelectField>
      ) : null}

      {willCreateUnknown ? (
        <p className="notice info" role="note">
          {t('addRelative.unknownNote')}
        </p>
      ) : null}
      {isParent && useExisting && existing && sharedUnions.length === 1 ? (
        <p className="muted">{t('addRelative.usesExisting')}</p>
      ) : null}

      {error instanceof CreatedButNotLinked ? (
        <div className="alert" role="alert">
          {t('addRelative.notLinked', { name: displayName(error.person) })}{' '}
          <Link to={`/people/${error.person.id}`} onClick={onDone}>
            {t('addRelative.openProfile')}
          </Link>
        </div>
      ) : error ? (
        <div className="alert" role="alert">
          {errorMessage(error)}
        </div>
      ) : null}

      <div className="actions between">
        <ActionButton onClick={onBack}>{t('common.back')}</ActionButton>
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
