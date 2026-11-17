// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The calendar picker beside the typed date. Typing keeps working as it did; the picker only adds a way to fill the same
// field (always as YYYY, YYYY-MM or YYYY-MM-DD, which is what the field and the API take), so partial dates still work.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '../src/components/Dialog.js';
import { DateInput } from '../src/components/DateInput.js';
import { DEFAULT_DISPLAY, setDisplay } from '../src/lib/display.js';
import type { DateDraft } from '../src/lib/dates.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T12:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
  setDisplay(DEFAULT_DISPLAY);
  cleanup();
});

let latest: DateDraft = { text: '', precision: 'exactly' };
function Harness({ start = '' }: { start?: string }) {
  const [draft, setDraft] = useState<DateDraft>({ text: start, precision: 'exactly' });
  return (
    <DateInput
      label="Birth date"
      draft={draft}
      onChange={(next) => {
        latest = next;
        setDraft(next);
      }}
    />
  );
}

const toggle = () => screen.getByRole('button', { name: 'Choose Birth date on a calendar' });
const open = () => fireEvent.click(toggle());
const picker = () => screen.getByRole('dialog', { name: 'Calendar for Birth date' });
const caption = () => within(picker()).getByRole('grid').querySelector('caption')!.textContent;
const day = (name: string) => within(picker()).getByRole('button', { name });
const input = () => screen.getByLabelText('Birth date') as HTMLInputElement;

describe('typing is unchanged', () => {
  it('still takes a typed date, partial or whole, with the preview and the precision', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: '1903-06' } });
    expect(latest).toEqual({ text: '1903-06', precision: 'exactly' });
    expect(screen.getByText('Reads as: Jun 1903')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('How sure: Birth date'), { target: { value: 'about' } });
    expect(latest.precision).toBe('about');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('opening', () => {
  it('has a labelled button that says whether the calendar is open, and a calendar with its own name', () => {
    render(<Harness />);
    expect(toggle().getAttribute('aria-haspopup')).toBe('dialog');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    open();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(picker().id);
    fireEvent.click(toggle());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on today’s month when the field is empty, with focus on a day', () => {
    render(<Harness />);
    open();
    expect(caption()).toBe('November 2026');
    expect(document.activeElement).toBe(day('Nov 17, 2026'));
    expect(day('Nov 17, 2026').getAttribute('aria-current')).toBe('date');
  });

  it.each([
    ['1903', 'January 1903'],
    ['1903-06', 'June 1903'],
    ['1903-06-15', 'June 1903'],
  ])('opens on the year or month the field holds, not on today: %s', (text, shown) => {
    render(<Harness start={text} />);
    open();
    expect(caption()).toBe(shown);
  });

  it('marks the day the field holds, and no day for a year or a month alone', () => {
    const first = render(<Harness start="1903-06-15" />);
    open();
    expect(day('Jun 15, 1903').closest('td')!.getAttribute('aria-selected')).toBe('true');
    expect(within(picker()).getAllByRole('gridcell', { selected: true })).toHaveLength(1);
    first.unmount();
    render(<Harness start="1903-06" />);
    open();
    expect(within(picker()).queryAllByRole('gridcell', { selected: true })).toHaveLength(0);
    expect(within(picker()).getByRole('button', { name: 'Use Jun 1903' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('opens on today when what is typed is not yet a date', () => {
    render(<Harness start="19" />);
    open();
    expect(caption()).toBe('November 2026');
  });
});

describe('picking', () => {
  it('fills the field with the whole date, closes, and keeps the precision', () => {
    render(<Harness start="1903-06" />);
    fireEvent.change(screen.getByLabelText('How sure: Birth date'), { target: { value: 'about' } });
    open();
    fireEvent.click(day('Jun 15, 1903'));
    expect(input().value).toBe('1903-06-15');
    expect(latest).toEqual({ text: '1903-06-15', precision: 'about' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(toggle());
    expect(screen.getByText('Reads as: about Jun 15, 1903')).toBeTruthy();
  });

  it('reads and fills in the account’s date format: the labels and the preview follow it, the text stays YYYY-MM-DD', () => {
    setDisplay({ ...DEFAULT_DISPLAY, dateFormat: 'dmy' });
    render(<Harness start="1903-06" />);
    open();
    expect(day('15 Jun, 1903')).toBeTruthy();
    expect(within(picker()).getByRole('button', { name: 'Use Jun 1903' })).toBeTruthy();
    fireEvent.click(day('15 Jun, 1903'));
    expect(input().value).toBe('1903-06-15');
    expect(screen.getByText('Reads as: 15 Jun, 1903')).toBeTruthy();
    cleanup();

    setDisplay({ ...DEFAULT_DISPLAY, dateFormat: 'long' });
    render(<Harness start="1903-06" />);
    open();
    expect(within(picker()).getByRole('button', { name: 'Use June 1903' })).toBeTruthy();
    cleanup();

    setDisplay({ ...DEFAULT_DISPLAY, dateFormat: 'eu' });
    render(<Harness start="1903-06" />);
    open();
    expect(day('15/06/1903')).toBeTruthy();
    expect(within(picker()).getByRole('button', { name: 'Use 06/1903' })).toBeTruthy();
  });

  it('gets to 1903 from today in a few steps: type the year, then choose the month', () => {
    render(<Harness />);
    open();
    fireEvent.change(within(picker()).getByLabelText('Year'), { target: { value: '1903' } });
    expect(caption()).toBe('November 1903');
    fireEvent.change(within(picker()).getByLabelText('Month'), { target: { value: '3' } });
    expect(caption()).toBe('March 1903');
    fireEvent.click(day('Mar 8, 1903'));
    expect(input().value).toBe('1903-03-08');
  });

  it('does not jump while a year is half typed, and goes there on Enter or when leaving the box', () => {
    render(<Harness />);
    open();
    const year = within(picker()).getByLabelText('Year') as HTMLInputElement;
    fireEvent.change(year, { target: { value: '19' } });
    expect(year.value).toBe('19');
    expect(caption()).toBe('November 2026');
    fireEvent.keyDown(year, { key: 'Enter' });
    expect(caption()).toBe('November 19');
    fireEvent.change(year, { target: { value: '1850' } });
    expect(caption()).toBe('November 1850');
    fireEvent.change(year, { target: { value: '185' } });
    fireEvent.blur(year);
    expect(caption()).toBe('November 185');
    // nonsense returns to the year on view
    fireEvent.change(year, { target: { value: '0' } });
    fireEvent.blur(year);
    expect(year.value).toBe('185');
  });

  it('steps by month with the arrows', () => {
    render(<Harness start="1903-01" />);
    open();
    fireEvent.click(within(picker()).getByRole('button', { name: 'Previous month' }));
    expect(caption()).toBe('December 1902');
    fireEvent.click(within(picker()).getByRole('button', { name: 'Next month' }));
    fireEvent.click(within(picker()).getByRole('button', { name: 'Next month' }));
    expect(caption()).toBe('February 1903');
  });

  it('shows 28 days for February 1903 and 29 for February 1904', () => {
    render(<Harness start="1903-02" />);
    open();
    expect(
      within(picker())
        .getAllByRole('gridcell', { hidden: false })
        .filter((c) => c.querySelector('button')),
    ).toHaveLength(28);
    fireEvent.change(within(picker()).getByLabelText('Year'), { target: { value: '1904' } });
    expect(day('Feb 29, 1904')).toBeTruthy();
  });
});

describe('partial dates', () => {
  it('can use just the year, or the month and year', () => {
    render(<Harness start="1903-06-15" />);
    open();
    fireEvent.click(within(picker()).getByRole('button', { name: 'Use the year 1903' }));
    expect(input().value).toBe('1903');
    expect(latest.text).toBe('1903');
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    expect(within(picker()).getByRole('button', { name: 'Use the year 1903' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.change(within(picker()).getByLabelText('Month'), { target: { value: '3' } });
    fireEvent.click(within(picker()).getByRole('button', { name: 'Use Mar 1903' }));
    expect(input().value).toBe('1903-03');
    expect(screen.getByText('Reads as: Mar 1903')).toBeTruthy();
  });

  it('keeps the year as the year when the year is changed on view, and pads small years to four digits', () => {
    render(<Harness />);
    open();
    fireEvent.change(within(picker()).getByLabelText('Year'), { target: { value: '0987' } });
    fireEvent.click(within(picker()).getByRole('button', { name: 'Use the year 987' }));
    expect(input().value).toBe('0987');
  });
});

describe('the keyboard', () => {
  const press = (key: string, shiftKey = false) => fireEvent.keyDown(document.activeElement!, { key, shiftKey });

  it('moves a day, a week, to the ends of the week, a month and a year, keeping focus on the day', () => {
    render(<Harness start="1903-06-15" />); // a Monday
    open();
    expect(document.activeElement).toBe(day('Jun 15, 1903'));
    press('ArrowRight');
    expect(document.activeElement).toBe(day('Jun 16, 1903'));
    press('ArrowLeft');
    press('ArrowDown');
    expect(document.activeElement).toBe(day('Jun 22, 1903'));
    press('ArrowUp');
    press('Home');
    expect(document.activeElement).toBe(day('Jun 14, 1903')); // the Sunday
    press('End');
    expect(document.activeElement).toBe(day('Jun 20, 1903')); // the Saturday
    press('PageDown');
    expect(caption()).toBe('July 1903');
    expect(document.activeElement).toBe(day('Jul 20, 1903'));
    press('PageUp');
    press('PageUp');
    expect(caption()).toBe('May 1903');
    press('PageDown', true);
    expect(caption()).toBe('May 1904');
    press('PageUp', true);
    expect(caption()).toBe('May 1903');
  });

  it('crosses a month and a year with the arrows', () => {
    render(<Harness start="1903-12-31" />);
    open();
    press('ArrowRight');
    expect(caption()).toBe('January 1904');
    expect(document.activeElement).toBe(day('Jan 1, 1904'));
    press('ArrowLeft');
    expect(caption()).toBe('December 1903');
    expect(document.activeElement).toBe(day('Dec 31, 1903'));
  });

  it('has one tab stop in the grid (the day on focus), so Tab moves on to the buttons', () => {
    render(<Harness start="1903-06-15" />);
    open();
    const stops = within(picker())
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('data-day') && b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(day('Jun 15, 1903'));
  });

  it('closes on Escape and gives focus back to the button', () => {
    render(<Harness />);
    open();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it('closes on Escape without closing the dialog around the form', () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Edit details" onClose={onClose}>
        <Harness />
      </Dialog>,
    );
    open();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Calendar for Birth date' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); // now the dialog's own
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has a Close button that gives focus back too', () => {
    render(<Harness />);
    open();
    fireEvent.click(within(picker()).getByRole('button', { name: 'Close calendar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it('closes when a click or focus lands elsewhere, without taking focus back', async () => {
    render(
      <>
        <Harness />
        <button type="button">Elsewhere</button>
      </>,
    );
    open();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  });
});

describe('what it does not do', () => {
  it('never changes what was typed until a day, month or year is chosen', () => {
    render(<Harness start="1903-06" />);
    open();
    fireEvent.change(within(picker()).getByLabelText('Year'), { target: { value: '1850' } });
    fireEvent.click(within(picker()).getByRole('button', { name: 'Next month' }));
    expect(input().value).toBe('1903-06');
  });
});
