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
import { useSelectionStore } from '@/stores/selectionStore';
import { usePrincipalStore } from '@/stores/principalStore';
import * as api from '@/lib/api/runtime-workflows';
import * as historyApi from '@/lib/api/runtime-history';
import { ApiError } from '@/lib/api/client';
import type { RuntimeWorkflowLiveDetail, StepSignatureView } from '@/lib/api/types';
import { RuntimeWorkflowDetail } from './RuntimeWorkflowDetail';

// The diagram card fetches on mount — stub its two feeds so detail tests stay focused.
const DIAGRAM = { instanceId: 'rw1', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001', masterName: 'Mix', root: { oid: 'wf-1', name: 'Mix', version: '1', state: null, notation: 'flowchart' as const, steps: [], connections: [], children: [] } };
const LIVE_STATES = { instanceId: 'rw1', status: 'running', steps: {}, childActive: {} };

const DETAIL: RuntimeWorkflowLiveDetail = {
  summary: {
    id: 'rw1', workCenterId: 'wc1', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001', masterName: 'Mix', masterOid: 'o',
    masterVersion: '1.0.0', masterState: 'Effective', status: 'running', createdByName: 'S',  createdByLabel: null,
    createdAt: '2026-08-27T00:00:00Z', queuedAt: '2026-08-27T00:00:01Z',
    startedAt: '2026-08-27T00:00:02Z', completedAt: null,
  },
  steps: [
    { id: 'si1', stepOid: 's-ui', stepName: 'Fill Details', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
      error: null, startedAt: null, completedAt: null, gateTimer: null,
      assignment: { id: 'a1', status: 'offered', claimant: null } },
    { id: 'si2', stepOid: 's-ui2', stepName: 'Approve', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
      error: null, startedAt: null, completedAt: null, gateTimer: null,
      assignment: { id: 'a2', status: 'claimed', claimant: { userId: 'u1', name: 'Alice', presence: 'online' } } },
  ],
  trace: [],
  signatures: [],
};

const signed: StepSignatureView = {
  id: 'sig1', stepOid: 's-1', stepName: 'Approve batch', signerLoginName: 'jane', signerDisplayName: 'Jane Lee',
  roleName: 'QA Lead', meaning: null, decision: 'yes', outcome: 'signed', failureCode: null, signedAt: '2026-08-27T00:00:05.000Z',
};

function setPrincipal(systemCommanderOf: string[]) {
  usePrincipalStore.getState().setPrincipal({
    id: 'me', email: '', loginName: 'admin', displayName: 'Me', accessLevel: 'steward',
    isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: systemCommanderOf,
  });
}

beforeEach(() => {
  useSelectionStore.setState({ activeHierarchy: 'runtime', selectedRuntimeWorkflowId: 'rw1' });
  setPrincipal(['wc1']);
  vi.spyOn(api.runtimeWorkflows, 'live').mockResolvedValue(DETAIL);
  vi.spyOn(api.runtimeWorkflows, 'children').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(api.runtimeWorkflows, 'diagram').mockResolvedValue(DIAGRAM);
  vi.spyOn(api.runtimeWorkflows, 'liveStates').mockResolvedValue(LIVE_STATES);
  vi.spyOn(api.runtimeWorkflows, 'resources').mockResolvedValue({ instanceId: 'rw1', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001', masterName: 'Mix', workflow: [], environment: [] });
  vi.spyOn(api.runtimeWorkflows, 'valueProperties').mockResolvedValue({ instanceId: 'rw1', root: {}, children: [], shared: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('RuntimeWorkflowDetail', () => {
  it('renders header, overview, and the steps panel', async () => {
    render(<RuntimeWorkflowDetail />);
    expect(await screen.findByRole('heading', { name: 'MIX-20261007-001 Mix' })).toBeInTheDocument();
    expect(screen.getByText('Fill Details')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('pause acts immediately; stop takes the inline confirm; verbs honor CAN sets', async () => {
    const pause = vi.spyOn(api.runtimeWorkflows, 'pause').mockResolvedValue({ ok: true });
    const stop = vi.spyOn(api.runtimeWorkflows, 'stop').mockResolvedValue({ ok: true });
    render(<RuntimeWorkflowDetail />);
    await screen.findByRole('heading', { name: 'MIX-20261007-001 Mix' });
    expect(screen.getByRole('button', { name: 'Resume MIX-20261007-001' })).toBeDisabled(); // running: resume illegal
    await userEvent.click(screen.getByRole('button', { name: 'Pause MIX-20261007-001' }));
    await waitFor(() => expect(pause).toHaveBeenCalledWith('rw1'));
    await userEvent.click(screen.getByRole('button', { name: 'Request stop MIX-20261007-001' }));
    expect(stop).not.toHaveBeenCalled(); // confirm strip first
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(stop).toHaveBeenCalledWith('rw1'));
  });

  it('non-commander: every control disabled', async () => {
    setPrincipal([]);
    render(<RuntimeWorkflowDetail />);
    await screen.findByRole('heading', { name: 'MIX-20261007-001 Mix' });
    expect(screen.getByRole('button', { name: 'Pause MIX-20261007-001' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Assign Fill Details' })).toBeDisabled();
  });

  it('assign flow: offered step opens the picker, picking a member posts the assign', async () => {
    vi.spyOn(api.runtimeWorkflows, 'candidates').mockResolvedValue({
      assignmentId: 'a1', status: 'offered', stepName: 'Fill Details',
      candidates: [{ userId: 'u2', name: 'Bob', presence: 'away' }],
    });
    const assign = vi.spyOn(api.runtimeWorkflows, 'assign').mockResolvedValue({ ok: true });
    render(<RuntimeWorkflowDetail />);
    await screen.findByRole('heading', { name: 'MIX-20261007-001 Mix' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign Fill Details' }));
    await userEvent.click(await screen.findByRole('button', { name: /Bob/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('a1', 'u2'));
  });

  it('force-release flow: claimed step, inline confirm, posts the release', async () => {
    const fr = vi.spyOn(api.runtimeWorkflows, 'forceRelease').mockResolvedValue({ ok: true });
    render(<RuntimeWorkflowDetail />);
    await screen.findByRole('heading', { name: 'MIX-20261007-001 Mix' });
    await userEvent.click(screen.getByRole('button', { name: 'Force release Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(fr).toHaveBeenCalledWith('a2'));
  });

  it('a vanished instance (404) shows the no-longer-available notice', async () => {
    vi.spyOn(api.runtimeWorkflows, 'live').mockRejectedValue(new ApiError(404, 'not_found', 'gone'));
    render(<RuntimeWorkflowDetail />);
    expect(await screen.findByText('This runtime workflow is no longer available.')).toBeInTheDocument();
  });

  it('mounts the Resources and Value properties sections for the selected instance', async () => {
    render(<RuntimeWorkflowDetail />);
    await screen.findByRole('heading', { name: 'MIX-20261007-001 Mix' });
    expect(await screen.findByText('This runtime workflow uses no resources')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Value properties' })).toBeInTheDocument();
    expect(api.runtimeWorkflows.resources).toHaveBeenCalledWith('rw1');
    expect(api.runtimeWorkflows.valueProperties).toHaveBeenCalledWith('rw1');
  });

  it('Signatures collapsible is absent at zero and shows the count when present', async () => {
    vi.spyOn(api.runtimeWorkflows, 'live').mockResolvedValue({ ...DETAIL, signatures: [signed] });
    render(<RuntimeWorkflowDetail />);
    await screen.findByRole('heading', { name: 'MIX-20261007-001 Mix' });
    expect(screen.getByRole('button', { name: 'Show signatures (1)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show signatures (1)' }));
    expect(screen.getByText(/Jane Lee \(jane\)/)).toBeInTheDocument();
  });

  it('shows which runtime created this one', async () => {
    vi.spyOn(api.runtimeWorkflows, 'live').mockResolvedValue({ ...DETAIL, summary: { ...DETAIL.summary, createdByLabel: 'Line A/RW-12' } });
    render(<RuntimeWorkflowDetail />);
    expect(await screen.findByText('Line A/RW-12')).toBeInTheDocument();
    expect(screen.getByText('Created by runtime')).toBeInTheDocument();
  });
  it('a live child opens in the pane; a finished one opens its History record over it', async () => {
    vi.spyOn(api.runtimeWorkflows, 'children').mockResolvedValue({
      items: [
        { runtimeLabel: 'RW-2', workCenterPath: 'Line A', workflowName: 'Mix', workflowVersion: '1.0.0', workflowState: null, createdAt: null, state: 'running', open: { kind: 'live', id: 'c1' } },
        { runtimeLabel: 'RW-3', workCenterPath: 'Line A', workflowName: 'Mix', workflowVersion: '1.0.0', workflowState: null, createdAt: null, state: 'completed', open: { kind: 'history', id: 'h1' } },
      ],
      total: 2,
    });
    vi.spyOn(historyApi.runtimeHistory, 'detail').mockResolvedValue({
      id: 'h1', workflowInstanceId: null, workCenterId: 'wc1', workCenterName: 'Line A', runtimeNumber: 3, runtimeLabel: 'RW-3',
      masterName: 'Mix', masterOid: 'o', masterVersion: '1.0.0', masterState: 'Effective', finalState: 'completed',
      startedAt: null, finishedAt: '2026-08-27T00:00:00Z', createdAt: '2026-08-27T00:00:00Z',
      startingParams: null, trace: [], properties: null, stepParams: null, stepNames: null, signatures: [], stepRuns: [], startedByLoginName: null, startedByUserId: null, userNames: {},
      createdByLabel: null, createdByInstanceId: null, outputs: null,
    });
    render(<RuntimeWorkflowDetail />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open RW-3' }));
    expect(await screen.findByText('Details for a completed runtime workflow.')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Open RW-2' }));
    expect(useSelectionStore.getState().activeHierarchy).toBe('runtime');
    expect(useSelectionStore.getState().selectedRuntimeWorkflowId).toBe('c1');
  });
});
