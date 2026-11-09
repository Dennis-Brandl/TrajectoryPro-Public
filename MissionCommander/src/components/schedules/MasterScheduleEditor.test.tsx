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
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/api/schedules', () => ({
  schedules: { workflowOptions: vi.fn(), createMaster: vi.fn(), replaceMaster: vi.fn(), previewRecurrence: vi.fn(), clock: vi.fn(async () => ({ timeZone: 'UTC', workCenterZoneSet: true })) },
}));
import { schedules } from '@/lib/api/schedules';
import { ApiError } from '@/lib/api/client';
import type { MasterScheduleView, ScheduleWorkflowOption } from '@/lib/api/types';
import { MasterScheduleEditor } from './MasterScheduleEditor';

const wf = (name: string, version: string, state: string, params: ScheduleWorkflowOption['startingParameters'], outputs: string[] = []): ScheduleWorkflowOption =>
  ({ id: `${name}-${version}`, name, version, state, startingParameters: params, outputs });
const lit = (id: string, defaultValue = '') => ({ id, description: null, defaultValue, valueType: 'literal' as const });
const OPTIONS = [
  wf('Mix Batch', '1.0.0', 'Effective', [lit('BatchId', 'B-1'), { id: 'Operator', description: null, defaultValue: '', valueType: 'property' }], ['Yield', 'Grade']),
  wf('Mix Batch', '0.9.0', 'Superseded', [lit('BatchId', 'B-0')], ['Yield']),
  wf('Lab Test', '1.0.0', 'Effective', [lit('BatchId'), lit('Sample', 'S1')]),
  wf('Pack', '1.0.0', 'Draft', [lit('Lot')]),
];

const REC = { type: 'daily', every: 1, times: ['06:00'], range: { startDate: '2026-11-09', noEnd: true } } as const;
const master = (over: Partial<MasterScheduleView> = {}): MasterScheduleView => ({
  id: 'm1', workCenterId: 'w1', name: 'Day Production', recurrence: REC, items: [{ workflow: { name: 'Mix Batch' } }],
  source: 'commander', externalKey: null, revision: 1, recurrenceText: 'Every day at 06:00', updatedAt: '2026-11-01T00:00:00Z', ...over,
} as MasterScheduleView);

// cmdk (the workflow picker) measures its list with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const onClose = vi.fn();
const onSaved = vi.fn();
const renderEditor = (m: MasterScheduleView | null) =>
  render(<MasterScheduleEditor workCenterId="w1" master={m} onClose={onClose} onSaved={onSaved} />);
const savedBody = () => vi.mocked(schedules.replaceMaster).mock.calls[0]![1];
/** Save, then give the reason the editor asks for (a new Master's comes filled in). */
async function saveWithReason(reason = 'Line change') {
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  const box = await screen.findByLabelText('Reason for the change');
  if ((box as HTMLTextAreaElement).value === '') await userEvent.type(box, reason);
  await userEvent.click(screen.getByRole('button', { name: /^Save version \d+$/ }));
}
const workflowBox = (row: HTMLElement) => within(within(row).getAllByRole('group', { name: 'Workflow' })[0]!).getByRole('combobox');
const item = (name: string) => screen.getByRole('listitem', { name: `Workflow ${name}` });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(schedules.workflowOptions).mockResolvedValue(OPTIONS);
  vi.mocked(schedules.previewRecurrence).mockResolvedValue({ nextFireTimes: [], recurrenceText: '', timeZone: 'UTC' } as never);
  vi.mocked(schedules.replaceMaster).mockImplementation(async (_id, d) => ({ ...master(), ...d }) as never);
  vi.mocked(schedules.createMaster).mockImplementation(async (_w, d) => ({ ...master(), ...d }) as never);
});
afterEach(cleanup);

describe('MasterScheduleEditor', () => {
  it('Up and Down buttons reorder the start list and the saved body follows', async () => {
    renderEditor(master({ items: [{ workflow: { name: 'Mix Batch' } }, { workflow: { name: 'Pack' } }] }));
    await screen.findByRole('listitem', { name: 'Workflow Pack' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Pack up' }));
    expect(screen.getByRole('button', { name: 'Move Pack up' })).toBeDisabled();
    await saveWithReason();
    await waitFor(() => expect(schedules.replaceMaster).toHaveBeenCalled());
    expect(savedBody().items.map((i) => i.workflow.name)).toEqual(['Pack', 'Mix Batch']);
  });

  it('a drag handle reorders through the same state, and the keyboard works on the handle', async () => {
    renderEditor(master({ items: [{ workflow: { name: 'Mix Batch' } }, { workflow: { name: 'Pack' } }, { workflow: { name: 'Lab Test' } }] }));
    await screen.findByRole('listitem', { name: 'Workflow Lab Test' });
    fireEvent.dragStart(screen.getByRole('button', { name: 'Drag Lab Test to reorder' }));
    fireEvent.dragOver(item('Mix Batch'));
    fireEvent.drop(item('Mix Batch'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag Pack to reorder' }), { key: 'ArrowUp' });
    await saveWithReason();
    await waitFor(() => expect(schedules.replaceMaster).toHaveBeenCalled());
    expect(savedBody().items.map((i) => i.workflow.name)).toEqual(['Lab Test', 'Pack', 'Mix Batch']);
  });

  it('Add chained workflow nests an item that defaults to Completed only; the last ending cannot be unticked', async () => {
    renderEditor(master());
    await screen.findByRole('listitem', { name: 'Workflow Mix Batch' });
    await userEvent.click(screen.getByRole('button', { name: 'Add chained workflow to Mix Batch' }));
    const nested = within(item('Mix Batch')).getByRole('listitem', { name: 'Workflow (not chosen)' });
    expect(within(nested).getByRole('checkbox', { name: 'Completed' })).toBeChecked();
    for (const n of ['Stopped', 'Aborted', 'Errored']) expect(within(nested).getByRole('checkbox', { name: n })).not.toBeChecked();
    expect(within(nested).getByRole('checkbox', { name: 'Completed' })).toBeDisabled();
    await userEvent.click(within(nested).getByRole('checkbox', { name: 'Errored' }));
    await userEvent.click(within(nested).getByRole('checkbox', { name: 'Completed' }));
    expect(within(nested).getByRole('checkbox', { name: 'Completed' })).not.toBeChecked();
    expect(within(nested).getByRole('checkbox', { name: 'Errored' })).toBeDisabled();
    await userEvent.click(within(nested).getByRole('checkbox', { name: 'Completed' }));
    // Choose its workflow, then save: the body nests it with both endings.
    await userEvent.click(workflowBox(nested));
    await userEvent.click(await screen.findByRole('option', { name: 'Lab Test' }));
    await saveWithReason();
    await waitFor(() => expect(schedules.replaceMaster).toHaveBeenCalled());
    expect(savedBody().items[0]!.chain).toEqual([
      { workflow: { name: 'Lab Test' }, triggerOn: ['errored', 'completed'], params: { Sample: { value: 'S1' } } },
    ]);
  });

  it('"From triggering run" is offered on chained items only, listing the parent starting values and outputs', async () => {
    renderEditor(master({ items: [{ workflow: { name: 'Mix Batch' }, chain: [{ workflow: { name: 'Lab Test' }, triggerOn: ['completed'] }] }] }));
    await screen.findByRole('listitem', { name: 'Workflow Lab Test' });
    const start = within(item('Mix Batch')).getAllByLabelText('Source for BatchId')[0]!;
    expect(within(start).queryByRole('option', { name: 'From triggering run' })).toBeNull();
    for (const label of ['Fixed value', 'Scheduled date', 'Scheduled date and time', 'Slot number', 'Template']) {
      expect(within(start).getByRole('option', { name: label })).toBeInTheDocument();
    }
    const chained = within(item('Lab Test')).getByLabelText('Source for BatchId');
    await userEvent.selectOptions(chained, 'From triggering run');
    const picker = within(item('Lab Test')).getByLabelText('Triggering run value for BatchId');
    expect(within(picker).getByRole('group', { name: 'Starting values' })).toBeInTheDocument();
    expect(within(picker).getByRole('group', { name: 'Outputs' })).toBeInTheDocument();
    for (const n of ['BatchId', 'Operator', 'Yield', 'Grade']) expect(within(picker).getByRole('option', { name: n })).toBeInTheDocument();
    await userEvent.selectOptions(picker, 'trigger.output:Yield');
    fireEvent.change(within(item('Lab Test')).getByLabelText('Fallback for BatchId'), { target: { value: 'none' } });
    await saveWithReason();
    await waitFor(() => expect(schedules.replaceMaster).toHaveBeenCalled());
    expect(savedBody().items[0]!.chain![0]!.params).toEqual({
      BatchId: { from: 'trigger.output', name: 'Yield', fallback: 'none' },
    });
  });

  it('adding a workflow prefills its literal defaults', async () => {
    renderEditor(master({ items: [{ workflow: { name: 'Pack' } }] }));
    await screen.findByRole('listitem', { name: 'Workflow Pack' });
    await userEvent.click(screen.getByRole('button', { name: 'Add workflow' }));
    const fresh = screen.getByRole('listitem', { name: 'Workflow (not chosen)' });
    await userEvent.click(workflowBox(fresh));
    await userEvent.click(await screen.findByRole('option', { name: 'Mix Batch' }));
    expect(within(item('Mix Batch')).getByLabelText('Value for BatchId')).toHaveValue('B-1');
    expect(within(item('Mix Batch')).getByLabelText('Value for Operator')).toHaveValue('');
    expect(within(item('Mix Batch')).getByRole('combobox', { name: 'Version' })).toHaveTextContent('Resolve at Enable (recommended)');
    await saveWithReason();
    await waitFor(() => expect(schedules.replaceMaster).toHaveBeenCalled());
    expect(savedBody().items[1]).toEqual({ workflow: { name: 'Mix Batch' }, params: { BatchId: { value: 'B-1' } } });
  });

  it('a pinned version is chosen from the version list and saved', async () => {
    renderEditor(master());
    await screen.findByRole('listitem', { name: 'Workflow Mix Batch' });
    const version = within(item('Mix Batch')).getByRole('combobox', { name: 'Version' });
    expect(within(version).getAllByRole('option')[0]).toHaveTextContent('Resolve at Enable (recommended)');
    await userEvent.selectOptions(version, '0.9.0');
    await saveWithReason();
    await waitFor(() => expect(schedules.replaceMaster).toHaveBeenCalled());
    expect(savedBody().items[0]!.workflow).toEqual({ name: 'Mix Batch', version: '0.9.0' });
  });

  it('changing the workflow keeps values whose parameter id still exists, drops the rest, and says so', async () => {
    renderEditor(master({
      items: [{ workflow: { name: 'Mix Batch' }, params: { BatchId: { value: 'K-9' }, Operator: { value: 'ann' } } }],
    }));
    await screen.findByRole('listitem', { name: 'Workflow Mix Batch' });
    await userEvent.click(workflowBox(item('Mix Batch')));
    await userEvent.click(await screen.findByRole('option', { name: 'Lab Test' }));
    const lab = item('Lab Test');
    expect(within(lab).getByLabelText('Value for BatchId')).toHaveValue('K-9');
    expect(within(lab).getByLabelText('Value for Sample')).toHaveValue('S1');
    expect(within(lab).getByTestId('change-note')).toHaveTextContent(/Operator/);
    await saveWithReason();
    await waitFor(() => expect(schedules.replaceMaster).toHaveBeenCalled());
    expect(savedBody().items[0]!.params).toEqual({ BatchId: { value: 'K-9' }, Sample: { value: 'S1' } });
  });

  it('a workflow no longer in the list stays, with a warning, and Save still saves', async () => {
    renderEditor(master({ items: [{ workflow: { name: 'Retired Blend' }, params: { Old: { value: 'x' } } }] }));
    const row = await screen.findByRole('listitem', { name: 'Workflow Retired Blend' });
    expect(within(row).getByText(/Retired Blend.*not found in this work center/)).toBeInTheDocument();
    expect(workflowBox(row)).toHaveTextContent('Retired Blend');
    await userEvent.type(screen.getByLabelText('Name'), ' 2');
    await saveWithReason();
    await waitFor(() => expect(schedules.replaceMaster).toHaveBeenCalled());
    expect(savedBody().items[0]).toEqual({ workflow: { name: 'Retired Blend' }, params: { Old: { value: 'x' } } });
    expect(onSaved).toHaveBeenCalled();
  });

  it('a Master that came from the API says it is managed elsewhere', async () => {
    renderEditor(master({ source: 'api', managedBy: 'ERP Scheduler' }));
    expect(await screen.findByText('Managed by ERP Scheduler. Your edits will be replaced the next time it sends this schedule.')).toBeInTheDocument();
  });

  it('server problems show beside their field and in a list at the top', async () => {
    vi.mocked(schedules.replaceMaster).mockRejectedValue(new ApiError(400, 'validation', 'The schedule is not valid', {
      error: { details: [
        { path: 'items[0].workflow', code: 'WORKFLOW_INVALID', message: 'workflow needs a name' },
        { path: 'name', code: 'NAME_REQUIRED', message: 'a schedule needs a name' },
      ] },
    }));
    renderEditor(master());
    await screen.findByRole('listitem', { name: 'Workflow Mix Batch' });
    await userEvent.type(screen.getByLabelText('Name'), ' 2');
    await saveWithReason();
    const top = await screen.findByRole('alert');
    expect(within(top).getByText(/workflow needs a name/)).toBeInTheDocument();
    expect(within(top).getByText(/a schedule needs a name/)).toBeInTheDocument();
    expect(within(item('Mix Batch')).getByText('workflow needs a name')).toBeInTheDocument();
    expect(screen.getAllByText(/a schedule needs a name/).length).toBeGreaterThanOrEqual(2);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('an unchanged Master cannot be saved: Save is disabled and a stray submit sends nothing', async () => {
    renderEditor(master());
    await screen.findByRole('listitem', { name: 'Workflow Mix Batch' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.submit(save.closest('form')!);
    expect(schedules.replaceMaster).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Name'), ' 2');
    expect(save).toBeEnabled();
  });

  it('a new Master Schedule is created, not replaced', async () => {
    renderEditor(null);
    await userEvent.type(await screen.findByLabelText('Name'), 'Night Shift');
    await saveWithReason();
    await waitFor(() => expect(schedules.createMaster).toHaveBeenCalled());
    expect(vi.mocked(schedules.createMaster).mock.calls[0]![0]).toBe('w1');
    expect(vi.mocked(schedules.createMaster).mock.calls[0]![1].name).toBe('Night Shift');
    expect(schedules.replaceMaster).not.toHaveBeenCalled();
  });

  it('closing with edits asks first; closing untouched does not', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderEditor(master());
    await screen.findByRole('listitem', { name: 'Workflow Mix Batch' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByLabelText('Name'), ' 2');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });
});

describe('MasterScheduleEditor change reasons', () => {
  it('an edit asks why, names the version it makes, and sends the reason', async () => {
    renderEditor(master({ revision: 3 }));
    expect(await screen.findByText('Version 3. Saving a change makes version 4.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), ' B');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(schedules.replaceMaster).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Save version 4' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason for the change'), '  New line speed  ');
    await userEvent.click(confirm);
    await waitFor(() => expect(schedules.replaceMaster).toHaveBeenCalled());
    expect(vi.mocked(schedules.replaceMaster).mock.calls[0]![2]).toBe('New line speed');
  });

  it('Back to editing sends nothing', async () => {
    renderEditor(master({ revision: 3 }));
    await userEvent.type(await screen.findByLabelText('Name'), ' B');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back to editing' }));
    expect(screen.queryByLabelText('Reason for the change')).toBeNull();
    expect(schedules.replaceMaster).not.toHaveBeenCalled();
  });
});
