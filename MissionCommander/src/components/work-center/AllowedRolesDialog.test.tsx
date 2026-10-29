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
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import * as allowedApi from '@/lib/api/allowed-roles';
import * as rolesApi from '@/lib/api/roles';
import { AllowedRolesDialog } from './AllowedRolesDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NODES_EMPTY = { workflowId: 'wf1', nodes: [
  { nodeId: 'n1', nodeName: 'Review', depth: 0, ownsUiSteps: true, roleIds: [] },
  { nodeId: 'n2', nodeName: 'Approve', depth: 1, ownsUiSteps: true, roleIds: [] },
] };
const NODES_WITH_R1 = { workflowId: 'wf1', nodes: [
  { nodeId: 'n1', nodeName: 'Review', depth: 0, ownsUiSteps: true, roleIds: ['r1'] },
  { nodeId: 'n2', nodeName: 'Approve', depth: 1, ownsUiSteps: true, roleIds: [] },
] };
// D9 tree shape: a UI-less ancestor (grants inherited by nested steps) above a UI-owning child.
const NODES_TREE = { workflowId: 'wf1', nodes: [
  { nodeId: 'n0', nodeName: 'Child Workflow', depth: 0, ownsUiSteps: false, roleIds: [] },
  { nodeId: 'n1', nodeName: 'Review', depth: 1, ownsUiSteps: true, roleIds: [] },
] };
const NO_NODES = { workflowId: 'wf1', nodes: [] };

beforeEach(() => {
  vi.spyOn(rolesApi.roles, 'list').mockResolvedValue({ roles: [{ id: 'r1', name: 'Operator', description: null }, { id: 'r2', name: 'Supervisor', description: null }] });
  vi.spyOn(allowedApi.allowedRoles, 'get').mockResolvedValue(NODES_EMPTY as never);
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('AllowedRolesDialog', () => {
  it('toggling a checkbox does NOT fire a request', async () => {
    const save = vi.spyOn(allowedApi.allowedRoles, 'setRoles').mockResolvedValue(NODES_WITH_R1 as never);
    render(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={() => {}} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Review — Operator' }));
    expect(screen.getByRole('checkbox', { name: 'Review — Operator' })).toBeChecked();
    expect(save).not.toHaveBeenCalled();
  });

  it('Save sends the full desired set in one call, then closes', async () => {
    const save = vi.spyOn(allowedApi.allowedRoles, 'setRoles').mockResolvedValue(NODES_WITH_R1 as never);
    const onOpenChange = vi.fn();
    const onClosed = vi.fn();
    render(<AllowedRolesDialog open onOpenChange={onOpenChange} workflowId="wf1" workflowName="Demo" onClosed={onClosed} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Review — Operator' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith('wf1', [
      { nodeId: 'n1', roleIds: ['r1'] },
      { nodeId: 'n2', roleIds: [] },
    ]);
    await waitFor(() => expect(onClosed).toHaveBeenCalled());
  });

  it('indents nodes by depth and annotates UI-less ancestors (D9)', async () => {
    vi.spyOn(allowedApi.allowedRoles, 'get').mockResolvedValue(NODES_TREE as never);
    render(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={() => {}} />);
    const ancestorLabel = await screen.findByText('Child Workflow');
    expect(ancestorLabel.parentElement).toHaveStyle({ paddingLeft: '0px' });
    expect(screen.getByText('(applies to nested steps)')).toBeInTheDocument();
    const childLabel = screen.getByText('Review');
    expect(childLabel.parentElement).toHaveStyle({ paddingLeft: '16px' });
    // UI-owning nodes carry no annotation.
    expect(childLabel.textContent).not.toContain('applies to nested steps');
  });

  it('Save is disabled until dirty, and disabled again after toggling back', async () => {
    render(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={() => {}} />);
    await screen.findByText('Review');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    const box = screen.getByRole('checkbox', { name: 'Review — Operator' });
    await userEvent.click(box);
    expect(save).toBeEnabled();
    await userEvent.click(box);
    expect(save).toBeDisabled();
  });

  // sameDraft must compare MEMBERSHIP, not just set size — a same-count swap (r1 off, r2
  // on) has to still read as dirty. Every other test here starts from an all-empty
  // pristine draft, where a size check alone happens to agree with a membership check;
  // this is the one case that tells them apart.
  it('swapping one role for another at the same count still counts as dirty', async () => {
    vi.spyOn(allowedApi.allowedRoles, 'get').mockResolvedValue(NODES_WITH_R1 as never);
    render(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={() => {}} />);
    await screen.findByText('Review');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Review — Operator' })); // r1 off
    await userEvent.click(screen.getByRole('checkbox', { name: 'Review — Supervisor' })); // r2 on
    expect(save).toBeEnabled();
  });

  it('Cancel closes without any request', async () => {
    const save = vi.spyOn(allowedApi.allowedRoles, 'setRoles').mockResolvedValue(NODES_EMPTY as never);
    const onClosed = vi.fn();
    render(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={onClosed} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Review — Operator' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(onClosed).toHaveBeenCalled());
  });

  it('a failed Save keeps the dialog open with the draft intact', async () => {
    vi.spyOn(allowedApi.allowedRoles, 'setRoles').mockRejectedValue(new Error('boom'));
    const onClosed = vi.fn();
    render(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={onClosed} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Review — Operator' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Review — Operator' })).toBeChecked();
  });

  it('clicking the overlay does not dismiss the dialog', async () => {
    const onClosed = vi.fn();
    render(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={onClosed} />);
    await screen.findByText('Review');
    // Radix marks the scrim with aria-hidden, so it cannot be reached by role. Selected by
    // data-slot rather than the shadcn class chain (.fixed.inset-0), which is styling that
    // a Tailwind change could rename out from under this test.
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    await userEvent.click(overlay as Element);
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByText('Review')).toBeVisible();
  });

  // The five cases below pin surviving component logic the draft/Save/Cancel rewrite never
  // touched (load failure, its recovery, the no-interactive-steps branch, and the reqId
  // load-fencing guard) plus Esc, whose wiring the rewrite DID touch (onOpenChange now
  // routes through close()). Restored from f877ca9 after task-7 review found Step 1's
  // "replace the describe block" instruction had discarded them along with the obsolete
  // per-toggle cases it actually meant to retire.
  it('fires onClosed when the dialog is dismissed', async () => {
    const onClosed = vi.fn();
    render(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={onClosed} />);
    await screen.findByText('Review');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClosed).toHaveBeenCalled());
  });

  it('shows a failed state when loading rejects, instead of stranding on Loading…', async () => {
    vi.spyOn(allowedApi.allowedRoles, 'get').mockRejectedValue(new Error('boom'));
    render(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={() => {}} />);
    expect(await screen.findByText('Failed to load allowed roles')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('clears a prior failed state on the next successful load', async () => {
    const getSpy = vi.spyOn(allowedApi.allowedRoles, 'get').mockRejectedValueOnce(new Error('boom'));
    getSpy.mockResolvedValue(NODES_EMPTY as never);
    const { rerender } = render(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={() => {}} />);
    expect(await screen.findByText('Failed to load allowed roles')).toBeInTheDocument();
    // Reopen (close then open again): the failed flag must not latch across opens.
    rerender(<AllowedRolesDialog open={false} onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={() => {}} />);
    rerender(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={() => {}} />);
    expect(await screen.findByText('Review')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load allowed roles')).not.toBeInTheDocument();
  });

  // Pins the existing (never-before-tested) empty-nodes branch: a workflow with no
  // interactive steps shows an explanatory message instead of an empty role list.
  it('shows the no-interactive-steps message when the workflow has no UI nodes', async () => {
    vi.spyOn(allowedApi.allowedRoles, 'get').mockResolvedValue(NO_NODES as never);
    render(<AllowedRolesDialog open onOpenChange={() => {}} workflowId="wf1" workflowName="Demo" onClosed={() => {}} />);
    expect(await screen.findByText('This workflow has no interactive steps.')).toBeInTheDocument();
  });

  // Fencing: a load held open across a close/reopen must not paint stale nodes after the
  // newer load resolved. The reqId guard (invalidated on the open-effect cleanup) drops it.
  it('drops a superseded load when closed and reopened mid-flight', async () => {
    const STALE = { workflowId: 'wf1', nodes: [{ nodeId: 'nX', nodeName: 'STALE-NODE', depth: 0, ownsUiSteps: true, roleIds: [] }] };
    let resolveStale!: (v: typeof STALE) => void;
    // First open's load is held open; the reopen falls back to beforeEach's NODES_EMPTY.
    vi.spyOn(allowedApi.allowedRoles, 'get').mockImplementationOnce(() => new Promise((r) => { resolveStale = r; }));
    const props = { onOpenChange: () => {}, workflowId: 'wf1', workflowName: 'Demo', onClosed: () => {} };
    const { rerender } = render(<AllowedRolesDialog open {...props} />);
    rerender(<AllowedRolesDialog open={false} {...props} />);
    rerender(<AllowedRolesDialog open {...props} />);
    expect(await screen.findByText('Review')).toBeInTheDocument(); // second (current) load applied
    await act(async () => resolveStale(STALE)); // first load settles late — must be dropped
    expect(screen.queryByText('STALE-NODE')).toBeNull();
  });
});
