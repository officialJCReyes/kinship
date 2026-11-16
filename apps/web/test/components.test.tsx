// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionButton } from '../src/components/ActionButton.js';
import { DateInput } from '../src/components/DateInput.js';
import { Dialog } from '../src/components/Dialog.js';
import { PersonPicker } from '../src/components/PersonPicker.js';
import { emptyDateDraft } from '../src/lib/dates.js';
import type { DateDraft } from '../src/lib/dates.js';
import { PEOPLE } from './family.js';
import { mockApi } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

function DialogHost({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open ? (
        <Dialog
          title="A dialog"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <input aria-label="first" />
          <button>last</button>
        </Dialog>
      ) : null}
    </>
  );
}

describe('Dialog', () => {
  it('is labelled, takes focus, wraps Tab inside, closes on Escape and gives focus back', () => {
    const onClose = vi.fn();
    render(<DialogHost onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'A dialog' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const first = screen.getByLabelText('first');
    const last = screen.getByRole('button', { name: 'last' });
    // The first focusable thing is the Close button in the header.
    const close = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(first).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('ActionButton', () => {
  it('is disabled with a tooltip, stays focusable and does nothing when clicked', () => {
    const onClick = vi.fn();
    render(
      <ActionButton disabledReason="You can only edit your own profile" onClick={onClick}>
        Edit
      </ActionButton>,
    );
    const button = screen.getByRole('button', { name: 'Edit' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe('You can only edit your own profile');
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

function DateHost({ initial = emptyDateDraft }: { initial?: DateDraft }) {
  const [draft, setDraft] = useState(initial);
  return <DateInput label="Birth date" draft={draft} onChange={setDraft} />;
}

describe('DateInput', () => {
  it('previews what was typed, including how sure it is', () => {
    render(<DateHost />);
    const input = screen.getByLabelText('Birth date');
    fireEvent.change(input, { target: { value: '1955-03' } });
    expect(screen.getByText('Reads as: Mar 1955')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('How sure: Birth date'), { target: { value: 'about' } });
    expect(screen.getByText('Reads as: about Mar 1955')).toBeTruthy();
  });

  it('says what is wrong after leaving the field, tied to the field', () => {
    render(<DateHost />);
    const input = screen.getByLabelText('Birth date');
    fireEvent.change(input, { target: { value: '1955-02-30' } });
    expect(screen.queryByText(/Enter a date as/)).toBeNull();
    fireEvent.blur(input);
    const error = screen.getByText(/Enter a date as YYYY/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('accepts an empty date without complaint', () => {
    render(<DateHost />);
    const input = screen.getByLabelText('Birth date');
    fireEvent.blur(input);
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('PersonPicker', () => {
  it('searches by name, moves with the arrow keys, chooses with Enter and can be changed', async () => {
    mockApi({
      '/api/people?q=ha&limit=8': {
        status: 200,
        body: { items: PEOPLE.filter((p) => p.surname === 'Hale'), nextCursor: null },
      },
    });
    const onChange = vi.fn();
    function Host() {
      const [value, setValue] = useState<(typeof PEOPLE)[number] | null>(null);
      return (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <PersonPicker
            label="Find them"
            value={value}
            onChange={(p) => {
              onChange(p);
              setValue(p);
            }}
            excludeIds={['walter']}
          />
        </QueryClientProvider>
      );
    }
    render(<Host />);
    const box = screen.getByRole('combobox', { name: 'Find them' });
    fireEvent.change(box, { target: { value: 'ha' } });
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).not.toContain('Walter Hale');
    expect(options[0]?.textContent).toContain('Rosa Hale');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'daniel' }));
    expect(screen.getByText(/Daniel Hale/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('combobox', { name: 'Find them' })).toBeTruthy();
  });
});
