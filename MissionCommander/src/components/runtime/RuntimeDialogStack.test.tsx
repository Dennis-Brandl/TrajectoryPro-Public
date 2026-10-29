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
import { runtimeHistory } from '@/lib/api/runtime-history';
import type { RuntimeWorkflowLiveDetail, RuntimeHistoryDetail } from '@/lib/api/types';
import { RuntimeDialogStack } from './RuntimeDialogStack';

vi.mock('@/lib/api/runtime-workflows', () => ({
  runtimeWorkflows: {
    live: vi.fn(), children: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    stop: vi.fn(), abort: vi.fn(), remove: vi.fn(), forceRelease: vi.fn(),
  },
}));
vi.mock('@/lib/api/runtime-history', () => ({
  runtimeHistory: { detail: vi.fn(), remove: vi.fn() },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function live(id: string, label: string): RuntimeWorkflowLiveDetail {
  return {
    summary: {
      id, workCenterId: 'w1', runtimeNumber: 1, runtimeLabel: label,
      masterName: 'Mix', masterOid: 'o1', masterVersion: '1.0.0', masterState: 'released',
      status: 'running', createdByName: null, createdByLabel: null, createdAt: '2026-08-01T00:00:00Z',
      queuedAt: null, startedAt: null, completedAt: null,
    },
    steps: [], trace: [], signatures: [],
  };
}
function hist(id: string, label: string, workflowInstanceId: string | null): RuntimeHistoryDetail {
  return {
    id, workflowInstanceId, workCenterId: 'w1', workCenterName: 'Line A', runtimeNumber: 1, runtimeLabel: label,
    masterName: 'Mix', masterOid: 'o1', masterVersion: '1.0.0', masterState: 'released', finalState: 'completed',
    startedAt: null, finishedAt: '2026-08-01T00:00:00Z', createdAt: '2026-08-01T00:00:00Z',
    startingParams: null, trace: [], properties: null, stepParams: null, stepNames: null, signatures: [], stepRuns: [], startedByLoginName: null, startedByUserId: null, userNames: {},
    createdByLabel: null, createdByInstanceId: null, outputs: null,
  };
}
const row = (runtimeLabel: string, open: { kind: 'live' | 'history'; id: string }) => ({
  runtimeLabel, workCenterPath: 'Line A', workflowName: 'Mix', workflowVersion: '1.0.0',
  workflowState: null, createdAt: null, state: 'running' as const, open,
});

function setupLiveParent() {
  vi.mocked(runtimeWorkflows.live).mockImplementation(async (id: string) => live(id, id === 'p1' ? 'RW-1' : 'RW-2'));
  vi.mocked(runtimeWorkflows.children).mockImplementation(async (id: string) =>
    id === 'p1'
      ? { items: [row('RW-2', { kind: 'live', id: 'c1' }), row('RW-3', { kind: 'history', id: 'h1' })], total: 2 }
      : { items: [], total: 0 });
  vi.mocked(runtimeHistory.detail).mockResolvedValue(hist('h1', 'RW-3', null));
}

describe('RuntimeDialogStack', () => {
  it('a live child opens in place and Back returns to the parent', async () => {
    setupLiveParent();
    render(<RuntimeDialogStack initial={{ kind: 'live', id: 'p1' }} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open RW-2' }));
    expect(await screen.findByRole('button', { name: 'Back to RW-1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /RW-2/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to RW-1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /RW-1/ })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Back to RW-1' })).toBeNull();
  });

  it('a finished child opens its History record', async () => {
    setupLiveParent();
    render(<RuntimeDialogStack initial={{ kind: 'live', id: 'p1' }} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open RW-3' }));
    expect(await screen.findByText('Details for a completed runtime workflow.')).toBeInTheDocument();
    expect(runtimeHistory.detail).toHaveBeenCalledWith('h1');
    expect(screen.getByRole('button', { name: 'Back to RW-1' })).toBeInTheDocument();
  });

  it('a history parent looks its children up by workflowInstanceId', async () => {
    vi.mocked(runtimeHistory.detail).mockResolvedValue(hist('h0', 'RW-9', 'wi0'));
    vi.mocked(runtimeWorkflows.children).mockResolvedValue({ items: [], total: 0 });
    render(<RuntimeDialogStack initial={{ kind: 'history', id: 'h0' }} onClose={vi.fn()} />);
    await waitFor(() => expect(runtimeWorkflows.children).toHaveBeenCalledWith('wi0'));
    expect(runtimeWorkflows.children).not.toHaveBeenCalledWith('h0');
  });

  it('a history parent with no workflowInstanceId shows no section and makes no call', async () => {
    vi.mocked(runtimeHistory.detail).mockResolvedValue(hist('h0', 'RW-9', null));
    render(<RuntimeDialogStack initial={{ kind: 'history', id: 'h0' }} onClose={vi.fn()} />);
    await screen.findByText('Details for a completed runtime workflow.');
    expect(runtimeWorkflows.children).not.toHaveBeenCalled();
    expect(screen.queryByText('Created runtimes')).toBeNull();
  });
});
