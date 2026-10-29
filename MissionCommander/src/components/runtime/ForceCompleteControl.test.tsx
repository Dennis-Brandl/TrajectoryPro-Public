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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { ForceCompleteControl } from './ForceCompleteControl';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';

vi.mock('@/lib/api/runtime-workflows', () => ({ runtimeWorkflows: { forceComplete: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => { cleanup(); vi.mocked(runtimeWorkflows.forceComplete).mockReset(); vi.mocked(toast.error).mockReset(); });

describe('ForceCompleteControl', () => {
  it('asks for a reason, sends it trimmed, then reports done', async () => {
    vi.mocked(runtimeWorkflows.forceComplete).mockResolvedValue({ ok: true, summary: 'Forced complete: ok' } as never);
    const onDone = vi.fn();
    render(<ForceCompleteControl instanceId="i1" stepInstanceId="s1" stepName="Cool Down" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Force complete Cool Down' }));
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled(); // a reason is required
    fireEvent.change(screen.getByLabelText('Reason for forcing Cool Down'), { target: { value: '  line clear ' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(runtimeWorkflows.forceComplete).toHaveBeenCalledWith('i1', 's1', 'line clear');
    expect(screen.getByRole('button', { name: 'Force complete Cool Down' })).toBeInTheDocument();
  });
  it('Cancel closes without calling the API; disabled stays disabled', () => {
    const { rerender } = render(<ForceCompleteControl instanceId="i1" stepInstanceId="s1" stepName="G" />);
    fireEvent.click(screen.getByRole('button', { name: 'Force complete G' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(runtimeWorkflows.forceComplete).not.toHaveBeenCalled();
    rerender(<ForceCompleteControl instanceId="i1" stepInstanceId="s1" stepName="G" disabled title="Requires Mission System Commander" />);
    expect(screen.getByRole('button', { name: 'Force complete G' })).toBeDisabled();
  });
  it('shows the countdown beside the reason field when a timer is given', () => {
    const timer = { mode: 'timer' as const, deadline: new Date(Date.now() + 192_000).toISOString(), cycleSeconds: null };
    render(<ForceCompleteControl instanceId="i1" stepInstanceId="s1" stepName="G" timer={timer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Force complete G' }));
    expect(screen.getByText(/^Opens in 3:/)).toBeInTheDocument();
  });
  it('a failed request shows the error, keeps the reason open, refreshes but does not report success', async () => {
    vi.mocked(runtimeWorkflows.forceComplete).mockRejectedValue(new Error('Resume the workflow first'));
    const onDone = vi.fn(); const onSuccess = vi.fn();
    render(<ForceCompleteControl instanceId="i1" stepInstanceId="s1" stepName="G" onDone={onDone} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Force complete G' }));
    fireEvent.change(screen.getByLabelText('Reason for forcing G'), { target: { value: 'r' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByLabelText('Reason for forcing G')).toHaveValue('r');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });
  it('onSuccess runs after a successful force', async () => {
    vi.mocked(runtimeWorkflows.forceComplete).mockResolvedValue({ ok: true, summary: 's' } as never);
    const onSuccess = vi.fn();
    render(<ForceCompleteControl instanceId="i1" stepInstanceId="s1" stepName="G" onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Force complete G' }));
    fireEvent.change(screen.getByLabelText('Reason for forcing G'), { target: { value: 'r' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });
});
