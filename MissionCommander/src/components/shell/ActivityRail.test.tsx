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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityRail } from './ActivityRail';
import { useSelectionStore } from '@/stores/selectionStore';

beforeEach(() => {
  useSelectionStore.setState({ activeHierarchy: 'work_center' });
});
afterEach(cleanup);

describe('ActivityRail', () => {
  it('shows exactly the eight surviving hierarchies', () => {
    render(<ActivityRail />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Work Centers', 'Runtime', 'Users', 'Workflows', 'Environments', 'Roles', 'History', 'Settings']);
  });

  // Help (2026-09-14): the user guide opens in its own tab, as Mission Designer's toolbar link does.
  it('links to the help guide in a new tab', () => {
    render(<ActivityRail />);
    const help = screen.getByRole('link', { name: 'Help' });
    expect(help).toHaveAttribute('href', '/help.html');
    expect(help).toHaveAttribute('target', '_blank');
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('offers no Libraries entry', () => {
    render(<ActivityRail />);
    expect(screen.queryByLabelText(/librar/i)).toBeNull();
  });

  it('switches the active hierarchy on click', async () => {
    render(<ActivityRail />);
    await userEvent.click(screen.getByLabelText('Workflows'));
    expect(useSelectionStore.getState().activeHierarchy).toBe('workflow');
  });

  // Runtime pane (spec 2026-08-27): store-driven exactly like the other hierarchies.
  it('clicking Runtime activates the runtime hierarchy', async () => {
    render(<ActivityRail />);
    await userEvent.click(screen.getByLabelText('Runtime'));
    expect(useSelectionStore.getState().activeHierarchy).toBe('runtime');
  });

  // Task 8: History is store-driven exactly like the other five hierarchies — a plain
  // click flips activeHierarchy, which is what HierarchyPane/DetailPanel switch on to
  // actually render the page.
  it('clicking History activates the history hierarchy', async () => {
    render(<ActivityRail />);
    await userEvent.click(screen.getByLabelText('History'));
    expect(useSelectionStore.getState().activeHierarchy).toBe('history');
  });

  // action-matching-mode spec (2026-08-20): Settings is store-driven exactly like History —
  // a plain click flips activeHierarchy, which HierarchyPane/DetailPanel switch on.
  it('clicking Settings activates the settings hierarchy', async () => {
    render(<ActivityRail />);
    await userEvent.click(screen.getByLabelText('Settings'));
    expect(useSelectionStore.getState().activeHierarchy).toBe('settings');
  });
});
