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
import type { RuntimeHistoryDetail, RuntimeHistorySummary } from '@/lib/api/types';
import { HistoryTab } from './HistoryTab';

vi.mock('@/lib/api/runtime-history', () => ({
  runtimeHistory: { listForWorkCenter: vi.fn(), detail: vi.fn(), remove: vi.fn() },
}));

vi.mock('@/lib/api/runtime-workflows', () => ({
  runtimeWorkflows: { children: () => Promise.resolve({ items: [], total: 0 }) },
}));
// ONE hook, in an EXPLICIT order — never two separate afterEach registrations. Vitest's default
// `sequence.hooks: 'stack'` runs afterEach hooks in REVERSE registration order, so a separate
// `afterEach(cleanup); afterEach(() => vi.restoreAllMocks());` pair would run restore FIRST and
// leave a window in which this file's still-MOUNTED tree faced module mocks that
// vi.restoreAllMocks() had already reset to bare vi.fn()s returning `undefined` — cleanup()'s own
// act() flushes any passive effect still pending for an already-committed tree, so a mount landing
// in that window would crash on `undefined.then` (see RuntimeTab.test.tsx). cleanup() first means
// every flush it triggers still sees live mocks.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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

describe('HistoryTab', () => {
  it('fetches for the given work center on mount and renders the table', async () => {
    const listSpy = vi.mocked(runtimeHistory.listForWorkCenter).mockResolvedValue({
      history: [ROW], total: 1, page: 1, pageSize: 50,
    });
    render(<HistoryTab workCenterId="w1" />);
    expect(await screen.findByText('RW-7')).toBeInTheDocument();
    expect(listSpy).toHaveBeenLastCalledWith('w1', { page: 1 });
  });

  it('clicking a state chip refetches with the new filter and page reset to 1', async () => {
    const listSpy = vi.mocked(runtimeHistory.listForWorkCenter).mockResolvedValue({
      history: [ROW], total: 1, page: 1, pageSize: 50,
    });
    render(<HistoryTab workCenterId="w1" />);
    await screen.findByText('RW-7');
    await userEvent.click(screen.getByRole('button', { name: 'Completed' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { page: 1, state: 'completed' }));
  });

  it('paginates with Prev/Next and shows "Page X of Y"', async () => {
    const listSpy = vi.mocked(runtimeHistory.listForWorkCenter).mockImplementation(async (_wc, params) => ({
      history: [ROW], total: 120, page: params?.page ?? 1, pageSize: 50,
    }));
    render(<HistoryTab workCenterId="w1" />);
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument(); // ceil(120 / 50)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { page: 2 }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Prev' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { page: 1 }));
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('pagination label tracks the clicked page (local single source) even when the response reports a stale page', async () => {
    const listSpy = vi.mocked(runtimeHistory.listForWorkCenter).mockImplementation(async (_wc, params) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { history: [ROW], total: 120, page: Math.max(1, (params?.page ?? 1) - 1), pageSize: 50 };
    });
    render(<HistoryTab workCenterId="w1" />);
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { page: 2 }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('Refresh with unchanged filters still triggers a new fetch (same composite key, explicit refresh)', async () => {
    const listSpy = vi.mocked(runtimeHistory.listForWorkCenter).mockResolvedValue({
      history: [ROW], total: 1, page: 1, pageSize: 50,
    });
    render(<HistoryTab workCenterId="w1" />);
    await screen.findByText('RW-7');
    expect(listSpy).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    expect(listSpy).toHaveBeenLastCalledWith('w1', { page: 1 });
  });

  it('snaps back to page 1 and re-fetches when the current page comes back empty (final review Finding 2)', async () => {
    // Page 1 starts with more rows than fit on one page (so Next is reachable); by the time
    // page 2 is requested its last row is gone (e.g. deleted or purged elsewhere), so the
    // server reports an empty page whose `total` has already collapsed to fit on page 1.
    const listSpy = vi.mocked(runtimeHistory.listForWorkCenter).mockImplementation(async (_wc, params) => {
      const page = params?.page ?? 1;
      if (page === 1) return { history: [ROW], total: 51, page: 1, pageSize: 50 };
      return { history: [], total: 1, page, pageSize: 50 };
    });
    render(<HistoryTab workCenterId="w1" />);
    await screen.findByText('RW-7');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    // The page:2 request and its empty-triggered snap-back can both settle before the first
    // `waitFor` poll runs, so assert page:2 was requested at ANY point (not necessarily last)
    // before converging on the final steady state of page:1.
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('w1', { page: 2 }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { page: 1 }));
    expect(await screen.findByText('RW-7')).toBeInTheDocument();
  });

  it('clicking a history row opens the HistoryDetailDialog for that row (Task 7)', async () => {
    vi.mocked(runtimeHistory.listForWorkCenter).mockResolvedValue({
      history: [ROW], total: 1, page: 1, pageSize: 50,
    });
    const detail: RuntimeHistoryDetail = {
      ...ROW, startingParams: null, trace: [], properties: null, stepParams: null, stepNames: null, signatures: [], stepRuns: [], startedByLoginName: null, startedByUserId: null, userNames: {},
      createdByLabel: null, createdByInstanceId: null, outputs: null,
    };
    vi.mocked(runtimeHistory.detail).mockResolvedValue(detail);
    render(<HistoryTab workCenterId="w1" />);
    const row = await screen.findByRole('button', { name: 'History RW-7' });
    await userEvent.click(row);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(runtimeHistory.detail).toHaveBeenCalledWith('h1');
  });

  // p7 sweep ticket 5 (useKeyedView): the old useResourceView-composite-key wiring nulled the
  // view on every key change, flashing to "Loading…" and unmounting the filter bar/table on
  // every page or filter commit. useKeyedView keeps the stale view mounted until the new fetch
  // settles — pin that directly: page 1's row must still be on screen (no Loading flash) while
  // page 2's request is still in flight.
  it('keeps the previous rows visible while a page commit is in flight (no Loading flash)', async () => {
    const pending = deferred<{ history: RuntimeHistorySummary[]; total: number; page: number; pageSize: number }>();
    vi.mocked(runtimeHistory.listForWorkCenter)
      .mockResolvedValueOnce({ history: [ROW], total: 120, page: 1, pageSize: 50 })
      .mockReturnValueOnce(pending.promise);
    render(<HistoryTab workCenterId="w1" />);
    expect(await screen.findByText('RW-7')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    // page:2's fetch is still in flight — page 1's row must stay mounted, no blank/spinner.
    expect(screen.getByText('RW-7')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();

    await act(async () => { pending.resolve({ history: [ROW_PAGE2], total: 120, page: 2, pageSize: 50 }); });
    expect(await screen.findByText('RW-8')).toBeInTheDocument();
  });

  // p7 sweep ticket 5: the whole point of not unmounting the filter bar on a commit is that a
  // text input inside it keeps focus — pin that structurally rather than just trusting "no
  // unmount" by inference.
  it('the search filter input keeps focus across a commit', async () => {
    const listSpy = vi.mocked(runtimeHistory.listForWorkCenter).mockResolvedValue({
      history: [ROW], total: 1, page: 1, pageSize: 50,
    });
    render(<HistoryTab workCenterId="w1" />);
    await screen.findByText('RW-7');

    const search = screen.getByLabelText('Search');
    await userEvent.click(search);
    await userEvent.type(search, 'bottle{Enter}');

    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith('w1', { page: 1, search: 'bottle' }));
    expect(search).toHaveFocus();
  });

  // p7 sweep ticket 4c: a failed FIRST load (no stale view to fall back on) surfaces a Retry
  // control instead of leaving the operator stuck on a dead-end error message.
  it('a failed first load shows a Retry button that re-fetches on click', async () => {
    const listSpy = vi.mocked(runtimeHistory.listForWorkCenter)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ history: [ROW], total: 1, page: 1, pageSize: 50 });
    render(<HistoryTab workCenterId="w1" />);

    const retry = await screen.findByRole('button', { name: 'Retry' });
    await userEvent.click(retry);

    expect(await screen.findByText('RW-7')).toBeInTheDocument();
    expect(listSpy).toHaveBeenCalledTimes(2);
  });
});
