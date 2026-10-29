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
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { runtimeHistory } from '@/lib/api/runtime-history';
import { ApiError } from '@/lib/api/client';
import { usePrincipalStore } from '@/stores/principalStore';
import type { RuntimeHistoryDetail, MePrincipal, StepSignatureView } from '@/lib/api/types';
import { HistoryDetailDialog } from './HistoryDetailDialog';
import { renderRecordPdf } from './record/record-pdf';
import { buildRecordModel } from './record/record-model';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./record/record-model', () => ({
  buildRecordModel: vi.fn(() => ({ fake: 'model' })),
  pdfFileName: vi.fn(() => 'RW-7 - Pizza Order.pdf'),
}));
vi.mock('./record/record-pdf', () => ({ renderRecordPdf: vi.fn() }));
vi.mock('@/lib/api/runtime-history', () => ({
  runtimeHistory: { detail: vi.fn(), remove: vi.fn() },
}));

function detail(over: Partial<RuntimeHistoryDetail> = {}): RuntimeHistoryDetail {
  return {
    id: 'h1', workflowInstanceId: 'wi1', workCenterId: 'w1', workCenterName: 'Assembly',
    runtimeNumber: 7, runtimeLabel: 'RW-7', masterName: 'Bottle Fill', masterOid: 'o1', masterVersion: '1.0.0', masterState: 'released',
    finalState: 'completed', startedAt: '2026-08-01T00:00:00.000Z', finishedAt: '2026-08-01T00:00:12.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    startingParams: null, trace: [], properties: null, stepParams: null, stepNames: null, signatures: [], stepRuns: [], startedByLoginName: null, startedByUserId: null, userNames: {},
    createdByLabel: null, createdByInstanceId: null, outputs: null,
    ...over,
  };
}

const signed: StepSignatureView = {
  id: 'sig1', stepOid: 's-1', stepName: 'Approve batch', signerLoginName: 'jane', signerDisplayName: 'Jane Lee',
  roleName: 'QA Lead', meaning: null, decision: 'yes', outcome: 'signed', failureCode: null, signedAt: '2026-08-01T00:00:05.000Z',
};

const ADMIN: MePrincipal = {
  id: 'a', email: 'a@x', loginName: 'admin', displayName: 'A', accessLevel: 'administrator',
  isAdministrator: true, rights: [], missionSystemCommanderOf: [],
};
const COMMANDER: MePrincipal = {
  id: 'c', email: 'c@x', loginName: 'admin', displayName: 'C', accessLevel: 'viewer',
  isAdministrator: false, rights: [], missionSystemCommanderOf: ['w1'],
};
const PLAIN: MePrincipal = {
  id: 'p', email: 'p@x', loginName: 'admin', displayName: 'P', accessLevel: 'viewer',
  isAdministrator: false, rights: [], missionSystemCommanderOf: [],
};

beforeEach(() => {
  vi.mocked(renderRecordPdf).mockReset();
  vi.mocked(buildRecordModel).mockClear();
  vi.mocked(toast.error).mockClear();
  usePrincipalStore.getState().setPrincipal(ADMIN);
});
// ONE hook, in an EXPLICIT order — never separate afterEach registrations. Vitest's default
// `sequence.hooks: 'stack'` runs afterEach hooks in REVERSE registration order, so separate
// registrations would run in the OPPOSITE order to what's written here. cleanup() must run
// FIRST — its own act() flushes any passive effect still pending for an already-committed tree,
// so a mount landing after mocks/principal were already reset would crash or read stale state
// (see RuntimeTab.test.tsx). restoreAllMocks() runs after cleanup(); clearPrincipal() runs LAST
// since nothing here depends on the principal once the tree is unmounted and mocks are restored.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  usePrincipalStore.getState().clearPrincipal();
});

async function renderDialog(d: RuntimeHistoryDetail, onClose = vi.fn(), onDeleted = vi.fn()) {
  vi.mocked(runtimeHistory.detail).mockResolvedValue(d);
  const utils = render(<HistoryDetailDialog id={d.id} onClose={onClose} onDeleted={onDeleted} />);
  // The Delete button is always present once loaded (enabled or not), so this is a reliable
  // "the detail has landed" signal — the header text is split across several sibling text
  // nodes (RW name / master name / version / badge), which plain getByText can't match.
  await screen.findByRole('button', { name: 'Delete' });
  return { ...utils, onClose, onDeleted };
}

describe('HistoryDetailDialog — header', () => {
  it('renders RW number, master name/version, and status badge in the dialog title', async () => {
    await renderDialog(detail());
    // The title is split across sibling text nodes and nested <span>s (RW name, master name,
    // version, badge) — the ACCESSIBLE NAME computation (unlike plain getByText) recurses
    // through all of that, so asserting against it is the reliable way to check each piece.
    const dialog = screen.getByRole('dialog', { name: /RW-7/ });
    expect(dialog).toHaveAccessibleName(/Bottle Fill/);
    expect(dialog).toHaveAccessibleName(/v1\.0\.0/);
    expect(dialog).toHaveAccessibleName(/Completed/); // RuntimeStatusBadge label
  });

  it('renders work center name, started/finished, and duration in the meta line', async () => {
    await renderDialog(detail());
    // All four pieces are sibling text nodes inside the SAME div (no wrapping elements), so
    // getByText with exact:false (substring) resolves each assertion to that one node.
    expect(screen.getByText('Assembly', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-08-01T00:00:00.000Z').toLocaleString(), { exact: false })).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-08-01T00:00:12.000Z').toLocaleString(), { exact: false })).toBeInTheDocument();
    expect(screen.getByText('12s', { exact: false })).toBeInTheDocument(); // formatDuration(started, finished)
  });

  it('exposes an accessible dialog description when loaded', async () => {
    await renderDialog(detail());
    expect(screen.getByRole('dialog', { name: /RW-7/ })).toHaveAccessibleDescription();
  });

  it('exposes an accessible dialog description in the loading fallback too (sweep lesson)', async () => {
    vi.mocked(runtimeHistory.detail).mockReturnValue(new Promise(() => {})); // never resolves
    render(<HistoryDetailDialog id="h1" onClose={vi.fn()} onDeleted={vi.fn()} />);
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription();
  });
});

describe('HistoryDetailDialog — loading/error fallback', () => {
  it('shows the error message, not "Not found", on a failed fetch', async () => {
    vi.mocked(runtimeHistory.detail).mockRejectedValue(new ApiError(500, 'internal', 'Server exploded'));
    render(<HistoryDetailDialog id="h1" onClose={vi.fn()} onDeleted={vi.fn()} />);
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    expect(screen.queryByText('Not found')).not.toBeInTheDocument();
  });
});

describe('HistoryDetailDialog — trace', () => {
  it('renders trace entries flat, ordered, with names resolved via stepNames, state, and timestamp', async () => {
    const d = detail({
      stepNames: { so1: 'Fill Form', so2: 'Cap Bottle' },
      trace: [
        { step_oid: 'so1', state: 'RUNNING', order: 0, timestamp: Date.parse('2026-08-01T00:00:01.000Z') },
        { step_oid: 'so2', state: 'RUNNING', order: 1, timestamp: Date.parse('2026-08-01T00:00:05.000Z') },
      ],
    });
    await renderDialog(d);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Fill Form');
    expect(items[0]).toHaveTextContent('RUNNING');
    expect(items[0]).toHaveTextContent(new Date('2026-08-01T00:00:01.000Z').toLocaleString());
    expect(items[1]).toHaveTextContent('Cap Bottle');
  });

  it('falls back to the raw step oid when stepNames is null', async () => {
    const d = detail({
      stepNames: null,
      trace: [{ step_oid: 'so1', state: 'RUNNING', order: 0, timestamp: Date.parse('2026-08-01T00:00:01.000Z') }],
    });
    await renderDialog(d);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('so1');
  });

  it('renders error text on a trace entry when present', async () => {
    const d = detail({
      trace: [{ step_oid: 'so1', state: 'ERROR', order: 0, timestamp: Date.parse('2026-08-01T00:00:01.000Z'), error: 'Timed out' }],
    });
    await renderDialog(d);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Timed out');
  });

  it('an opened-never-closed step sequence renders every entry flat, with no pairing artifacts', async () => {
    // Two entries for the SAME step_oid, neither ever reaching a settled/closed state — a
    // naive pairing implementation would try to match a start/end and either drop the
    // second entry or synthesize a merged row. The flat contract means both entries render
    // independently, in order, exactly as received.
    const d = detail({
      stepNames: { so1: 'Fill Form' },
      trace: [
        { step_oid: 'so1', state: 'WAITING_USER', order: 0, timestamp: Date.parse('2026-08-01T00:00:01.000Z') },
        { step_oid: 'so1', state: 'WAITING_USER', order: 1, timestamp: Date.parse('2026-08-01T00:00:02.000Z') },
      ],
    });
    await renderDialog(d);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('WAITING_USER');
    expect(items[1]).toHaveTextContent('WAITING_USER');
  });

  it('never renders a per-step duration, even when trace timestamps span hours', async () => {
    // Overall run duration is a short 12s (header). If per-step trace entries were ever
    // paired into a duration, these two timestamps (7500s apart) would render as "2h 05m" —
    // that string must never appear anywhere in the document.
    const d = detail({
      stepNames: { so1: 'Fill Form' },
      trace: [
        { step_oid: 'so1', state: 'RUNNING', order: 0, timestamp: Date.parse('2026-08-01T00:00:00.000Z') },
        { step_oid: 'so1', state: 'COMPLETED', order: 1, timestamp: Date.parse('2026-08-01T02:05:00.000Z') },
      ],
    });
    await renderDialog(d);
    expect(screen.queryByText('2h 05m')).not.toBeInTheDocument();
    expect(screen.getByText('12s', { exact: false })).toBeInTheDocument(); // the one legitimate (header) duration
  });
});

describe('HistoryDetailDialog — collapsibles', () => {
  it('Signatures collapsible is absent at zero and shows the count when present', async () => {
    const d = detail({ signatures: [signed] });
    await renderDialog(d);
    expect(screen.getByRole('button', { name: 'Show signatures (1)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show signatures (1)' }));
    expect(screen.getByText(/Jane Lee \(jane\)/)).toBeInTheDocument();
  });

  it('Signatures collapsible is absent when there are no signatures', async () => {
    await renderDialog(detail({ signatures: [] }));
    expect(screen.queryByRole('button', { name: /signatures/i })).not.toBeInTheDocument();
  });

  it('Properties collapsible starts closed and toggles key/value rows', async () => {
    const d = detail({ properties: { batch: 'B-42' } });
    await renderDialog(d);
    expect(screen.queryByText('B-42')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /properties/i }));
    expect(screen.getByText('batch')).toBeInTheDocument();
    expect(screen.getByText('B-42')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /properties/i }));
    expect(screen.queryByText('B-42')).not.toBeInTheDocument();
  });

  it('Starting params collapsible toggles key/value rows', async () => {
    const d = detail({ startingParams: { qty: '10' } });
    await renderDialog(d);
    expect(screen.queryByText('10')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /starting params/i }));
    expect(screen.getByText('qty')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('Step params collapsible groups inputs/outputs per step, with names resolved via stepNames', async () => {
    const d = detail({
      stepNames: { so1: 'Fill Form' },
      stepParams: { so1: { inputParameters: { qty: '10' }, outputParameters: { result: 'ok' } } },
    });
    await renderDialog(d);
    await userEvent.click(screen.getByRole('button', { name: /step params/i }));
    expect(screen.getByText('Fill Form')).toBeInTheDocument();
    expect(screen.getByText(/qty/)).toBeInTheDocument();
    expect(screen.getByText(/result/)).toBeInTheDocument();
  });

  it('an empty/null section shows "None" rather than an empty list', async () => {
    const d = detail({ properties: {}, startingParams: null });
    await renderDialog(d);
    await userEvent.click(screen.getByRole('button', { name: /properties/i }));
    expect(screen.getAllByText('None').length).toBeGreaterThan(0);
  });
});

describe('HistoryDetailDialog — Download PDF', () => {
  it('builds the record, renders it, and saves under the record file name', async () => {
    const save = vi.fn();
    vi.mocked(renderRecordPdf).mockReturnValue({ doc: { save } as never, placements: [], pageCount: 1 } as never);
    await renderDialog(detail());
    await userEvent.click(screen.getByRole('button', { name: /Download PDF/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('RW-7 - Pizza Order.pdf'));
    expect(buildRecordModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }),
      expect.objectContaining({ loginName: 'admin', now: expect.any(Date), timeZone: expect.any(String) }));
    expect(renderRecordPdf).toHaveBeenCalledWith({ fake: 'model' });
  });

  it('toasts when the PDF cannot be created, and the button is usable again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(renderRecordPdf).mockImplementation(() => { throw new Error('boom'); });
    await renderDialog(detail());
    await userEvent.click(screen.getByRole('button', { name: /Download PDF/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not create the PDF'));
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  });

  it('a second click before the first finishes saves only once', async () => {
    const save = vi.fn();
    vi.mocked(renderRecordPdf).mockReturnValue({ doc: { save } } as never);
    await renderDialog(detail());
    const btn = screen.getByRole('button', { name: /Download PDF/ });
    // Two clicks in the same tick: the dynamic import is still pending for both.
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(buildRecordModel).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeEnabled();
  });
});

describe('HistoryDetailDialog — step params from step runs', () => {
  const run = (n: number, nodePath: RuntimeHistoryDetail['stepRuns'][number]['nodePath'] = []) => ({
    id: `r${n}`, stepInstanceId: null, stepOid: 't1', stepName: 'Add Topping', stepType: 'SCRIPT', runNumber: n,
    startedAt: null, finishedAt: '2026-08-01T00:00:05.000Z', result: 'completed' as const, error: null,
    inputParameters: { qty: String(n) }, outputParameters: null,
    performedByLoginName: null, performedByKind: 'script' as const, nodePath,
  });

  it('lists every run of a step', async () => {
    await renderDialog(detail({ stepRuns: [run(1), run(2), run(3)] }));
    await userEvent.click(screen.getByRole('button', { name: /step params/i }));
    expect(screen.getByText('Add Topping #1')).toBeInTheDocument();
    expect(screen.getByText('Add Topping #2')).toBeInTheDocument();
    expect(screen.getByText('Add Topping #3')).toBeInTheDocument();
  });

  it('shows the sub-workflow path for a child step', async () => {
    await renderDialog(detail({ stepRuns: [run(1, [{ proxyStepOid: 'p', proxyRun: 1, workflowName: 'Make Pizza' }, { proxyStepOid: 'q', proxyRun: 2, workflowName: 'Toppings' }])] }));
    await userEvent.click(screen.getByRole('button', { name: /step params/i }));
    expect(screen.getByText('Make Pizza › Toppings (2)')).toBeInTheDocument();
  });

  it('numbers a child step per run of its sub-workflow, like the PDF', async () => {
    const prep = (proxyRun: number) => [{ proxyStepOid: 'p', proxyRun, workflowName: 'Prep' }];
    await renderDialog(detail({ stepRuns: [{ ...run(1, prep(1)), id: 'a' }, { ...run(2, prep(2)), id: 'b' }, { ...run(3, prep(2)), id: 'c' }] }));
    await userEvent.click(screen.getByRole('button', { name: /step params/i }));
    expect(screen.getAllByText('Add Topping #1')).toHaveLength(2);
    expect(screen.getByText('Add Topping #2')).toBeInTheDocument();
    expect(screen.queryByText('Add Topping #3')).not.toBeInTheDocument();
    expect(screen.getByText('Prep')).toBeInTheDocument();
    expect(screen.getAllByText('Prep (2)')).toHaveLength(2);
  });

  it('legacy step params still render when there are no step runs', async () => {
    await renderDialog(detail({
      stepRuns: [], stepNames: { so1: 'Fill Form' },
      stepParams: { so1: { inputParameters: { qty: '10' } } },
    }));
    await userEvent.click(screen.getByRole('button', { name: /step params/i }));
    expect(screen.getByText('Fill Form')).toBeInTheDocument();
    expect(screen.queryByText(/#1/)).not.toBeInTheDocument();
  });
});

describe('HistoryDetailDialog — delete gating', () => {
  it('an administrator can delete an orphan row (no work center), no reason tooltip', async () => {
    const d = detail({ workCenterId: null });
    await renderDialog(d);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).toBeEnabled();
    expect(btn.parentElement).not.toHaveAttribute('title');
  });

  it('a mission commander of the row work center can delete', async () => {
    usePrincipalStore.getState().setPrincipal(COMMANDER);
    await renderDialog(detail({ workCenterId: 'w1' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('a plain user cannot delete a row with a work center: disabled with a reason tooltip', async () => {
    usePrincipalStore.getState().setPrincipal(PLAIN);
    await renderDialog(detail({ workCenterId: 'w1' }));
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).toBeDisabled();
    expect(btn.parentElement).toHaveAttribute('title', expect.stringMatching(/.+/));
  });

  it('a plain user cannot delete an orphan row either: disabled with a reason tooltip', async () => {
    usePrincipalStore.getState().setPrincipal(PLAIN);
    await renderDialog(detail({ workCenterId: null }));
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).toBeDisabled();
    expect(btn.parentElement).toHaveAttribute('title', expect.stringMatching(/.+/));
  });

  it('a commander of a DIFFERENT work center cannot delete this row', async () => {
    usePrincipalStore.getState().setPrincipal({ ...COMMANDER, missionSystemCommanderOf: ['other'] });
    await renderDialog(detail({ workCenterId: 'w1' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

describe('HistoryDetailDialog — delete confirm flow', () => {
  it('clicking Delete shows an inline confirm; Cancel dismisses without calling remove', async () => {
    await renderDialog(detail());
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(runtimeHistory.remove).not.toHaveBeenCalled();
    expect(await screen.findByText('Delete this history entry?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete this history entry?')).not.toBeInTheDocument();
    expect(runtimeHistory.remove).not.toHaveBeenCalled();
  });

  it('Confirm calls remove, toasts success, closes, and refreshes the parent', async () => {
    vi.mocked(runtimeHistory.remove).mockResolvedValue(undefined);
    const { onClose, onDeleted } = await renderDialog(detail());
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(runtimeHistory.remove).toHaveBeenCalledWith('h1'));
    expect(toast.success).toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDeleted).toHaveBeenCalled();
  });

  it('a 404 on delete shows a toast via apiErrorMessage and does not close the dialog', async () => {
    vi.mocked(runtimeHistory.remove).mockRejectedValue(new ApiError(404, 'not_found', 'History entry not found'));
    const { onClose } = await renderDialog(detail());
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('History entry not found'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a 403 on delete shows a toast via apiErrorMessage and does not close the dialog', async () => {
    vi.mocked(runtimeHistory.remove).mockRejectedValue(new ApiError(403, 'forbidden', 'Requires Mission System Commander'));
    const { onClose } = await renderDialog(detail());
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Requires Mission System Commander'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('HistoryDetailDialog — fetch (one-shot, no polling)', () => {
  it('fetches detail(id) once on mount and does not refetch on its own', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.mocked(runtimeHistory.detail).mockResolvedValue(detail());
    render(<HistoryDetailDialog id="h1" onClose={vi.fn()} onDeleted={vi.fn()} />);
    await vi.waitFor(() => expect(runtimeHistory.detail).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10000);
    expect(runtimeHistory.detail).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('shows the creating runtime when there is one', async () => {
    await renderDialog(detail({ createdByLabel: 'Line A/RW-12', createdByInstanceId: 'x' }));
    expect(screen.getByText('Created by Line A/RW-12', { exact: false })).toBeInTheDocument();
  });
});
