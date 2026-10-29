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
import * as workflowsApi from '@/lib/api/workflows';
import { WorkflowTree } from './WorkflowTree';

const wf = (id: string, name: string, workCenterId: string, workCenterName: string, state = 'Effective', version = '1.0.0') =>
  ({ id, oid: `o-${id}`, name, workCenterId, workCenterName, version, state, effectiveFrom: null,
     dispatchPolicy: null, autoClaim: null, typeName: null, sourceLibraryName: null, sourceLibraryOid: null });

beforeEach(() => {
  usePrincipalStore.getState().clearPrincipal();
  useSelectionStore.setState({ selectedWorkflowId: null });
  vi.spyOn(workflowsApi.workflows, 'list').mockResolvedValue({
    workflows: [wf('w1', 'Bake', 'wc2', 'Line 2'), wf('w2', 'Mix', 'wc1', 'Line 1', 'Draft')],
  });
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

const steward = { id: 's', email: '', loginName: 'admin', displayName: 'S', accessLevel: 'steward', isAdministrator: false, rights: ['workflow:read', 'workflow:create'], missionSystemCommanderOf: [] };

describe('WorkflowTree', () => {
  it('groups entries under work-center headers ordered by name, labelled "Name v<version>" with a state badge', async () => {
    usePrincipalStore.getState().setPrincipal(steward);
    render(<WorkflowTree />);

    // Work-center headers, name-ordered: Line 1 before Line 2.
    const headers = await screen.findAllByRole('heading', { level: 3 });
    expect(headers.map((h) => h.textContent)).toEqual(['Line 1', 'Line 2']);

    // Leaf label carries name, version and state.
    expect(screen.getByRole('button', { name: /Bake v1\.0\.0/ })).toHaveTextContent('Effective');
    expect(screen.getByRole('button', { name: /Mix v1\.0\.0/ })).toHaveTextContent('Draft');
  });

  it('shows the root workflow type after name and version', async () => {
    usePrincipalStore.getState().setPrincipal(steward);
    vi.mocked(workflowsApi.workflows.list).mockResolvedValue({ workflows: [
      { ...wf('a', 'Clean Tank', 'wc1', 'Line 1'), typeName: 'Operation' },
    ] });
    render(<WorkflowTree />);
    const btn = await screen.findByRole('button', { name: /Clean Tank/ });
    expect(btn.textContent).toContain('Clean Tank v1.0.0 · Operation');
  });

  it('keeps two work centers holding the same artifact separate', async () => {
    // Same oid loaded into two work centers is two INDEPENDENT entries (spec D3) — they
    // must never be merged into one group.
    usePrincipalStore.getState().setPrincipal(steward);
    vi.mocked(workflowsApi.workflows.list).mockResolvedValue({ workflows: [
      wf('a', 'Bottle Fill', 'wc1', 'Line 1'),
      wf('b', 'Bottle Fill', 'wc2', 'Line 2', 'Draft', '2.0.0'),
    ] });
    render(<WorkflowTree />);
    const headers = await screen.findAllByRole('heading', { level: 3 });
    expect(headers.map((h) => h.textContent)).toEqual(['Line 1', 'Line 2']);
    expect(screen.getByRole('button', { name: /Bottle Fill v1\.0\.0/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bottle Fill v2\.0\.0/ })).toBeInTheDocument();
  });

  it('shows two entries of the same name at different versions adjacently, ungrouped', async () => {
    // Entries are FLAT: M6 retired lineage grouping, because copies of one workflow are
    // independent entries with no lineage to express. The old LineageGroup rendered a
    // collapsible parent around same-oid rows; a surviving wrapper would show up here as
    // a differing parent element between the two leaves.
    usePrincipalStore.getState().setPrincipal(steward);
    vi.mocked(workflowsApi.workflows.list).mockResolvedValue({ workflows: [
      wf('a', 'Bake', 'wc1', 'Line 1', 'Effective', '1.0.0'),
      wf('b', 'Bake', 'wc1', 'Line 1', 'Draft', '2.0.0'),
    ] });
    render(<WorkflowTree />);

    const first = await screen.findByRole('button', { name: /Bake v1\.0\.0/ });
    const second = screen.getByRole('button', { name: /Bake v2\.0\.0/ });
    expect(first.parentElement).toBe(second.parentElement);
    // No collapsible lineage parent, and no "(2 versions)" affordance.
    expect(screen.queryByRole('button', { name: /\(2 versions\)/ })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
  });

  it('does not show the empty state while still loading', async () => {
    usePrincipalStore.getState().setPrincipal(steward);
    let resolve!: (v: { workflows: [] }) => void;
    vi.spyOn(workflowsApi.workflows, 'list').mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<WorkflowTree />);

    // The fetch is in flight: the empty state must not render yet. Without the null-vs-[]
    // discriminator this fails — items would start as [] and the empty state would render
    // immediately, before the fetch resolves.
    expect(screen.queryByText('No workflows loaded')).not.toBeInTheDocument();
    resolve({ workflows: [] });
    expect(await screen.findByText('No workflows loaded')).toBeInTheDocument();
  });

  it('selects a workflow on click', async () => {
    usePrincipalStore.getState().setPrincipal(steward);
    render(<WorkflowTree />);
    await userEvent.click(await screen.findByRole('button', { name: /Bake v1\.0\.0/ }));
    expect(useSelectionStore.getState().selectedWorkflowId).toBe('w1');
  });

  it('has no Import or Pull control — loading happens on the work center', async () => {
    usePrincipalStore.getState().setPrincipal(steward);
    render(<WorkflowTree />);
    await screen.findByRole('button', { name: /Bake v1\.0\.0/ });
    expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pull/i })).toBeNull();
  });

  it('surfaces a load failure instead of rendering an empty tree', async () => {
    usePrincipalStore.getState().setPrincipal(steward);
    vi.spyOn(workflowsApi.workflows, 'list').mockRejectedValue(new Error('boom'));
    render(<WorkflowTree />);
    expect(await screen.findByText('Failed to load workflows')).toBeInTheDocument();
  });
});
