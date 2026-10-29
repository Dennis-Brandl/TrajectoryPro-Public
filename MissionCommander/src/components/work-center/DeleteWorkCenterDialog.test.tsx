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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import * as wc from '@/lib/api/work-centers';
import { ApiError } from '@/lib/api/client';
import type { WorkCenter } from '@/lib/api/types';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { DeleteWorkCenterDialog } from './DeleteWorkCenterDialog';

const WORK_CENTER: WorkCenter = {
  id: 'w1', name: 'Assembly', description: null, parentWorkCenterId: null,
  sortOrder: 0, dispatchPolicy: 'least_queued_steps', autoClaim: false, runtimeIdTemplate: null, typeName: null, createdAt: '', updatedAt: '',
};

beforeEach(() => vi.clearAllMocks());
// This config does not enable Vitest globals, so @testing-library/react cannot
// auto-register its afterEach(cleanup). Without this, each render() leaks its DOM
// into document.body and later getByRole/getByText calls match duplicates.
afterEach(cleanup);
// vi.spyOn returns the SAME mock instance when re-spying an already-spied method,
// so call counts would accumulate across tests without a restore — breaking the
// exactly-once assertions below.
afterEach(() => vi.restoreAllMocks());

describe('DeleteWorkCenterDialog', () => {
  it('removes the work center, toasts success, and closes', async () => {
    const removeSpy = vi.spyOn(wc.workCenters, 'remove').mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DeleteWorkCenterDialog open workCenter={WORK_CENTER} onOpenChange={onOpenChange} onDeleted={onDeleted} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('w1', false));
    expect(toast.success).toHaveBeenCalled();
    expect(onDeleted).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces a 409 conflict as a toast and keeps the dialog open', async () => {
    vi.spyOn(wc.workCenters, 'remove').mockRejectedValue(new ApiError(409, 'conflict', 'Has children'));
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DeleteWorkCenterDialog open workCenter={WORK_CENTER} onOpenChange={onOpenChange} onDeleted={onDeleted} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Has children'));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

// M6 spec §8.1: the first DELETE never destroys anything — it reports what a confirmed
// delete would. These pin that two-call shape.
describe('two-call delete', () => {
  const refusal = (over: Partial<{ workflows: number; environments: number; instances: number; stepInstances: number; schedules: number; hasChildren: boolean }> = {}) =>
    new ApiError(409, 'conflict', 'Work center has loaded artifacts or run history', {
      error: {
        code: 'conflict',
        message: 'Work center has loaded artifacts or run history',
        impact: { workflows: 2, environments: 1, instances: 3, stepInstances: 9, schedules: 0, hasChildren: false, ...over },
      },
    });

  it('shows the impact summary returned by the refusal and offers Delete anyway', async () => {
    vi.spyOn(wc.workCenters, 'remove').mockRejectedValueOnce(refusal());
    render(<DeleteWorkCenterDialog open workCenter={WORK_CENTER} onOpenChange={vi.fn()} onDeleted={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('2 workflows')).toBeInTheDocument();
    expect(screen.getByText('1 environment specs')).toBeInTheDocument();
    expect(screen.getByText('3 runtime instances (9 step instances)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete anyway' })).toBeInTheDocument();
    // The refusal is an expected answer, not an error — no toast for it.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('re-issues the delete with confirm=true when the user confirms', async () => {
    const removeSpy = vi.spyOn(wc.workCenters, 'remove')
      .mockRejectedValueOnce(refusal())
      .mockResolvedValueOnce(undefined);
    const onDeleted = vi.fn();
    render(<DeleteWorkCenterDialog open workCenter={WORK_CENTER} onOpenChange={vi.fn()} onDeleted={onDeleted} />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete anyway' }));

    expect(removeSpy.mock.calls).toEqual([['w1', false], ['w1', true]]);
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('does not offer Delete anyway when children block the delete', async () => {
    // hasChildren refuses regardless of confirmation (spec §8.3) — offering the button
    // would promise something the server will refuse.
    vi.spyOn(wc.workCenters, 'remove').mockRejectedValueOnce(refusal({ hasChildren: true }));
    render(<DeleteWorkCenterDialog open workCenter={WORK_CENTER} onOpenChange={vi.fn()} onDeleted={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('2 workflows')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete anyway' })).toBeNull();
  });

  it('falls back to a toast for a 409 that carries no impact', async () => {
    vi.spyOn(wc.workCenters, 'remove')
      .mockRejectedValueOnce(new ApiError(409, 'conflict', 'Work center has children'));
    render(<DeleteWorkCenterDialog open workCenter={WORK_CENTER} onOpenChange={vi.fn()} onDeleted={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Work center has children'));
    expect(screen.queryByRole('button', { name: 'Delete anyway' })).toBeNull();
  });

  it('sends confirm=false on the first attempt', async () => {
    // Guards against a truthiness bug turning the preflight into a destructive call.
    const removeSpy = vi.spyOn(wc.workCenters, 'remove').mockResolvedValue(undefined);
    render(<DeleteWorkCenterDialog open workCenter={WORK_CENTER} onOpenChange={vi.fn()} onDeleted={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('w1', false));
  });
});
