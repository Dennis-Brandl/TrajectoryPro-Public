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
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteSpecDialog } from './DeleteSpecDialog';
import { ApiError } from '@/lib/api/client';
import { toast } from 'sonner';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('DeleteSpecDialog', () => {
  it('calls onConfirm then onDeleted on success', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    render(<DeleteSpecDialog open onOpenChange={onOpenChange} kind="workflow" name="Mix v2" onConfirm={onConfirm} onDeleted={onDeleted} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('surfaces the 409 RESTRICT message and stays open', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'Workflow is linked to one or more work centers'));
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    render(<DeleteSpecDialog open onOpenChange={onOpenChange} kind="workflow" name="Mix v2" onConfirm={onConfirm} onDeleted={onDeleted} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Workflow is linked to one or more work centers'));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('tells a workflow delete that finished runtimes go with it and stay in History', () => {
    render(<DeleteSpecDialog open onOpenChange={() => {}} kind="workflow" name="Mix v2" onConfirm={vi.fn()} onDeleted={() => {}} />);
    expect(screen.getByText(/its finished runtime workflows \(their records stay in History\)/)).toBeInTheDocument();
  });

  it('names the environment in its copy when kind=environment', () => {
    render(<DeleteSpecDialog open onOpenChange={() => {}} kind="environment" name="Kitchen v1" onConfirm={vi.fn()} onDeleted={() => {}} />);
    expect(screen.getByText(/Kitchen v1/)).toBeInTheDocument();
    expect(screen.getByText(/environment/i)).toBeInTheDocument();
    expect(screen.getByText(/Finished runtime workflows that used it are not affected/)).toBeInTheDocument();
  });
});
