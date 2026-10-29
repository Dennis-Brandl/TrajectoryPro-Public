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
import { toast } from 'sonner';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { ApiError } from '@/lib/api/client';
import type { RuntimeParameterSpec, RuntimeWorkflowSummary } from '@/lib/api/types';
import { CreateRuntimeWorkflowDialog } from './CreateRuntimeWorkflowDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/runtime-workflows', () => ({
  runtimeWorkflows: { parameters: vi.fn(), create: vi.fn(), list: vi.fn(), start: vi.fn(), remove: vi.fn() },
}));

const SPECS: RuntimeParameterSpec[] = [
  { id: 'BatchSize', description: null, defaultValue: '25', valueType: 'literal' },
  { id: 'TargetLine', description: null, defaultValue: 'auto-selected line', valueType: 'property' },
];

const SUMMARY: RuntimeWorkflowSummary = {
  id: 'rw1', workCenterId: 'wc1', runtimeNumber: 42, runtimeLabel: 'MIX-20261007-001',
  masterName: 'Bottle Fill', masterOid: 'o1', masterVersion: '1.0.0', masterState: 'released',
  status: 'pending', createdByName: 'S',  createdByLabel: null, createdAt: '2026-08-01T00:00:00Z',
  queuedAt: null, startedAt: null, completedAt: null,
};

beforeEach(() => {
  vi.mocked(runtimeWorkflows.parameters).mockResolvedValue({ workflowId: 'wf1', parameters: SPECS });
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

function renderDialog(props: Partial<React.ComponentProps<typeof CreateRuntimeWorkflowDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  render(
    <CreateRuntimeWorkflowDialog
      open
      onOpenChange={onOpenChange}
      workflowId="wf1"
      workflowName="Bottle Fill"
      workflowVersion="1.0.0"
      workflowState="released"
      onCreated={onCreated}
      {...props}
    />,
  );
  return { onOpenChange, onCreated };
}

describe('CreateRuntimeWorkflowDialog', () => {
  it('renders one labeled input per parameter with literal defaults prefilled', async () => {
    renderDialog();
    expect(await screen.findByLabelText('BatchSize')).toHaveValue('25');
    expect(screen.getByLabelText('TargetLine')).toHaveValue('');
  });

  it('shows the placeholder and an empty value for a property param', async () => {
    renderDialog();
    const targetLine = await screen.findByLabelText('TargetLine');
    expect(targetLine).toHaveValue('');
    expect(targetLine).toHaveAttribute('placeholder', 'Resolved at start: auto-selected line');
  });

  it('Create posts every entered value, including the prefilled literal default', async () => {
    const create = vi.mocked(runtimeWorkflows.create).mockResolvedValue(SUMMARY);
    renderDialog();
    await userEvent.type(await screen.findByLabelText('TargetLine'), 'lineA');
    await userEvent.click(screen.getByRole('button', { name: 'Create and Wait' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith('wf1', { BatchSize: '25', TargetLine: 'lineA' }, { start: false });
  });

  it('a server 400 shows an error toast and leaves the dialog open', async () => {
    vi.mocked(runtimeWorkflows.create).mockRejectedValue(new ApiError(400, 'validation', 'Bad batch size'));
    const { onOpenChange, onCreated } = renderDialog();
    await screen.findByLabelText('BatchSize');
    await userEvent.click(screen.getByRole('button', { name: 'Create and Wait' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Bad batch size'));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create and Wait' })).toBeInTheDocument();
  });

  it('on success calls onCreated with the summary, toasts, and closes', async () => {
    vi.mocked(runtimeWorkflows.create).mockResolvedValue(SUMMARY);
    const { onOpenChange, onCreated } = renderDialog();
    await screen.findByLabelText('BatchSize');
    await userEvent.click(screen.getByRole('button', { name: 'Create and Wait' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(SUMMARY));
    expect(toast.success).toHaveBeenCalledWith('MIX-20261007-001 created — Waiting');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Create and Wait posts start:false and toasts Waiting', async () => {
    const create = vi.mocked(runtimeWorkflows.create).mockResolvedValue(SUMMARY);
    const { onCreated } = renderDialog();
    await screen.findByLabelText('BatchSize');
    await userEvent.click(screen.getByRole('button', { name: 'Create and Wait' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(SUMMARY));
    expect(create).toHaveBeenCalledWith('wf1', { BatchSize: '25' }, { start: false });
    expect(toast.success).toHaveBeenCalledWith('MIX-20261007-001 created — Waiting');
  });

  it('Create and Start posts start:true and toasts Starting', async () => {
    const create = vi.mocked(runtimeWorkflows.create).mockResolvedValue({ ...SUMMARY, status: 'queued' });
    renderDialog();
    await screen.findByLabelText('BatchSize');
    await userEvent.click(screen.getByRole('button', { name: 'Create and Start' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('wf1', { BatchSize: '25' }, { start: true }));
    expect(toast.success).toHaveBeenCalledWith('MIX-20261007-001 created — Starting');
  });
});
