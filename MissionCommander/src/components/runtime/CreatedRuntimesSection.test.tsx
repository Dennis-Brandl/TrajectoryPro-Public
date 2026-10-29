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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '@/lib/api/runtime-workflows';
import type { CreatedRuntimeRow, CreatedRuntimesPage } from '@/lib/api/types';
import { CreatedRuntimesList, LiveCreatedRuntimes } from './CreatedRuntimesSection';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const live: CreatedRuntimeRow = {
  runtimeLabel: 'RW-7', workCenterPath: 'Plant/Line 1', workflowName: 'Mix', workflowVersion: '1.2.0',
  workflowState: 'Effective', createdAt: '2026-10-01T10:00:00.000Z', state: 'paused',
  open: { kind: 'live', id: 'c1' },
};
const hist: CreatedRuntimeRow = { ...live, runtimeLabel: 'RW-3', state: 'completed', open: { kind: 'history', id: 'h1' } };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('CreatedRuntimesList', () => {
  it('renders nothing when the runtime created none', () => {
    render(<CreatedRuntimesList page={{ items: [], total: 0 }} onOpen={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Created runtimes' })).toBeNull();
  });

  it('shows work center, workflow, created time, Runtime ID and state, and opens on click', async () => {
    const onOpen = vi.fn();
    render(<CreatedRuntimesList page={{ items: [live, hist], total: 2 }} onOpen={onOpen} />);
    const btn = screen.getByRole('button', { name: 'Open RW-7' });
    for (const t of ['Plant/Line 1', 'Mix', 'v1.2.0', 'Paused']) expect(btn.textContent).toContain(t);
    expect(btn.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-01T10:00:00.000Z');
    await userEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith({ kind: 'live', id: 'c1' });
    await userEvent.click(screen.getByRole('button', { name: 'Open RW-3' }));
    expect(onOpen).toHaveBeenCalledWith({ kind: 'history', id: 'h1' });
  });

  it('a row the viewer may not see shows only its Runtime ID and is not clickable', () => {
    const hidden: CreatedRuntimeRow = {
      runtimeLabel: 'RW-9', workCenterPath: null, workflowName: null, workflowVersion: null,
      workflowState: null, createdAt: null, state: null, open: null,
    };
    render(<CreatedRuntimesList page={{ items: [hidden], total: 1 }} onOpen={vi.fn()} />);
    expect(screen.getByText('RW-9')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open RW-9' })).toBeNull();
  });

  it('says how many are shown when capped', () => {
    render(<CreatedRuntimesList page={{ items: [live, hist], total: 5 }} onOpen={vi.fn()} />);
    expect(screen.getByText('Showing 2 of 5')).toBeTruthy();
  });
});

describe('LiveCreatedRuntimes', () => {
  it('fetches by the instance id', async () => {
    const page: CreatedRuntimesPage = { items: [live], total: 1 };
    const spy = vi.spyOn(api.runtimeWorkflows, 'children').mockResolvedValue(page);
    render(<LiveCreatedRuntimes instanceId="p1" onOpen={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Open RW-7' })).toBeTruthy();
    expect(spy).toHaveBeenCalledWith('p1');
  });
});
