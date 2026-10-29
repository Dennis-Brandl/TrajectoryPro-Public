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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSelectionStore } from '@/stores/selectionStore';
import type { SharedResourceView, WorkflowResourceView } from '@/lib/api/types';
import * as wcApi from '@/lib/api/work-centers';
import * as rwApi from '@/lib/api/runtime-workflows';
import { resourceVerbCall } from './ResourceActions';
import { ResourceTable, toSharedResourceRow, toWorkflowResourceRow, type ResourceTableRow } from './ResourceTable';

const PRINTER: SharedResourceView = {
  workCenterId: 'wc1', name: 'Printer', resourceType: 'binary exclusive use', description: null,
  useLimit: null, poolNames: [], availableNames: [], inUse: 1,
  summary: { total: 1, inUse: 1, available: 0, queued: 1, state: 'In use' },
  unaccounted: 0, ledgerMismatch: false, overCommitted: false,
  holders: [{ id: 1, instanceId: 'rw7', runtimeNumber: 7, runtimeLabel: 'MIX-20261007-001', masterName: 'Fill', stepOid: 's-mix', stepName: 'Mix Step', amount: 1, heldName: null, acquiredAt: '2026-09-01T00:00:00Z' }],
  waiters: [{ id: 1, instanceId: 'rw8', runtimeNumber: 8, runtimeLabel: 'BLEND-20261007-002', masterName: 'Fill', stepOid: 's-pack', stepName: 'Pack', kind: 'acquire', amount: null, granted: false, enqueuedAt: '2026-09-01T00:00:01Z' }],
  definedBy: { envSpecId: 'e1', name: 'Kitchen', version: '1.2.0', state: 'Effective' }, orphaned: false, updatedAt: '2026-09-01T00:00:00Z',
};

beforeEach(() => { useSelectionStore.setState({ activeHierarchy: 'environment', selectedRuntimeWorkflowId: null, selectedEnvironmentId: null }); });
afterEach(cleanup);

describe('ResourceTable', () => {
  it('renders the summary, a holder chip that opens the runtime workflow, and a waiter chip', async () => {
    render(<ResourceTable rows={[toSharedResourceRow(PRINTER)]} emptyText="none" />);
    expect(screen.getByRole('cell', { name: 'Printer' })).toBeInTheDocument();
    expect(screen.getByText('In use')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'BLEND-20261007-002 · Pack' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'MIX-20261007-001 · Mix Step' }));
    // BOTH store fields must change — a nav that set only one would strand the user.
    expect(useSelectionStore.getState().activeHierarchy).toBe('runtime');
    expect(useSelectionStore.getState().selectedRuntimeWorkflowId).toBe('rw7');
  });

  it('the provenance link opens the declaring environment; an orphan has a badge and no link', async () => {
    render(<ResourceTable rows={[toSharedResourceRow(PRINTER)]} emptyText="none" />);
    await userEvent.click(screen.getByRole('button', { name: 'Kitchen v1.2.0 (Effective)' }));
    expect(useSelectionStore.getState().activeHierarchy).toBe('environment');
    expect(useSelectionStore.getState().selectedEnvironmentId).toBe('e1');
    cleanup();
    render(<ResourceTable rows={[toSharedResourceRow({ ...PRINTER, orphaned: true, definedBy: { envSpecId: null, name: 'Kitchen', version: '1.2.0', state: 'Effective' } })]} emptyText="none" />);
    // The DAO keeps defined_from_* text for an orphan (§6.4's backstop needs to name the
    // deleted spec) — the row must keep it too, as plain text with no link.
    expect(screen.getByText(/Kitchen v1\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText('orphaned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Kitchen/ })).toBeNull();
  });

  it('badges unaccounted, over-committed and ledger mismatch', () => {
    render(<ResourceTable rows={[toSharedResourceRow({ ...PRINTER, holders: [], unaccounted: 2, overCommitted: true, ledgerMismatch: true })]} emptyText="none" />);
    expect(screen.getByText('unaccounted 2')).toBeInTheDocument();
    expect(screen.getByText('over-committed')).toBeInTheDocument();
    expect(screen.getByText('ledger mismatch')).toBeInTheDocument();
  });

  it('shows the empty text and, when asked, a scope chip', () => {
    render(<ResourceTable rows={[]} emptyText="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    cleanup();
    render(<ResourceTable rows={[toSharedResourceRow(PRINTER)]} emptyText="none" showScope />);
    expect(screen.getByText('environment')).toBeInTheDocument();
  });
});

describe('row converters', () => {
  it('holder and waiter labels follow the runtimeLabel (amount) · name · step convention', () => {
    const row = toSharedResourceRow({
      ...PRINTER,
      holders: [
        { ...PRINTER.holders[0], amount: 2 },
        { ...PRINTER.holders[0], heldName: 'BayA', stepName: null },
      ],
      waiters: [
        { ...PRINTER.waiters[0], amount: 4 },
        { ...PRINTER.waiters[0], id: 2, kind: 'send', granted: true },
      ],
    });
    expect(row.holders.map((h) => h.label)).toEqual(['MIX-20261007-001 (2) · Mix Step', 'MIX-20261007-001 · BayA']);
    expect(row.waiters.map((w) => w.label)).toEqual(['BLEND-20261007-002 · Pack · ×4', 'BLEND-20261007-002 · Pack · send · granted']);
    expect(row.definedBy).toEqual({ envSpecId: 'e1', label: 'Kitchen v1.2.0 (Effective)' });
  });

  it('a workflow-scoped row has no holders or provenance and labels its own queued steps', () => {
    const v: WorkflowResourceView = {
      key: 'wf-1:Lock', ownerOid: 'wf-1', name: 'Lock', resourceType: 'binary exclusive use',
      summary: { total: 1, inUse: 1, available: 0, queued: 1, state: 'In use' },
      queuedSteps: [{ stepOid: 's-pack', stepName: 'Pack', kind: 'acquire' }, { stepOid: 's-x', stepName: null, kind: 'receive' }],
    };
    const row = toWorkflowResourceRow(v, { id: 'rw12', runtimeNumber: 12, runtimeLabel: 'PACK-20261007-003' });
    expect(row).toMatchObject({ scope: 'workflow', holders: [], definedBy: null, orphaned: false, unaccounted: null, state: 'In use' });
    expect(row.waiters.map((w) => w.label)).toEqual(['PACK-20261007-003 · Pack', 'PACK-20261007-003 · s-x · receive']);
    expect(row.waiters[0].instanceId).toBe('rw12');
  });
});

const SLOTS: SharedResourceView = {
  ...PRINTER, name: 'Slots', resourceType: 'countable use with pool limits', useLimit: 4, inUse: 3,
  summary: { total: 4, inUse: 3, available: 1, queued: 0, state: '1 available, 3 in use' },
  holders: [{ ...PRINTER.holders[0], id: 9 }], waiters: [], unaccounted: 2,
};
const BAYS: SharedResourceView = {
  ...PRINTER, name: 'Bays', resourceType: 'named pool', poolNames: ['A', 'B', 'C'], availableNames: ['C'], inUse: 2,
  summary: { total: 3, inUse: 2, available: 1, queued: 0, state: '1 available, 2 in use' },
  holders: [{ ...PRINTER.holders[0], id: 5, heldName: 'A' }], waiters: [], unaccounted: 1,
};
const CHAN: SharedResourceView = {
  ...PRINTER, name: 'Chan', resourceType: 'sync', inUse: 0, summary: { total: 0, inUse: 0, available: 0, queued: 1, state: 'send:1 recv:0 sync:0' },
  holders: [], unaccounted: null, waiters: [{ ...PRINTER.waiters[0], id: 3, kind: 'send' }],
};
const LOCK: WorkflowResourceView = {
  key: 'rt_1:Lock', ownerOid: 'rt_1', name: 'Lock', resourceType: 'binary exclusive use',
  summary: { total: 1, inUse: 1, available: 0, queued: 1, state: 'In use' },
  queuedSteps: [{ stepOid: 's-pack', stepName: 'Pack', kind: 'acquire' }],
};

function renderWithActions(rows: ResourceTableRow[], canCommand = true) {
  const onVerb = vi.fn();
  render(<ResourceTable rows={rows} emptyText="none" actions={{ canCommand, busy: false, onVerb }} />);
  return onVerb;
}

describe('ResourceTable actions column (Phase 4b)', () => {
  it('renders no actions without the prop; with it, a non-commander sees disabled controls with the reason', () => {
    render(<ResourceTable rows={[toSharedResourceRow(PRINTER)]} emptyText="none" />);
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Release Printer' })).toBeNull();
    cleanup();
    renderWithActions([toSharedResourceRow(PRINTER)], false);
    const release = screen.getByRole('button', { name: 'Release Printer' });
    expect(release).toBeDisabled();
    expect(release).toHaveAttribute('title', 'Requires Mission System Commander');
    expect(screen.getByRole('button', { name: 'Reset Printer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel wait BLEND-20261007-002 · Pack on Printer' })).toBeDisabled();
  });

  it('Reset: inline confirm names the work-center-wide blast radius; Cancel makes no call; Confirm fires reset', async () => {
    const onVerb = renderWithActions([toSharedResourceRow(PRINTER)]);
    await userEvent.click(screen.getByRole('button', { name: 'Reset Printer' }));
    expect(onVerb).not.toHaveBeenCalled();
    expect(screen.getByText(/Reset “Printer” to its initial state\?/)).toHaveTextContent('This acts on the whole work center');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(onVerb).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reset Printer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onVerb).toHaveBeenCalledWith(expect.objectContaining({ name: 'Printer' }), 'reset', {});
  });

  it('per-waiter Cancel confirms then fires cancel-waiter with the waiter ROW id; a workflow row passes the step oid', async () => {
    const onVerb = renderWithActions([toSharedResourceRow(PRINTER), toWorkflowResourceRow(LOCK, { id: 'rw12', runtimeNumber: 12, runtimeLabel: 'PACK-20261007-003' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel wait BLEND-20261007-002 · Pack on Printer' }));
    expect(screen.getByText(/Cancel the wait of BLEND-20261007-002 · Pack on “Printer”\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onVerb).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Printer' }), 'cancel-waiter', { waiterId: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel wait PACK-20261007-003 · Pack on Lock' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onVerb).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Lock', scope: 'workflow' }), 'cancel-waiter', { waiterId: 's-pack' });
  });

  it('a sync row offers Clear (clear-sync) and neither Reset nor Release', async () => {
    const onVerb = renderWithActions([toSharedResourceRow(CHAN)]);
    expect(screen.queryByRole('button', { name: 'Reset Chan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Release Chan' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear Chan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onVerb).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chan' }), 'clear-sync', {});
  });

  it('Release…: a tracked holder fires release-holder with its row id', async () => {
    const onVerb = renderWithActions([toSharedResourceRow(PRINTER)]);
    await userEvent.click(screen.getByRole('button', { name: 'Release Printer' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Release “Printer”' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Release holder MIX-20261007-001 · Mix Step' }));
    expect(onVerb).toHaveBeenCalledWith(expect.objectContaining({ name: 'Printer' }), 'release-holder', { holderId: 1 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Release…: untracked units take an amount bounded by the unaccounted count and say the engine may allow fewer', async () => {
    const onVerb = renderWithActions([toSharedResourceRow(SLOTS)]);
    await userEvent.click(screen.getByRole('button', { name: 'Release Slots' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/reserved for a granted-but-unconsumed waiter/)).toBeInTheDocument();
    const amount = within(dialog).getByLabelText('Amount');
    expect(amount).toHaveValue(1);
    await userEvent.clear(amount);
    await userEvent.type(amount, '3'); // above the 2 unaccounted
    expect(within(dialog).getByRole('button', { name: 'Release untracked units' })).toBeDisabled();
    await userEvent.clear(amount);
    await userEvent.type(amount, '2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Release untracked units' }));
    expect(onVerb).toHaveBeenCalledWith(expect.objectContaining({ name: 'Slots' }), 'release', { amount: 2 });
  });

  it('Release…: a named pool lists its untracked held names; a workflow row releases from its own in_use', async () => {
    const onVerb = renderWithActions([toSharedResourceRow(BAYS), toWorkflowResourceRow(LOCK, { id: 'rw12', runtimeNumber: 12, runtimeLabel: 'PACK-20261007-003' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Release Bays' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Release holder MIX-20261007-001 · A · Mix Step' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Release untracked name A' })).toBeNull(); // A is tracked
    await userEvent.click(within(dialog).getByRole('button', { name: 'Release untracked name B' }));
    expect(onVerb).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Bays' }), 'release', { poolName: 'B' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Release Lock' }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText(/Tracked holders/)).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Release untracked units' }));
    expect(onVerb).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Lock', scope: 'workflow' }), 'release', { amount: 1 });
  });

  it('Release… is absent when nothing is held', () => {
    renderWithActions([toSharedResourceRow({ ...PRINTER, holders: [], inUse: 0, unaccounted: 0 })]);
    expect(screen.queryByRole('button', { name: 'Release Printer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset Printer' })).toBeInTheDocument();
  });

  it('a workflow-scoped named pool offers Reset only — the pane cannot name its held pool name', () => {
    const NAMED_LOCK: WorkflowResourceView = {
      key: 'rt_1:Bays', ownerOid: 'rt_1', name: 'Bays', resourceType: 'named pool',
      summary: { total: 2, inUse: 1, available: 1, queued: 0, state: '1 available, 1 in use' },
      queuedSteps: [],
    };
    renderWithActions([toWorkflowResourceRow(NAMED_LOCK, { id: 'rw12', runtimeNumber: 12, runtimeLabel: 'PACK-20261007-003' })]);
    expect(screen.getByRole('button', { name: 'Reset Bays' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release Bays' })).toBeNull();
  });
});

describe('resourceVerbCall', () => {
  it('routes an environment row to the WORK-CENTER route (from any pane) and a workflow row to the instance route', async () => {
    const wcSpy = vi.spyOn(wcApi.workCenters, 'resourceVerb').mockResolvedValue({ ok: true, summary: '' });
    const rwSpy = vi.spyOn(rwApi.runtimeWorkflows, 'resourceVerb').mockResolvedValue({ ok: true, summary: '' });
    await resourceVerbCall(toSharedResourceRow(PRINTER), 'release-holder', { holderId: 1 })();
    expect(wcSpy).toHaveBeenCalledWith('wc1', 'release-holder', { name: 'Printer', holderId: 1 });
    await resourceVerbCall(toSharedResourceRow(PRINTER), 'cancel-waiter', { waiterId: 1 })();
    expect(wcSpy).toHaveBeenLastCalledWith('wc1', 'cancel-waiter', { name: 'Printer', waiterId: 1 });
    await resourceVerbCall(toWorkflowResourceRow(LOCK, { id: 'rw12', runtimeNumber: 12, runtimeLabel: 'PACK-20261007-003' }), 'cancel-waiter', { waiterId: 's-pack' })();
    expect(rwSpy).toHaveBeenCalledWith('rw12', 'cancel-waiter', { resourceKey: 'rt_1:Lock', waiterId: 's-pack' });
    expect(wcSpy).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
