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
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import type { RuntimeWorkflowMonitorSummary } from '@/lib/api/types';

const { navigate, list } = vi.hoisted(() => ({ navigate: vi.fn(), list: vi.fn() }));
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/lib/api/runtime-workflows', () => ({ runtimeWorkflows: { list } }));
vi.mock('~/components/shell/WorkCenterShell', () => ({ useWorkCenter: () => ({ id: 'wc1', name: 'Alpha', mode: 'full' }) }));

import { RunningView } from './RunningView';
import { ConnectionBanner } from './ConnectionBanner';
import { ConnectionProvider, useConnection } from './connection';

let width = 1440;
const listeners = new Set<() => void>();
function setWidth(px: number) {
  width = px;
  window.matchMedia = ((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: width >= min, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

const rt = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, status, runtimeLabel: `RT-${id}`, masterName: `Flow ${id}`, masterVersion: '1.0',
  startedAt: new Date(Date.now() - 5 * 60000).toISOString(), createdByName: 'Sam', activeSteps: [], errorText: null, ...over,
}) as unknown as RuntimeWorkflowMonitorSummary;

const page = (rows: RuntimeWorkflowMonitorSummary[]) => ({
  runtimeWorkflows: rows, total: rows.length, page: 1, pageSize: 24, statusCounts: { active: 4, pending: 1, finished: 0 },
});

const show = (selectedId?: string) => render(
  <ConnectionProvider><RunningView selectedId={selectedId} detail={<p>detail panel</p>} /></ConnectionProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  setWidth(1440);
  list.mockResolvedValue(page([
    rt('r1', 'running', { activeSteps: [{ stepOid: 's', stepName: 'Weigh', stepType: 'USER', state: 'WAITING_USER', claimant: null }] }),
    rt('r2', 'paused'),
    rt('r3', 'running', { activeSteps: [{ stepOid: 's', stepName: 'Mix', stepType: 'USER', state: 'WAITING_USER', claimant: { userId: 'u', name: 'Ann', presence: 'online' } }] }),
  ]));
});
afterEach(cleanup);

describe('RunningView', () => {
  it('lists a paused runtime under Needs attention and the rest after', async () => {
    show();
    await screen.findByText('Flow r2');
    const heading = screen.getByText('Needs attention');
    const rows = screen.getAllByRole('option');
    expect(rows.map((r) => r.getAttribute('data-runtime-id'))).toEqual(['r2', 'r1', 'r3']);
    expect(heading.compareDocumentPosition(rows[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Waiting for operator')).toBeInTheDocument();
    expect(screen.getByText('Ann')).toBeInTheDocument();
  });

  it('shows chips with counts', async () => {
    show();
    await screen.findByText('Flow r2');
    expect(screen.getByRole('button', { name: 'Active · 4' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Waiting · 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finished' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finished' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('wc1', { filter: 'finished', page: 1 }));
  });

  it('ArrowDown moves the selection at desktop width', async () => {
    show('r2');
    await screen.findByText('Flow r2');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(navigate).toHaveBeenCalledWith({ to: '/wc/$wcId/running/$runtimeId', params: { wcId: 'wc1', runtimeId: 'r1' } });
  });

  it('navigates to the runtime when a row is chosen at phone width', async () => {
    setWidth(390);
    show();
    fireEvent.click(await screen.findByText('Flow r1'));
    expect(navigate).toHaveBeenCalledWith({ to: '/wc/$wcId/running/$runtimeId', params: { wcId: 'wc1', runtimeId: 'r1' } });
    expect(screen.queryByText('detail panel')).toBeNull();
  });

  it('keeps the selected runtime across a resize from 1440 to 900', async () => {
    show('r1');
    await screen.findByText('Flow r1');
    expect(screen.getByText('detail panel')).toBeInTheDocument();
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-runtime-id', 'r1');
    act(() => { setWidth(900); listeners.forEach((cb) => cb()); });
    // tablet portrait: the detail replaces the list, still for r1 (the URL did not change)
    expect(screen.getByText('detail panel')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the banner when a background poll fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show();
    await screen.findByText('Flow r1');
    list.mockRejectedValue(new Error('down'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(await screen.findByText(/Not connected/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('pages with Previous/Next when total exceeds the page size', async () => {
    list.mockResolvedValue({ ...page([rt('r1', 'running')]), total: 30, pageSize: 24 });
    show();
    await screen.findByText('Page 1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('wc1', { filter: 'active', page: 2 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finished' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('wc1', { filter: 'finished', page: 1 }));
  });

  it('reports offline while polling fails and clears when the list unmounts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const Probe = () => { const { offline } = useConnection(); return <p>{offline ? 'OFFLINE' : 'online'}</p>; };
    const view = render(<ConnectionProvider><Probe /><RunningView detail={null} /></ConnectionProvider>);
    await screen.findByText('Flow r1');
    list.mockRejectedValue(new Error('down'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(await screen.findByText('OFFLINE')).toBeInTheDocument();
    view.rerender(<ConnectionProvider><Probe /></ConnectionProvider>);
    expect(screen.getByText('online')).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe('ConnectionBanner', () => {
  it('shows the last update time when stale', () => {
    render(<ConnectionBanner stale lastUpdatedAt={new Date(2026, 10, 7, 9, 41)} />);
    expect(screen.getByText('Not connected — last updated 09:41')).toBeInTheDocument();
  });
  it('renders nothing when connected', () => {
    const { container } = render(<ConnectionBanner stale={false} lastUpdatedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
