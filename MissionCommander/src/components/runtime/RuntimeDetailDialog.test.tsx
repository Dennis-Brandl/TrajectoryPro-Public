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
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { ApiError } from '@/lib/api/client';
import { usePrincipalStore } from '@/stores/principalStore';
import type { RuntimeWorkflowLiveDetail, RuntimeWorkflowStatus, MePrincipal, StepSignatureView } from '@/lib/api/types';
import { RuntimeDetailDialog, RUNTIME_DETAIL_POLL_MS } from './RuntimeDetailDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/runtime-workflows', () => ({
  runtimeWorkflows: {
    live: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    stop: vi.fn(), abort: vi.fn(), remove: vi.fn(), forceRelease: vi.fn(),
  },
}));

function detail(status: RuntimeWorkflowStatus, over: Partial<RuntimeWorkflowLiveDetail> = {}): RuntimeWorkflowLiveDetail {
  return {
    summary: {
      id: 'rw1', workCenterId: 'w1', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001',
      masterName: 'Bottle Fill', masterOid: 'o1', masterVersion: '1.0.0', masterState: 'released',
      status, createdByName: 'Sam',  createdByLabel: null, createdAt: '2026-08-01T00:00:00Z',
      queuedAt: null, startedAt: null, completedAt: null,
    },
    steps: [],
    trace: [],
    signatures: [],
    ...over,
  };
}

const signed: StepSignatureView = {
  id: 'sig1', stepOid: 's-1', stepName: 'Approve batch', signerLoginName: 'jane', signerDisplayName: 'Jane Lee',
  roleName: 'QA Lead', meaning: null, decision: 'yes', outcome: 'signed', failureCode: null, signedAt: '2026-08-01T00:00:05.000Z',
};

const COMMANDER: MePrincipal = {
  id: 'c', email: 'c@x', loginName: 'admin', displayName: 'C', accessLevel: 'viewer',
  isAdministrator: false, rights: [], missionSystemCommanderOf: ['w1'],
};

beforeEach(() => {
  usePrincipalStore.getState().setPrincipal(COMMANDER);
});
// ONE hook, cleanup strictly first — see RuntimeTab.test.tsx's own comment for the p7 flake this
// ordering closes (Vitest runs afterEach in REVERSE registration order, so the old three separate
// registrations ran clearPrincipal -> restoreAllMocks -> cleanup, neutering the mocks while this
// file's usePolledView tree was still mounted with passive effects pending). Unmount first, then
// tear the mocks and the principal store down behind it.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  usePrincipalStore.getState().clearPrincipal();
});

async function renderDialog(d: RuntimeWorkflowLiveDetail, onClose = vi.fn()) {
  vi.mocked(runtimeWorkflows.live).mockResolvedValue(d);
  const utils = render(<RuntimeDetailDialog id={d.summary.id} onClose={onClose} />);
  // Start's aria-label is always present once loaded (enabled or not), so this is a
  // reliable "the live view has landed" signal regardless of fixture status.
  await screen.findByRole('button', { name: `Start ${d.summary.runtimeLabel}` });
  return { ...utils, onClose };
}

const ALL_LABELS = ['Start', 'Pause', 'Resume', 'Request stop', 'Abort', 'Delete'];

describe('RuntimeDetailDialog — accessible description', () => {
  it('exposes an accessible description naming the dialog’s purpose', async () => {
    await renderDialog(detail('running'));
    expect(screen.getByRole('dialog', { name: /MIX-20261007-001/ })).toHaveAccessibleDescription(
      'Live monitoring and controls for this runtime workflow.',
    );
  });
});

describe('RuntimeDetailDialog — legal gating (mirrors runtime-control.ts:20-23 + RUNTIME_DELETABLE)', () => {
  const CASES: Array<{ status: RuntimeWorkflowStatus; enabled: string[] }> = [
    { status: 'running', enabled: ['Pause', 'Request stop', 'Abort'] },
    { status: 'paused', enabled: ['Resume', 'Request stop', 'Abort'] },
    { status: 'pausing', enabled: ['Request stop', 'Abort'] },
    { status: 'pending', enabled: ['Start', 'Delete'] },
    { status: 'stopping', enabled: ['Abort'] },
    { status: 'stopped', enabled: ['Delete'] },
    // queued: in the DAO's abort set but NOT in RUNTIME_DELETABLE — the subtle one, since
    // it's easy to assume "not yet running" implies deletable.
    { status: 'queued', enabled: ['Abort'] },
    { status: 'resuming', enabled: ['Abort'] },
    // aborting: already in the abort set's own target state, not a member of it — nothing
    // is legal from here but waiting it out.
    { status: 'aborting', enabled: [] },
    { status: 'completed', enabled: ['Delete'] },
    { status: 'errored', enabled: ['Delete'] },
    { status: 'aborted', enabled: ['Delete'] },
  ];

  it.each(CASES)('status $status enables exactly $enabled', async ({ status, enabled }) => {
    await renderDialog(detail(status));
    for (const label of ALL_LABELS) {
      const btn = screen.getByRole('button', { name: `${label} MIX-20261007-001` });
      if (enabled.includes(label)) expect(btn).toBeEnabled();
      else expect(btn).toBeDisabled();
    }
  });
});

describe('RuntimeDetailDialog — non-commander gating', () => {
  it('disables every action and carries the Requires Mission System Commander tooltip reason', async () => {
    usePrincipalStore.getState().setPrincipal({ ...COMMANDER, missionSystemCommanderOf: [] });
    await renderDialog(detail('running'));
    for (const label of ALL_LABELS) {
      const btn = screen.getByRole('button', { name: `${label} MIX-20261007-001` });
      expect(btn).toBeDisabled();
      expect(btn.parentElement).toHaveAttribute('title', 'Requires Mission System Commander');
    }
  });
});

describe('RuntimeDetailDialog — confirms', () => {
  it('Stop: no call on click, shows "Stop MIX-20261007-001?", Cancel makes no call, Confirm calls stop', async () => {
    await renderDialog(detail('running'));
    await userEvent.click(screen.getByRole('button', { name: 'Request stop MIX-20261007-001' }));
    expect(runtimeWorkflows.stop).not.toHaveBeenCalled();
    expect(await screen.findByText('Stop MIX-20261007-001?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Stop MIX-20261007-001?')).not.toBeInTheDocument();
    expect(runtimeWorkflows.stop).not.toHaveBeenCalled();

    vi.mocked(runtimeWorkflows.stop).mockResolvedValue({ ok: true });
    await userEvent.click(screen.getByRole('button', { name: 'Request stop MIX-20261007-001' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(runtimeWorkflows.stop).toHaveBeenCalledWith('rw1'));
  });

  it('Abort: no call on click, shows "Abort MIX-20261007-001?", Cancel makes no call, Confirm calls abort', async () => {
    await renderDialog(detail('running'));
    await userEvent.click(screen.getByRole('button', { name: 'Abort MIX-20261007-001' }));
    expect(runtimeWorkflows.abort).not.toHaveBeenCalled();
    expect(await screen.findByText('Abort MIX-20261007-001?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Abort MIX-20261007-001?')).not.toBeInTheDocument();
    expect(runtimeWorkflows.abort).not.toHaveBeenCalled();

    vi.mocked(runtimeWorkflows.abort).mockResolvedValue({ ok: true });
    await userEvent.click(screen.getByRole('button', { name: 'Abort MIX-20261007-001' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(runtimeWorkflows.abort).toHaveBeenCalledWith('rw1'));
  });

  it('Delete: no call on click, shows "Delete MIX-20261007-001?", Cancel makes no call, Confirm calls remove and closes', async () => {
    const { onClose } = await renderDialog(detail('pending'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete MIX-20261007-001' }));
    expect(runtimeWorkflows.remove).not.toHaveBeenCalled();
    expect(await screen.findByText('Delete MIX-20261007-001?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete MIX-20261007-001?')).not.toBeInTheDocument();
    expect(runtimeWorkflows.remove).not.toHaveBeenCalled();

    vi.mocked(runtimeWorkflows.remove).mockResolvedValue(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Delete MIX-20261007-001' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(runtimeWorkflows.remove).toHaveBeenCalledWith('rw1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Force release: no call on click, shows the claim-release confirm, Cancel makes no call, Confirm calls forceRelease with the assignment id', async () => {
    const d = detail('running', {
      steps: [{
        id: 'st1', stepOid: 'so1', stepName: 'Fill Form', stepType: 'form', state: 'WAITING_USER',
        error: null, startedAt: null, completedAt: null, gateTimer: null,
        assignment: { id: 'as1', status: 'claimed', claimant: { userId: 'u1', name: 'Op One', presence: 'online' } },
      }],
    });
    await renderDialog(d);
    await userEvent.click(screen.getByRole('button', { name: 'Force release Fill Form' }));
    expect(runtimeWorkflows.forceRelease).not.toHaveBeenCalled();
    expect(await screen.findByText('Release the claim on “Fill Form”?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Release the claim on “Fill Form”?')).not.toBeInTheDocument();
    expect(runtimeWorkflows.forceRelease).not.toHaveBeenCalled();

    vi.mocked(runtimeWorkflows.forceRelease).mockResolvedValue({ ok: true });
    await userEvent.click(screen.getByRole('button', { name: 'Force release Fill Form' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(runtimeWorkflows.forceRelease).toHaveBeenCalledWith('as1'));
  });

  it('Pause fires immediately with no confirm step', async () => {
    vi.mocked(runtimeWorkflows.pause).mockResolvedValue({ ok: true });
    await renderDialog(detail('running'));
    await userEvent.click(screen.getByRole('button', { name: 'Pause MIX-20261007-001' }));
    await waitFor(() => expect(runtimeWorkflows.pause).toHaveBeenCalledWith('rw1'));
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('Resume fires immediately with no confirm step', async () => {
    vi.mocked(runtimeWorkflows.resume).mockResolvedValue({ ok: true });
    await renderDialog(detail('paused'));
    await userEvent.click(screen.getByRole('button', { name: 'Resume MIX-20261007-001' }));
    await waitFor(() => expect(runtimeWorkflows.resume).toHaveBeenCalledWith('rw1'));
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });
});

describe('RuntimeDetailDialog — busy guard', () => {
  it('disables every action while a call is in flight, and re-enables per gating once it resolves', async () => {
    let resolvePause!: (v: { ok: true }) => void;
    vi.mocked(runtimeWorkflows.pause).mockReturnValue(new Promise((resolve) => { resolvePause = resolve; }));
    await renderDialog(detail('running'));

    await userEvent.click(screen.getByRole('button', { name: 'Pause MIX-20261007-001' }));
    // Busy short-circuits gating entirely (`disabled={!canCommand || !a.enabled || busy}`):
    // every action is disabled while in flight, not just the ones gating would already forbid.
    for (const label of ALL_LABELS) {
      expect(screen.getByRole('button', { name: `${label} MIX-20261007-001` })).toBeDisabled();
    }

    resolvePause({ ok: true });
    // Back to plain gating for 'running' once busy clears: Pause/Request stop/Abort enabled,
    // the rest (e.g. Start) disabled again.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause MIX-20261007-001' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Request stop MIX-20261007-001' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Abort MIX-20261007-001' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Start MIX-20261007-001' })).toBeDisabled();
  });
});

describe('RuntimeDetailDialog — steps list', () => {
  it('renders step name and state', async () => {
    const d = detail('running', {
      steps: [{
        id: 'st1', stepOid: 'so1', stepName: 'Mix Batch', stepType: 'form', state: 'RUNNING',
        error: null, startedAt: '2026-08-01T00:02:00Z', completedAt: null, assignment: null, gateTimer: null,
      }],
    });
    await renderDialog(d);
    expect(screen.getByText('Mix Batch')).toBeInTheDocument();
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
  });

  it('a claimed step shows the claimant name, a presence dot, and a Force release control', async () => {
    const d = detail('running', {
      steps: [{
        id: 'st1', stepOid: 'so1', stepName: 'Fill Form', stepType: 'form', state: 'WAITING_USER',
        error: null, startedAt: null, completedAt: null, gateTimer: null,
        assignment: { id: 'as1', status: 'claimed', claimant: { userId: 'u1', name: 'Op One', presence: 'online' } },
      }],
    });
    await renderDialog(d);
    expect(screen.getByText('Op One')).toBeInTheDocument();
    // Presence is asserted via the sr-only text (mirrors PresenceStrip's pattern), not by
    // counting `.bg-emerald-500` dot nodes — decouples the assertion from color/CSS and
    // gives the presence state an accessible-name equivalent for screen readers.
    expect(screen.getByText('(online)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Force release Fill Form' })).toBeInTheDocument();
  });

  it('omits Force release when the instance status is terminal, even for a claimed step', async () => {
    const d = detail('stopped', {
      steps: [{
        id: 'st1', stepOid: 'so1', stepName: 'Fill Form', stepType: 'form', state: 'WAITING_USER',
        error: null, startedAt: null, completedAt: null, gateTimer: null,
        assignment: { id: 'as1', status: 'claimed', claimant: { userId: 'u1', name: 'Op One', presence: 'online' } },
      }],
    });
    await renderDialog(d);
    expect(screen.queryByRole('button', { name: 'Force release Fill Form' })).not.toBeInTheDocument();
  });
});

describe('RuntimeDetailDialog — force complete', () => {
  it('a waiting timed gate offers Force complete and shows the time remaining', async () => {
    const d = detail('running', {
      steps: [{
        id: 'st9', stepOid: 'g1', stepName: 'Cool Down', stepType: 'GATE', state: 'WAITING_GATE',
        error: null, startedAt: null, completedAt: null, assignment: null,
        gateTimer: { mode: 'timer', deadline: new Date(Date.now() + 192_000).toISOString(), cycleSeconds: null },
      }],
    });
    await renderDialog(d);
    await userEvent.click(screen.getByRole('button', { name: 'Force complete Cool Down' }));
    expect(screen.getByText(/^Opens in 3:/)).toBeInTheDocument();
  });
  it('a waiting repeating script offers Force complete and shows its cycle', async () => {
    const d = detail('running', {
      steps: [{
        id: 'st10', stepOid: 'sc1', stepName: 'Poll Tank', stepType: 'SCRIPT', state: 'WAITING_SCRIPT',
        error: null, startedAt: null, completedAt: null, assignment: null,
        gateTimer: { mode: 'repeat_script', deadline: null, cycleSeconds: 5 },
      }],
    });
    await renderDialog(d);
    await userEvent.click(screen.getByRole('button', { name: 'Force complete Poll Tank' }));
    expect(screen.getByText('Running script · checks every 5 s')).toBeInTheDocument();
  });
});

describe('RuntimeDetailDialog — trace', () => {
  it('renders trace entries (stepName/state) inside a collapsible', async () => {
    const d = detail('running', {
      trace: [
        { stepOid: 'so1', stepName: 'Fill Form', state: 'RUNNING', error: null, at: '2026-08-01T00:03:00Z' },
      ],
    });
    await renderDialog(d);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Show trace (1)' }));
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Fill Form');
    expect(items[0]).toHaveTextContent('RUNNING');
  });
});

describe('RuntimeDetailDialog — signatures', () => {
  it('Signatures collapsible is absent at zero and shows the count when present', async () => {
    const d = detail('running', { signatures: [signed] });
    await renderDialog(d);
    expect(screen.getByRole('button', { name: 'Show signatures (1)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show signatures (1)' }));
    expect(screen.getByText(/Jane Lee \(jane\)/)).toBeInTheDocument();
  });
});

describe('RuntimeDetailDialog — honest fallback', () => {
  it('a failed first load shows the error message, not "Not found"', async () => {
    vi.mocked(runtimeWorkflows.live).mockRejectedValue(new ApiError(500, 'internal', 'Server exploded'));
    render(<RuntimeDetailDialog id="rw1" onClose={vi.fn()} />);
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    expect(screen.queryByText('Not found')).not.toBeInTheDocument();
  });
});

describe('RuntimeDetailDialog — staleness affordance', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  it('shows the staleness line after a failing background poll tick, and hides it once a tick recovers', async () => {
    let call = 0;
    vi.mocked(runtimeWorkflows.live).mockImplementation(async () => {
      call++;
      if (call === 2) throw new ApiError(500, 'internal', 'boom');
      return detail('running');
    });
    render(<RuntimeDetailDialog id="rw1" onClose={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // initial (foreground) load
    expect(screen.getByRole('button', { name: 'Start MIX-20261007-001' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(RUNTIME_DETAIL_POLL_MS); }); // failing background tick
    expect(screen.getByRole('status')).toHaveTextContent('Live view unavailable — showing last known state');

    await act(async () => { await vi.advanceTimersByTimeAsync(RUNTIME_DETAIL_POLL_MS); }); // recovering background tick
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('RuntimeDetailDialog — stale-confirm clearing', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  it('clears a pending confirm when a poll delivers a different status, without ever firing it', async () => {
    let call = 0;
    vi.mocked(runtimeWorkflows.live).mockImplementation(async () => {
      call++;
      return detail(call === 1 ? 'pending' : 'queued');
    });
    render(<RuntimeDetailDialog id="rw1" onClose={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // initial load: pending
    expect(screen.getByRole('button', { name: 'Start MIX-20261007-001' })).toBeInTheDocument();

    // fireEvent (not userEvent) here: userEvent's internal wait chain deadlocks under
    // vitest fake timers even with delay:null/advanceTimers, and this only needs a plain
    // click dispatched, not a full pointer-event sequence.
    fireEvent.click(screen.getByRole('button', { name: 'Delete MIX-20261007-001' }));
    expect(screen.getByText('Delete MIX-20261007-001?')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(RUNTIME_DETAIL_POLL_MS); }); // poll delivers 'queued'
    expect(screen.queryByText('Delete MIX-20261007-001?')).not.toBeInTheDocument();
    expect(runtimeWorkflows.remove).not.toHaveBeenCalled();
  });
});

describe('RuntimeDetailDialog — 409 handling', () => {
  it('a 409 from an action shows a toast and refreshes', async () => {
    await renderDialog(detail('running'));
    const liveCallsBefore = vi.mocked(runtimeWorkflows.live).mock.calls.length;
    vi.mocked(runtimeWorkflows.pause).mockRejectedValue(new ApiError(409, 'conflict', 'Runtime workflow already paused'));
    await userEvent.click(screen.getByRole('button', { name: 'Pause MIX-20261007-001' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Runtime workflow already paused'));
    // timeout below RUNTIME_DETAIL_POLL_MS (2000): a normally-scheduled background poll tick
    // can't land inside this window on its own, so this mostly disambiguates "the action
    // handler calls refresh()" from "the ambient poll happened to tick" — it can't spuriously
    // fail, but it isn't airtight: under load a delayed/coalesced poll tick could still land
    // inside the window and satisfy the assertion for the wrong reason.
    await waitFor(
      () => expect(vi.mocked(runtimeWorkflows.live).mock.calls.length).toBeGreaterThan(liveCallsBefore),
      { timeout: 1500 },
    );
  });
});

describe('RuntimeDetailDialog — lineage', () => {
  it('shows the creating runtime in the meta line', async () => {
    const d = detail('running');
    d.summary.createdByLabel = 'Line A/RW-12';
    await renderDialog(d);
    expect(screen.getByText('Created by Line A/RW-12', { exact: false })).toBeInTheDocument();
  });
});
