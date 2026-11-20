// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewSwitcher } from '../src/tree/ViewSwitcher.js';
import type { TreeViewName } from '../src/tree/treeView.js';

afterEach(cleanup);

const ALL: TreeViewName[] = ['family', 'pedigree', 'fan', 'descendants'];

function setup(view: TreeViewName = 'family', gen = 0) {
  const onView = vi.fn();
  const onGen = vi.fn();
  render(
    <div>
      <ViewSwitcher view={view} gen={gen} views={ALL} onView={onView} onGen={onGen} />
      <button type="button">elsewhere</button>
    </div>,
  );
  return { onView, onGen, trigger: screen.getByRole('button', { name: /^Chart view:/ }) };
}

describe('the view switcher', () => {
  it('is one icon button named for the current view, closed at first', () => {
    const { trigger } = setup('pedigree', 4);
    expect(trigger.getAttribute('aria-label')).toBe('Chart view: Pedigree');
    expect(trigger.getAttribute('title')).toBe('Chart view: Pedigree');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toBe('');
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
  });

  it('opens a panel of icons only, with the names in labels and tooltips and the current view pressed', () => {
    const { trigger } = setup('fan', 4);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const views = within(screen.getByRole('group', { name: 'View' }));
    for (const name of ['Family tree', 'Pedigree', 'Fan', 'Descendants']) {
      const button = views.getByRole('button', { name });
      expect(button.getAttribute('title')).toBe(name);
      expect(button.textContent).toBe('');
    }
    expect(views.getByRole('button', { name: 'Fan' }).getAttribute('aria-pressed')).toBe('true');
    expect(views.getByRole('button', { name: 'Pedigree' }).getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(views.getByRole('button', { name: 'Fan' }));
  });

  it('offers 3, 4 and 5 generations for Pedigree and Fan and 2 to 5 for Descendants, and none for the Family tree', () => {
    const numbers = () =>
      within(screen.getByRole('group', { name: 'Generations' }))
        .getAllByRole('button')
        .map((b) => b.textContent);
    setup('pedigree', 4);
    fireEvent.click(screen.getByRole('button', { name: /^Chart view:/ }));
    expect(numbers()).toEqual(['3', '4', '5']);
    expect(screen.getByRole('button', { name: '4 generations' }).getAttribute('aria-pressed')).toBe('true');
    cleanup();
    setup('descendants', 5);
    fireEvent.click(screen.getByRole('button', { name: /^Chart view:/ }));
    expect(numbers()).toEqual(['2', '3', '4', '5']);
    cleanup();
    setup('family');
    fireEvent.click(screen.getByRole('button', { name: /^Chart view:/ }));
    expect(screen.queryByRole('group', { name: 'Generations' })).toBeNull();
  });

  it('closes when a view is chosen, and gives focus back to the button', () => {
    const { trigger, onView } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Descendants' }));
    expect(onView).toHaveBeenCalledWith('descendants');
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('stays open when the generations are changed, so the choices can be compared', () => {
    const { trigger, onGen } = setup('pedigree', 4);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '5 generations' }));
    expect(onGen).toHaveBeenCalledWith(5);
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy();
  });

  it('closes on Esc (focus back on the button) and on a press or focus outside', () => {
    const { trigger } = setup('pedigree', 4);
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Fan' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
    fireEvent.click(trigger);
    act(() => screen.getByRole('button', { name: 'elsewhere' }).focus());
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
  });

  it('has one tab stop in each group (the pressed button) and moves with the arrow keys', () => {
    const { trigger } = setup('pedigree', 4);
    fireEvent.click(trigger);
    const views = within(screen.getByRole('group', { name: 'View' })).getAllByRole('button');
    expect(views.map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1]);
    const pedigree = views[1]!;
    pedigree.focus();
    fireEvent.keyDown(pedigree, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(views[2]);
    fireEvent.keyDown(views[2]!, { key: 'End' });
    expect(document.activeElement).toBe(views[3]);
    fireEvent.keyDown(views[3]!, { key: 'ArrowRight' }); // wraps
    expect(document.activeElement).toBe(views[0]);
    fireEvent.keyDown(views[0]!, { key: 'ArrowLeft' }); // wraps back
    expect(document.activeElement).toBe(views[3]);
  });
});
