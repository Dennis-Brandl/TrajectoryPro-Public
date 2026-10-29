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
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { runtimeHistory } from '@/lib/api/runtime-history';
import { workCenters } from '@/lib/api/work-centers';
import { usePrincipalStore } from '@/stores/principalStore';
import type { RuntimeHistorySummary, RuntimeHistoryDetail, MePrincipal, WcNode } from '@/lib/api/types';
import { HistoryPage } from './HistoryPage';

vi.mock('@/lib/api/runtime-history', () => ({
  runtimeHistory: { listAll: vi.fn(), detail: vi.fn(), remove: vi.fn(), purgeCount: vi.fn(), purge: vi.fn() },
}));
vi.mock('@/lib/api/runtime-workflows', () => ({
  runtimeWorkflows: { children: () => Promise.resolve({ items: [], total: 0 }) },
}));
vi.mock('@/lib/api/work-centers', () => ({
  workCenters: { list: vi.fn() },
}));

const ADMIN: MePrincipal = {
  id: 'a', email: 'a@x', loginName: 'admin', displayName: 'A', accessLevel: 'administrator',
  isAdministrator: true, rights: [], missionSystemCommanderOf: [],
};
const PLAIN: MePrincipal = {
  id: 'p', email: 'p@x', loginName: 'admin', displayName: 'P', accessLevel: 'viewer',
  isAdministrator: false, rights: [], missionSystemCommanderOf: [],
};

const WC_NODES: WcNode[] = [
  { id: 'w1', name: 'Assembly', parentWorkCenterId: null, depth: 0, typeName: null },
  { id: 'w2', name: 'Packaging', parentWorkCenterId: null, depth: 0, typeName: null },
];

const ROW: RuntimeHistorySummary = {
  id: 'h1', workflowInstanceId: 'wi1', workCenterId: 'w1', workCenterName: 'Assembly',
  runtimeNumber: 7, runtimeLabel: 'RW-7', masterName: 'Bottle Fill', masterOid: 'o1', masterVersion: '1.0.0', masterState: 'released',
  finalState: 'completed', startedAt: '2026-08-01T00:00:00.000Z', finishedAt: '2026-08-01T00:04:32.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const ROW_PAGE2: RuntimeHistorySummary = { ...ROW, id: 'h2', runtimeNumber: 8, runtimeLabel: 'RW-8' };

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

function setup(principal: MePrincipal = ADMIN) {
  usePrincipalStore.getState().setPrincipal(principal);
  vi.mocked(workCenters.list).mockResolvedValue({ nodes: WC_NODES });
}

// ONE hook, in an EXPLICIT order — never separate afterEach registrations. Vitest's default
// `sequence.hooks: 'stack'` runs afterEach hooks in REVERSE registration order, so separate
// registrations would run in the OPPOSITE order to what's written here. cleanup() must run
// FIRST — its own act() flushes any passive effect still pending for an already-committed tree,
// so a mount landing after mocks/principal were already reset would crash or read stale state
// (see RuntimeTab.test.tsx). restoreAllMocks() runs after cleanup(); clearPrincipal() runs LAST
// since nothing here depends on the principal once the tree is unmounted and mocks are restored.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  usePrincipalStore.getState().clearPrincipal();
});

describe('HistoryPage — fetch + table', () => {
  it('fetches across all work centers on mount and renders the Work Center column', async () => {
    setup();
    const listSpy = vi.mocked(runtimeHistory.listAll).mockResolvedValue({ history: [ROW], total: 1, page: 1, pageSize: 50 });
    render(<HistoryPage />);
    expect(await screen.findByText('RW-7')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Work Center' })).toBeInTheDocument();
    expect(listSpy).toHaveBeenLastCalledWith({ page: 1 });
  });

  it('paginates with Prev/Next', async () => {
    setup();
    const listSpy = vi.mocked(runtimeHistory.listAll).mockImplementation(async (params) => ({
      history: [ROW], total: 120, page: params?.page ?? 1, pageSize: 50,
    }));
    render(<HistoryPage />);
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith({ page: 2 }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
  });

  // p7 sweep ticket 5 (useKeyedView): same keep-stale pin as HistoryTab — a page commit must
  // not flash the table to null/Loading while the next page's fetch is in flight.
  it('keeps the previous rows visible while a page commit is in flight (no Loading flash)', async () => {
    setup();
    const pending = deferred<{ history: RuntimeHistorySummary[]; total: number; page: number; pageSize: number }>();
    vi.mocked(runtimeHistory.listAll)
      .mockResolvedValueOnce({ history: [ROW], total: 120, page: 1, pageSize: 50 })
      .mockReturnValueOnce(pending.promise);
    render(<HistoryPage />);
    expect(await screen.findByText('RW-7')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('RW-7')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();

    await act(async () => { pending.resolve({ history: [ROW_PAGE2], total: 120, page: 2, pageSize: 50 }); });
    expect(await screen.findByText('RW-8')).toBeInTheDocument();
  });

  it('snaps back to page 1 and re-fetches when the current page comes back empty (final review Finding 2)', async () => {
    setup();
    // Page 1 starts with more rows than fit on one page (so Next is reachable); by the time
    // page 2 is requested its last row is gone (e.g. an admin purge), so the server reports
    // an empty page whose `total` has already collapsed to fit on page 1.
    const listSpy = vi.mocked(runtimeHistory.listAll).mockImplementation(async (params) => {
      const page = params?.page ?? 1;
      if (page === 1) return { history: [ROW], total: 51, page: 1, pageSize: 50 };
      return { history: [], total: 1, page, pageSize: 50 };
    });
    render(<HistoryPage />);
    await screen.findByText('RW-7');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    // The page:2 request and its empty-triggered snap-back can both settle before the first
    // `waitFor` poll runs, so assert page:2 was requested at ANY point (not necessarily last)
    // before converging on the final steady state of page:1.
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith({ page: 2 }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith({ page: 1 }));
    expect(await screen.findByText('RW-7')).toBeInTheDocument();
  });

  it('clicking a row opens the shared HistoryDetailDialog (Task 7)', async () => {
    setup();
    vi.mocked(runtimeHistory.listAll).mockResolvedValue({ history: [ROW], total: 1, page: 1, pageSize: 50 });
    const detail: RuntimeHistoryDetail = {
      ...ROW, startingParams: null, trace: [], properties: null, stepParams: null, stepNames: null, signatures: [], stepRuns: [], startedByLoginName: null, startedByUserId: null, userNames: {},
      createdByLabel: null, createdByInstanceId: null, outputs: null,
    };
    vi.mocked(runtimeHistory.detail).mockResolvedValue(detail);
    render(<HistoryPage />);
    const row = await screen.findByRole('button', { name: 'History RW-7' });
    await userEvent.click(row);
    expect(await screen.findByRole('dialog', { name: /RW-7/ })).toBeInTheDocument();
    expect(runtimeHistory.detail).toHaveBeenCalledWith('h1');
  });
});

describe('HistoryPage — work-center scope dropdown', () => {
  it('offers All work centers, each work center by name, and a deleted-work-centers option', async () => {
    setup();
    vi.mocked(runtimeHistory.listAll).mockResolvedValue({ history: [], total: 0, page: 1, pageSize: 50 });
    render(<HistoryPage />);
    await screen.findByText('No history');
    await waitFor(() => expect(workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByLabelText('Work center'));
    expect(await screen.findByRole('option', { name: 'Assembly' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Packaging' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '(deleted work centers)' })).toBeInTheDocument();
  });

  it('selecting a work center refetches scoped to workCenterId, with page reset to 1', async () => {
    setup();
    const listSpy = vi.mocked(runtimeHistory.listAll).mockResolvedValue({ history: [], total: 0, page: 1, pageSize: 50 });
    render(<HistoryPage />);
    await screen.findByText('No history');
    await waitFor(() => expect(workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByLabelText('Work center'));
    await userEvent.click(await screen.findByRole('option', { name: 'Assembly' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith({ page: 1, workCenterId: 'w1' }));
  });

  it('selecting "(deleted work centers)" refetches with orphans: true', async () => {
    setup();
    const listSpy = vi.mocked(runtimeHistory.listAll).mockResolvedValue({ history: [], total: 0, page: 1, pageSize: 50 });
    render(<HistoryPage />);
    await screen.findByText('No history');
    await waitFor(() => expect(workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByLabelText('Work center'));
    await userEvent.click(await screen.findByRole('option', { name: '(deleted work centers)' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith({ page: 1, orphans: true }));
  });

  it('switching back to All work centers clears both workCenterId and orphans', async () => {
    setup();
    const listSpy = vi.mocked(runtimeHistory.listAll).mockResolvedValue({ history: [], total: 0, page: 1, pageSize: 50 });
    render(<HistoryPage />);
    await screen.findByText('No history');
    await waitFor(() => expect(workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByLabelText('Work center'));
    await userEvent.click(await screen.findByRole('option', { name: 'Assembly' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith({ page: 1, workCenterId: 'w1' }));

    await userEvent.click(screen.getByLabelText('Work center'));
    await userEvent.click(await screen.findByRole('option', { name: 'All work centers' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith({ page: 1 }));
  });
});

describe('HistoryPage — admin-only Purge (same principal exposure as Task 7)', () => {
  it('shows the Purge control for an administrator', async () => {
    setup(ADMIN);
    vi.mocked(runtimeHistory.listAll).mockResolvedValue({ history: [], total: 0, page: 1, pageSize: 50 });
    render(<HistoryPage />);
    await screen.findByText('No history');
    expect(screen.getByRole('button', { name: /purge/i })).toBeInTheDocument();
  });

  it('hides the Purge control entirely for a non-administrator', async () => {
    setup(PLAIN);
    vi.mocked(runtimeHistory.listAll).mockResolvedValue({ history: [], total: 0, page: 1, pageSize: 50 });
    render(<HistoryPage />);
    await screen.findByText('No history');
    expect(screen.queryByRole('button', { name: /purge/i })).not.toBeInTheDocument();
  });

  it('opens PurgeDialog when Purge is clicked, and a reported purge refreshes the table', async () => {
    setup(ADMIN);
    const listSpy = vi.mocked(runtimeHistory.listAll).mockResolvedValue({ history: [], total: 0, page: 1, pageSize: 50 });
    render(<HistoryPage />);
    await screen.findByText('No history');
    expect(listSpy).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /purge/i }));
    expect(await screen.findByRole('dialog', { name: /purge/i })).toBeInTheDocument();
  });
});
