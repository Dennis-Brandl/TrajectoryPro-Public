// @vitest-environment jsdom
// Copyright 2026 Dennis L. Brandl
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from './AppShell';
import { useSelectionStore } from '@/stores/selectionStore';

// This config does not enable Vitest globals, so @testing-library/react cannot
// auto-register its afterEach(cleanup). Without this, each render() leaks its DOM
// into document.body and later getByRole calls match duplicates.
beforeEach(() => { localStorage.clear(); useSelectionStore.setState({ activeHierarchy: 'work_center' }); });
afterEach(cleanup);

describe('AppShell', () => {
  it('renders the activity rail with all five hierarchies enabled', () => {
    render(<AppShell />);
    expect(screen.getByRole('button', { name: /work centers/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /users/i })).toBeEnabled();
    // Workflows was disabled ("coming later") until M3 turned it on.
    expect(screen.getByRole('button', { name: /workflows/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /environments/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /roles/i })).toBeEnabled();
    // M6 retired Libraries: a work center already IS the execution set.
    expect(screen.queryByRole('button', { name: /libraries/i })).toBeNull();
  });

  it('hides the tree pane when the active rail item is clicked, and shows it on the next click', async () => {
    render(<AppShell />);
    const pane = screen.getByTestId('side-pane');
    expect(screen.getByTestId('side-pane-wrap')).not.toHaveClass('hidden');
    await userEvent.click(screen.getByRole('button', { name: 'Work Centers' }));
    // Hidden with CSS, so the same element (and its expanded tree state) stays mounted.
    expect(screen.getByTestId('side-pane-wrap')).toHaveClass('hidden');
    expect(screen.getByTestId('side-pane')).toBe(pane);
    await userEvent.click(screen.getByRole('button', { name: 'Work Centers' }));
    expect(screen.getByTestId('side-pane-wrap')).not.toHaveClass('hidden');
    expect(screen.getByTestId('side-pane')).toBe(pane);
  });

  it('shows the pane again when another hierarchy is chosen while it is hidden', async () => {
    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: 'Work Centers' }));
    await userEvent.click(screen.getByRole('button', { name: 'Users' }));
    expect(screen.getByTestId('side-pane-wrap')).not.toHaveClass('hidden');
  });

  it('renders no tree pane on history or settings', () => {
    for (const h of ['history', 'settings'] as const) {
      useSelectionStore.setState({ activeHierarchy: h });
      const { unmount } = render(<AppShell />);
      expect(screen.queryByTestId('side-pane')).toBeNull();
      unmount();
    }
  });

  it('forgets a hidden pane after a visit to a full-width page', async () => {
    render(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: 'Work Centers' }));
    expect(screen.getByTestId('side-pane-wrap')).toHaveClass('hidden');
    act(() => { useSelectionStore.getState().setHierarchy('settings'); });
    act(() => { useSelectionStore.getState().setHierarchy('work_center'); });
    expect(screen.getByTestId('side-pane-wrap')).not.toHaveClass('hidden');
  });
});
