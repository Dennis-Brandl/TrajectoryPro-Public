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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityRail } from './ActivityRail';
import { useSelectionStore } from '@/stores/selectionStore';

beforeEach(() => {
  useSelectionStore.setState({ activeHierarchy: 'work_center' });
});
afterEach(cleanup);

describe('ActivityRail', () => {
  it('shows exactly seven hierarchies and no Settings or Help', () => {
    render(<ActivityRail />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Work Centers', 'Runtime', 'Users', 'Workflows', 'Environments', 'Roles', 'History']);
    expect(screen.queryByLabelText('Settings')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Help' })).toBeNull();
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

  it('clicking Runtime activates the runtime hierarchy', async () => {
    render(<ActivityRail />);
    await userEvent.click(screen.getByLabelText('Runtime'));
    expect(useSelectionStore.getState().activeHierarchy).toBe('runtime');
  });

  it('clicking History activates the history hierarchy', async () => {
    render(<ActivityRail />);
    await userEvent.click(screen.getByLabelText('History'));
    expect(useSelectionStore.getState().activeHierarchy).toBe('history');
  });

  it('marks the active hierarchy, and none on settings', () => {
    const { rerender } = render(<ActivityRail />);
    expect(screen.getByLabelText('Work Centers')).toHaveAttribute('aria-current', 'page');
    useSelectionStore.setState({ activeHierarchy: 'settings' });
    rerender(<ActivityRail />);
    for (const b of screen.getAllByRole('button')) expect(b).not.toHaveAttribute('aria-current');
  });

  it('reports whether a click was on the already-active item', async () => {
    const onItemClick = vi.fn();
    render(<ActivityRail onItemClick={onItemClick} />);
    await userEvent.click(screen.getByLabelText('Work Centers'));
    await userEvent.click(screen.getByLabelText('Users'));
    expect(onItemClick).toHaveBeenNthCalledWith(1, true);
    expect(onItemClick).toHaveBeenNthCalledWith(2, false);
  });
});
