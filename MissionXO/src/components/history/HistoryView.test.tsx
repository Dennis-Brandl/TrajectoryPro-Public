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
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const { navigate, listForWorkCenter, detail, download } = vi.hoisted(() => ({
  navigate: vi.fn(), listForWorkCenter: vi.fn(), detail: vi.fn(), download: vi.fn(),
}));
vi.mock('@tanstack/react-router', async (orig) => ({ ...(await orig<typeof import('@tanstack/react-router')>()), useNavigate: () => navigate }));
vi.mock('@/lib/api/runtime-history', () => ({ runtimeHistory: { listForWorkCenter, detail } }));
vi.mock('@/components/history/record/download-record-pdf', () => ({ downloadRecordPdf: download }));
vi.mock('@/components/history/record/record-model', () => ({
  buildRecordModel: () => ({ title: 'T', header: [], zoneNote: '', startingParams: '', log: [], finalValues: '', footerLeft: '' }),
}));
vi.mock('~/components/shell/WorkCenterShell', () => ({ useWorkCenter: () => ({ id: 'wc1', name: 'Alpha', mode: 'full' }) }));

import { HistoryView } from './HistoryView';
import { HistoryDetail } from './HistoryDetail';

let width = 1440;
function setWidth(px: number) {
  width = px;
  window.matchMedia = ((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: width >= min, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

const row = (id: string, finalState: string) => ({
  id, runtimeLabel: `RW-${id}`, masterName: `Flow ${id}`, masterVersion: '1.0', finalState,
  startedAt: new Date(Date.now() - 60000).toISOString(), finishedAt: new Date().toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  setWidth(1440);
  listForWorkCenter.mockResolvedValue({ history: [row('1', 'completed'), row('2', 'errored')], total: 2, page: 1, pageSize: 25 });
});
afterEach(cleanup);

describe('HistoryView', () => {
  it('lists cards under a day label, last 7 days by default', async () => {
    render(<HistoryView detail={<p>d</p>} />);
    await screen.findByText('Flow 1');
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(within(screen.getByRole('listbox', { name: 'History' })).getByText('Failed')).toBeInTheDocument();
    expect(listForWorkCenter.mock.calls[0][1].from).toMatch(/T00:00$/);
  });
  it('Result Failed sends state errored', async () => {
    render(<HistoryView detail={<p>d</p>} />);
    await screen.findByText('Flow 1');
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'errored' } });
    await waitFor(() => expect(listForWorkCenter).toHaveBeenLastCalledWith('wc1', expect.objectContaining({ state: 'errored' })));
  });
  it('phone renders cards, not a table', async () => {
    setWidth(400);
    render(<HistoryView detail={<p>d</p>} />);
    await screen.findByText('Flow 1');
    expect(screen.queryByRole('table')).toBeNull();
    expect(within(screen.getByRole('listbox', { name: 'History' })).getAllByRole('option')).toHaveLength(2);
  });
});

describe('HistoryDetail', () => {
  beforeEach(() => { detail.mockResolvedValue({ id: 'h1' }); });
  it('has Download PDF and no Delete', async () => {
    render(<HistoryDetail historyId="h1" />);
    await screen.findByRole('button', { name: /Download PDF/ });
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });
  it('clicking Download PDF twice quickly downloads once', async () => {
    download.mockImplementation(() => new Promise((r) => setTimeout(r, 30)));
    render(<HistoryDetail historyId="h1" />);
    const b = await screen.findByRole('button', { name: /Download PDF/ });
    fireEvent.click(b); fireEvent.click(b);
    await waitFor(() => expect(b).not.toBeDisabled());
    expect(download).toHaveBeenCalledTimes(1);
  });
});
