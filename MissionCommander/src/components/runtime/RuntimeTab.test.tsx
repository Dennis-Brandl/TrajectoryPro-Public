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
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import type { RuntimeWorkflowMonitorSummary } from '@/lib/api/types';
import { RuntimeTab } from './RuntimeTab';

vi.mock('@/lib/api/runtime-workflows', () => ({
  runtimeWorkflows: { list: vi.fn(), presence: vi.fn(), live: vi.fn(), children: () => Promise.resolve({ items: [], total: 0 }) },
}));

const RUNNING: RuntimeWorkflowMonitorSummary = {
  id: 'rw2', workCenterId: 'w1', runtimeNumber: 2, runtimeLabel: 'RW-2',
  masterName: 'Cap Torque', masterOid: 'o2', masterVersion: '2.0.0', masterState: 'released',
  status: 'running', createdByName: null,  createdByLabel: null, createdAt: '2026-08-01T00:00:00Z',
  queuedAt: '2026-08-01T00:01:00Z', startedAt: '2026-08-01T00:02:00Z', completedAt: null,
  activeSteps: [], errorText: null,
};

// ONE hook, in an EXPLICIT order — never two separate afterEach registrations. Vitest's default
// `sequence.hooks: 'stack'` runs afterEach hooks in REVERSE registration order, so the old
// `afterEach(cleanup); afterEach(() => vi.restoreAllMocks());` pair ran restore FIRST and left a
// window in which this file's still-MOUNTED tree faced module mocks that vi.restoreAllMocks()
// had already reset to bare vi.fn()s returning `undefined`. cleanup()'s own act() flushes any
// passive effect still pending for an already-committed tree, so a usePolledView mount landing in
// that window called `fetcherRef.current()` -> undefined -> `undefined.then` -> TypeError. That
// was the p7 flake: intermittent (only when React's scheduler had yielded between the commit and
// the passive-effect flush, which is load-dependent), and it surfaced as a failure of whichever
// test had just passed. cleanup() first means every flush it triggers still sees live mocks.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('RuntimeTab', () => {
  it('renders a card per runtime workflow with an accessible RW-{n} details name', async () => {
    vi.mocked(runtimeWorkflows.presence).mockResolvedValue({ presence: [] });
    vi.mocked(runtimeWorkflows.list).mockResolvedValue({ runtimeWorkflows: [RUNNING], total: 1, page: 1, pageSize: 24 });
    render(<RuntimeTab workCenterId="w1" />);
    expect(await screen.findByRole('button', { name: 'RW-2 details' })).toBeInTheDocument();
  });

  // 2026-08-10 user-testing ticket: chips carry whole-work-center bucket counts. The other
  // tests' mocks omit statusCounts on purpose — bare labels are the documented fallback, so
  // both renderings stay pinned.
  it('renders live counts on the status chips when statusCounts is present; All never gets one', async () => {
    vi.mocked(runtimeWorkflows.presence).mockResolvedValue({ presence: [] });
    vi.mocked(runtimeWorkflows.list).mockResolvedValue({
      runtimeWorkflows: [RUNNING], total: 2, page: 1, pageSize: 24,
      statusCounts: { active: 2, pending: 4, finished: 0 },
    });
    render(<RuntimeTab workCenterId="w1" />);
    expect(await screen.findByRole('button', { name: 'Active (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waiting to start (4)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finished (0)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no runtime workflows', async () => {
    vi.mocked(runtimeWorkflows.list).mockResolvedValue({ runtimeWorkflows: [], total: 0, page: 1, pageSize: 24 });
    vi.mocked(runtimeWorkflows.presence).mockResolvedValue({ presence: [] });
    render(<RuntimeTab workCenterId="w1" />);
    expect(await screen.findByText('No runtime workflows')).toBeInTheDocument();
  });

  it('filter chips default to Active, switching chips refetches, pagination pages, and a filter change resets to page 1', async () => {
    vi.mocked(runtimeWorkflows.presence).mockResolvedValue({ presence: [] });
    // Echoes back the requested page so `view.page` (what the component renders) tracks
    // exactly what was asked for, letting this test assert both the request AND the render.
    const listSpy = vi.mocked(runtimeWorkflows.list).mockImplementation(async (_wcId, opts) => ({
      runtimeWorkflows: [RUNNING], total: 50, page: opts.page, pageSize: 24,
    }));
    render(<RuntimeTab workCenterId="w1" />);

    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { filter: 'active', page: 1 }));
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument(); // ceil(50 / 24)

    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { filter: 'all', page: 1 }));

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { filter: 'all', page: 2 }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Active' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { filter: 'active', page: 1 }));
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('pagination footer label tracks the clicked page immediately, even when the (delayed) fetch response itself reports a stale page', async () => {
    vi.mocked(runtimeWorkflows.presence).mockResolvedValue({ presence: [] });
    const listSpy = vi.mocked(runtimeWorkflows.list).mockImplementation(async (_wcId, opts) => {
      // Simulates an in-flight page change landing late: the eventual response for the NEW
      // page still carries the PREVIOUS page in its own `page` field. The footer must read the
      // same `page` state the Prev/Next buttons already use, not this field, so it tracks the
      // click immediately instead of disagreeing with its own buttons.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { runtimeWorkflows: [RUNNING], total: 50, page: Math.max(1, opts.page - 1), pageSize: 24 };
    });
    render(<RuntimeTab workCenterId="w1" />);
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { filter: 'active', page: 1 }));
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { filter: 'active', page: 2 }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
  });
});
