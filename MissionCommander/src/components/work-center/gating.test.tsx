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
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePrincipalStore } from '@/stores/principalStore';
import { useSelectionStore } from '@/stores/selectionStore';
import * as wc from '@/lib/api/work-centers';
import { WorkCenterDetail } from './WorkCenterDetail';
import { WorkCenterTree } from './WorkCenterTree';
import type { WorkCenterView } from '@/lib/api/types';

const VIEW = {
  workCenter: { id: 'w1', name: 'A', description: null, parentWorkCenterId: null, sortOrder: 0, dispatchPolicy: 'least_queued_steps', autoClaim: false, runtimeIdTemplate: null, typeName: null, createdAt: '', updatedAt: '' },
  subtree: [],
  workflows: [{ id: 'wf1', oid: 'o', name: 'Mix', workCenterId: 'w1', workCenterName: 'A', version: '1.0.0', state: 'effective', effectiveFrom: null, dispatchPolicy: null, autoClaim: null, typeName: null, sourceLibraryName: null, sourceLibraryOid: null, allowedRoleCount: 0 }],
  users: [], environments: [], roles: [],
} satisfies WorkCenterView;
beforeEach(() => {
  useSelectionStore.setState({ selectedWorkCenterId: 'w1' });
  usePrincipalStore.getState().clearPrincipal();
  vi.spyOn(wc.workCenters, 'get').mockResolvedValue(VIEW);
});
// This config does not enable Vitest globals, so @testing-library/react cannot
// auto-register its afterEach(cleanup). Without this, each render() leaks its DOM
// into document.body and later getByRole calls match duplicates.
afterEach(cleanup);
// vi.spyOn returns the SAME mock instance when re-spying an already-spied method,
// so call counts would accumulate across tests without a restore.
afterEach(() => vi.restoreAllMocks());

describe('capability gating', () => {
  it('a viewer sees Edit/Delete disabled', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: [] });
    render(<WorkCenterDetail />);
    expect(await screen.findByRole('button', { name: /edit/i })).toBeDisabled();
    // Exact string: the workflow rows now carry their own "Delete Mix" trash buttons, so a
    // /delete/i regex would match more than the work center's header Delete.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  // The per-row trash can gates on workflow:delete — independent of the work-center rights
  // that gate the header Delete (work_center:delete) and the row's Roles… (work_center:link).
  it('the per-workflow Delete trash can gates on workflow:delete', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: [] });
    render(<WorkCenterDetail />);
    expect(await screen.findByRole('button', { name: 'Delete Mix' })).toBeDisabled();
    cleanup();
    usePrincipalStore.getState().setPrincipal({ id: 'd', email: '', loginName: 'admin', displayName: 'D', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read', 'workflow:delete'], missionSystemCommanderOf: [] });
    render(<WorkCenterDetail />);
    expect(await screen.findByRole('button', { name: 'Delete Mix' })).toBeEnabled();
  });

  it('an administrator sees them enabled', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'a', email: '', loginName: 'admin', displayName: 'A', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    render(<WorkCenterDetail />);
    expect(await screen.findByRole('button', { name: /edit/i })).toBeEnabled();
  });

  // Pins the rest of the create surface, not just Edit/Delete: a Viewer must see a fully
  // read-only tool, so Load and the per-workflow Roles editor are disabled too. (Child
  // creation lives only on the tree row's ＋ since 2026-09-09 — see WorkCenterTree's tests.)
  // M6 removed the artifact Link/Unlink affordances entirely — loading is the linking step.
  it('a viewer also sees Load and Roles disabled, and no New Child button at all', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: [] });
    render(<WorkCenterDetail />);
    expect(await screen.findByRole('button', { name: /load packages/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /new child/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Roles for Mix' })).toBeDisabled();
  });

  // Pins per-right granularity (not just viewer-vs-admin): a principal holding ONLY
  // work_center:link sees the roles/assign surface enabled while create/edit/delete stay
  // disabled — gating must check each right independently, not collapse to a single
  // "has any right" switch.
  it('a work_center:link-only principal sees Roles enabled but Edit/Delete disabled', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'l', email: '', loginName: 'admin', displayName: 'L', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read', 'work_center:link'], missionSystemCommanderOf: [] });
    render(<WorkCenterDetail />);
    expect(await screen.findByRole('button', { name: /edit/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Roles for Mix' })).toBeEnabled();
  });

  // The Load button gates on workflow:create. The route also demands environment:create,
  // but every tier holding one holds the other (dao/access.ts TIER_RIGHTS), so gating on
  // one can never hide it from a steward who could legitimately load.
  it('a workflow:create-only principal sees Load enabled', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'c', email: '', loginName: 'admin', displayName: 'C', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read', 'workflow:create'], missionSystemCommanderOf: [] });
    render(<WorkCenterDetail />);
    expect(await screen.findByRole('button', { name: /load packages/i })).toBeEnabled();
  });

  // Create Runtime Workflow… is gated on Mission System Commander of THIS work center specifically,
  // not any static access-tier right — a viewer's usual rights don't matter here, only
  // whether they command work center 'w1' (see VIEW above).
  it('a non-commander viewer sees Create Runtime Workflow… disabled', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: [] });
    render(<WorkCenterDetail />);
    expect(await screen.findByRole('button', { name: 'Create runtime workflow from Mix' })).toBeDisabled();
  });

  it('a Mission System Commander of this work center sees Create Runtime Workflow… enabled', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'm', email: '', loginName: 'admin', displayName: 'M', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: ['w1'] });
    render(<WorkCenterDetail />);
    expect(await screen.findByRole('button', { name: 'Create runtime workflow from Mix' })).toBeEnabled();
  });

  it('an administrator sees Create Runtime Workflow… enabled without an explicit commander grant', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'a', email: '', loginName: 'admin', displayName: 'A', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    render(<WorkCenterDetail />);
    expect(await screen.findByRole('button', { name: 'Create runtime workflow from Mix' })).toBeEnabled();
  });

  // The Mission System Commander toggle is gated on work_center:link, same as Assign/Unassign —
  // it is a user-assignment attribute, not a Mission-Commander-only control.
  it('a viewer without work_center:link sees the Mission System Commander toggle disabled', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: [] });
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      ...VIEW,
      users: [{ id: 'u1', email: 'u@x', loginName: 'uma', displayName: 'Uma', status: 'active', accessLevel: 'viewer', missionSystemCommander: false, roles: [] }],
    });
    render(<WorkCenterDetail />);
    await userEvent.click(await screen.findByRole('tab', { name: /users/i }));
    const toggle = await screen.findByRole('checkbox', { name: 'Mission System Commander for Uma' });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('title', 'Requires work_center:link');
  });

  it('a work_center:link principal sees the Mission System Commander toggle enabled', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'l', email: '', loginName: 'admin', displayName: 'L', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read', 'work_center:link'], missionSystemCommanderOf: [] });
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      ...VIEW,
      users: [{ id: 'u1', email: 'u@x', loginName: 'uma', displayName: 'Uma', status: 'active', accessLevel: 'viewer', missionSystemCommander: false, roles: [] }],
    });
    render(<WorkCenterDetail />);
    await userEvent.click(await screen.findByRole('tab', { name: /users/i }));
    expect(await screen.findByRole('checkbox', { name: 'Mission System Commander for Uma' })).toBeEnabled();
  });

  it('a viewer sees the tree "New work center" button disabled', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: [] });
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [] });
    render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
    expect(await screen.findByRole('button', { name: 'New work center' })).toBeDisabled();
  });

  it('an administrator sees the tree "New work center" button enabled', async () => {
    usePrincipalStore.getState().setPrincipal({ id: 'a', email: '', loginName: 'admin', displayName: 'A', accessLevel: 'administrator', isAdministrator: true, rights: [], missionSystemCommanderOf: [] });
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [] });
    render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
    expect(await screen.findByRole('button', { name: 'New work center' })).toBeEnabled();
  });

  it('a viewer without work_center:link sees Edit roles disabled; a work_center:link principal sees it enabled', async () => {
    const member = { id: 'u1', email: 'u@x', loginName: 'uma', displayName: 'Uma', status: 'active', accessLevel: 'viewer', missionSystemCommander: false, roles: [] };
    usePrincipalStore.getState().setPrincipal({ id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read'], missionSystemCommanderOf: [] });
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({ ...VIEW, users: [member] });
    const { unmount } = render(<WorkCenterDetail />);
    await userEvent.click(await screen.findByRole('tab', { name: /users/i }));
    const edit = await screen.findByRole('button', { name: 'Edit roles for Uma' });
    expect(edit).toBeDisabled();
    expect(edit).toHaveAttribute('title', 'Requires work_center:link');
    unmount();

    usePrincipalStore.getState().setPrincipal({ id: 'l', email: '', loginName: 'admin', displayName: 'L', accessLevel: 'viewer', isAdministrator: false, rights: ['work_center:read', 'work_center:link'], missionSystemCommanderOf: [] });
    render(<WorkCenterDetail />);
    await userEvent.click(await screen.findByRole('tab', { name: /users/i }));
    expect(await screen.findByRole('button', { name: 'Edit roles for Uma' })).toBeEnabled();
  });
});
