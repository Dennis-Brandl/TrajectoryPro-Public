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
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { RuntimeWorkflowLiveDetail, RuntimeWorkflowStatus } from '@/lib/api/types';

const { api, toast, refresh } = vi.hoisted(() => ({
  api: { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), abort: vi.fn(), skipCleanup: vi.fn(), remove: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  refresh: vi.fn(),
}));
vi.mock('@/lib/api/runtime-workflows', () => ({ runtimeWorkflows: api }));
vi.mock('sonner', () => ({ toast }));
vi.mock('~/stores/meStore', () => ({ useMeStore: { getState: () => ({ refresh }) } }));

import { ApiError } from '@/lib/api/client';
import { RuntimeControls } from './RuntimeControls';

window.matchMedia = ((q: string) => ({
  matches: /min-width:\s*(\d+)px/.test(q) ? 1440 >= Number(/min-width:\s*(\d+)px/.exec(q)![1]) : false, media: q,
  addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const detail = (status: RuntimeWorkflowStatus) =>
  ({ summary: { id: 'r1', status, runtimeLabel: 'RT-1' }, steps: [], trace: [], signatures: [], operatorCleanup: { stop: false, abort: false } }) as unknown as RuntimeWorkflowLiveDetail;

const show = (over: Partial<Parameters<typeof RuntimeControls>[0]> = {}) => {
  const onChanged = vi.fn(); const onDeleted = vi.fn();
  render(<RuntimeControls detail={detail('running')} mode="full" offline={false} onChanged={onChanged} onDeleted={onDeleted} {...over} />);
  return { onChanged, onDeleted };
};

beforeEach(() => { vi.clearAllMocks(); refresh.mockResolvedValue(undefined); Object.values(api).forEach((f) => f.mockResolvedValue({ ok: true })); });
afterEach(cleanup);

describe('RuntimeControls', () => {
  it('Abort asks first and calls abort once after confirm, naming the requester', async () => {
    const { onChanged } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Abort…' }));
    expect(api.abort).not.toHaveBeenCalled();
    expect(screen.getByText(/You will be recorded as the requester/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Abort runtime' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.abort).toHaveBeenCalledTimes(1);
    expect(api.abort).toHaveBeenCalledWith('r1');
  });

  it('Stop asks first, names the requester and calls stop once after confirm', async () => {
    const { onChanged } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(api.stop).not.toHaveBeenCalled();
    expect(screen.getByText(/You will be recorded as the requester/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Stop runtime' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.stop).toHaveBeenCalledTimes(1);
  });

  it('a double click on Pause calls pause once', async () => {
    const { onChanged } = show();
    const pause = screen.getByRole('button', { name: 'Pause' });
    fireEvent.click(pause);
    fireEvent.click(pause);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.pause).toHaveBeenCalledTimes(1);
  });

  it('a 403 from Pause shows the view-only text and refreshes the principal', async () => {
    api.pause.mockRejectedValue(new ApiError(403, 'forbidden', 'no'));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('View only — you are not a Mission System Commander in this work center.');
  });

  it('disables the buttons in view-only mode', () => {
    show({ mode: 'view-only' });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Abort…' })).toBeDisabled();
  });

  it('puts Delete in the More menu only when available, and reports it after it ran', async () => {
    show();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    cleanup();
    const { onDeleted } = show({ detail: detail('completed') });
    fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete runtime' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(api.remove).toHaveBeenCalledWith('r1');
  });
});
