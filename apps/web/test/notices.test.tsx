// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Messages: a success is a small pill that goes away by itself after 5 seconds (paused while the pointer or focus is on
// it); a warning is a bar that stays until it is dismissed. The live region is always there, and nothing takes focus.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoticeList, NoticeProvider, SUCCESS_MS, useNotices } from '../src/notices.js';

function Buttons() {
  const { notify } = useNotices();
  return (
    <>
      <button onClick={() => notify('success', 'Tess Hale was added to the tree.')}>ok</button>
      <button onClick={() => notify('warning', 'A parent is very young.')}>warn</button>
    </>
  );
}
const setup = () =>
  render(
    <NoticeProvider>
      <NoticeList />
      <Buttons />
    </NoticeProvider>,
  );

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('notices', () => {
  it('keeps the live region mounted, polite, and empty at first', () => {
    setup();
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
  });

  it('a success is a pill with no button, never takes focus, and is gone after 5 seconds', () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'ok' });
    trigger.focus();
    fireEvent.click(trigger);
    const pill = screen.getByTestId('notice-pill');
    expect(pill.textContent).toBe('Tess Hale was added to the tree.');
    expect(pill.querySelector('button')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    act(() => void vi.advanceTimersByTime(SUCCESS_MS - 500));
    expect(screen.getByTestId('notice-pill').classList.contains('fading')).toBe(false);
    act(() => void vi.advanceTimersByTime(150));
    expect(screen.getByTestId('notice-pill').classList.contains('fading')).toBe(true);
    act(() => void vi.advanceTimersByTime(400));
    expect(screen.queryByTestId('notice-pill')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('waits while the pointer is on it and starts again when it leaves', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    const pill = screen.getByTestId('notice-pill');
    fireEvent.mouseEnter(pill);
    act(() => void vi.advanceTimersByTime(SUCCESS_MS * 3));
    expect(screen.getByTestId('notice-pill')).toBeTruthy();
    fireEvent.mouseLeave(screen.getByTestId('notice-pill'));
    act(() => void vi.advanceTimersByTime(SUCCESS_MS));
    expect(screen.queryByTestId('notice-pill')).toBeNull();
  });

  it('a warning stays as a bar with a Dismiss button until it is dismissed', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'warn' }));
    act(() => void vi.advanceTimersByTime(SUCCESS_MS * 4));
    expect(screen.getByText('A parent is very young.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('A parent is very young.')).toBeNull();
  });

  it('clears its timers when it goes away', () => {
    const { unmount } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
