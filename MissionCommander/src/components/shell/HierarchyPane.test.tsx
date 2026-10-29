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
import { useSelectionStore } from '@/stores/selectionStore';
import { usePrincipalStore } from '@/stores/principalStore';
import * as workflowsApi from '@/lib/api/workflows';
import * as environmentsApi from '@/lib/api/environments';
import * as runtimeHistoryApi from '@/lib/api/runtime-history';
import * as runtimeWorkflowsApi from '@/lib/api/runtime-workflows';
import * as workCentersApi from '@/lib/api/work-centers';
import * as systemSettingsApi from '@/lib/api/system-settings';
import { HierarchyPane } from './HierarchyPane';
import { DetailPanel } from './DetailPanel';

const wf = {
  id: 'wf1', oid: 'o', name: 'Mix', workCenterId: 'wc1', workCenterName: 'Line 1',
  version: '2', state: 'released', effectiveFrom: null, dispatchPolicy: null, autoClaim: null, typeName: null,
  sourceLibraryName: null, sourceLibraryOid: null,
};
const env = {
  id: 'e1', oid: 'o', name: 'Kitchen', workCenterId: 'wc1', workCenterName: 'Line 1',
  version: '1', state: 'released', effectiveFrom: null,
  sourceLibraryName: null, sourceLibraryOid: null,
};
const workCenter = {
  id: 'wc1', name: 'Line 1', description: null, parentWorkCenterId: null,
  sortOrder: 0, dispatchPolicy: 'manual', autoClaim: false, runtimeIdTemplate: null, typeName: null, createdAt: '', updatedAt: '',
};

beforeEach(() => {
  usePrincipalStore.getState().setPrincipal({ id: 's', email: '', loginName: 'admin', displayName: 'S', accessLevel: 'steward', isAdministrator: false, rights: ['workflow:read', 'environment:read'], missionSystemCommanderOf: [] });
  useSelectionStore.setState({ selectedWorkflowId: null, selectedEnvironmentId: null });
  vi.spyOn(workflowsApi.workflows, 'list').mockResolvedValue({ workflows: [] });
  vi.spyOn(environmentsApi.environments, 'list').mockResolvedValue({ environments: [] });
  vi.spyOn(runtimeWorkflowsApi.runtimeWorkflows, 'activeTree').mockResolvedValue({ nodes: [], runtimeWorkflows: [] });
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

describe('shell wiring for the artifact hierarchies', () => {
  it('mounts the WorkflowTree when the workflow hierarchy is active', async () => {
    useSelectionStore.setState({ activeHierarchy: 'workflow' });
    render(<HierarchyPane />);
    expect(await screen.findByText('Workflows')).toBeInTheDocument();
  });

  it('mounts the EnvironmentTree when the environment hierarchy is active', async () => {
    useSelectionStore.setState({ activeHierarchy: 'environment' });
    render(<HierarchyPane />);
    expect(await screen.findByText('Environments')).toBeInTheDocument();
  });

  // Runtime (spec 2026-08-27): a real tree in the pane; detail prompts for a selection.
  it('mounts the RuntimeWorkflowTree when the runtime hierarchy is active', async () => {
    useSelectionStore.setState({ activeHierarchy: 'runtime' });
    render(<HierarchyPane />);
    expect(await screen.findByText('Runtime')).toBeInTheDocument();
  });
  it('the detail panel prompts for a runtime selection', () => {
    useSelectionStore.setState({ activeHierarchy: 'runtime', selectedRuntimeWorkflowId: null });
    render(<DetailPanel />);
    expect(screen.getByText('Select a runtime workflow')).toBeInTheDocument();
  });

  it('the detail panel prompts for a selection in each artifact hierarchy', () => {
    useSelectionStore.setState({ activeHierarchy: 'workflow', selectedWorkflowId: null });
    const { rerender } = render(<DetailPanel />);
    expect(screen.getByText('Select a workflow')).toBeInTheDocument();
    useSelectionStore.setState({ activeHierarchy: 'environment', selectedEnvironmentId: null });
    rerender(<DetailPanel />);
    expect(screen.getByText('Select an environment')).toBeInTheDocument();
  });

  it('mounts WorkflowDetail when a workflow is selected', async () => {
    vi.spyOn(workflowsApi.workflows, 'get').mockResolvedValue({
      workflow: wf, workCenter, environments: [],
    });
    // WorkflowDetail's diagram fetch now lives in a DiagramTab child mounted only inside
    // TabsContent value="diagram" (Radix unmounts inactive content), so it never fires here —
    // this test never opens that tab, and defaults to the overview tab.
    useSelectionStore.setState({ activeHierarchy: 'workflow', selectedWorkflowId: 'wf1' });
    render(<DetailPanel />);
    expect(await screen.findByRole('heading', { name: 'Mix' })).toBeInTheDocument();
  });

  // Mirrors the WorkflowDetail case above for the environment branch (DetailPanel.tsx) —
  // without this, a copy-paste regression there (e.g. a swapped selector) would not be
  // caught, since the test above only ever exercises the workflow ternary.
  it('mounts EnvironmentDetail when an environment spec is selected', async () => {
    vi.spyOn(environmentsApi.environments, 'get').mockResolvedValue({
      environmentSpec: env, workCenter, workflows: [], actions: [], actionServers: [], binding: null,
    });
    useSelectionStore.setState({ activeHierarchy: 'environment', selectedEnvironmentId: 'e1' });
    render(<DetailPanel />);
    expect(await screen.findByRole('heading', { name: 'Kitchen' })).toBeInTheDocument();
  });

  it('renders no library pane for any surviving hierarchy', () => {
    // The Libraries hierarchy is retired outright (spec §9) — no tree, no detail panel, and
    // no residual branch that could render one.
    for (const h of ['work_center', 'user', 'workflow', 'role', 'environment', 'runtime', 'history', 'settings'] as const) {
      useSelectionStore.setState({ activeHierarchy: h });
      const { container, unmount } = render(<HierarchyPane />);
      expect(container.textContent ?? '').not.toMatch(/librar/i);
      unmount();
    }
  });

  // Task 8: History has no tree of its own (it's a cross-work-center page) — the pane is
  // just a short caption, with the actual content living in DetailPanel's HistoryPage.
  it('renders a caption, not a tree, for the history hierarchy', () => {
    useSelectionStore.setState({ activeHierarchy: 'history' });
    render(<HierarchyPane />);
    expect(screen.getByText('Execution history across all work centers')).toBeInTheDocument();
  });

  // History has no per-row selection to gate on (unlike workflow/environment above) — it
  // renders unconditionally, so this pins the DetailPanel wiring rather than a ternary branch.
  it('mounts HistoryPage when the history hierarchy is active', async () => {
    vi.spyOn(runtimeHistoryApi.runtimeHistory, 'listAll').mockResolvedValue({ history: [], total: 0, page: 1, pageSize: 50 });
    vi.spyOn(workCentersApi.workCenters, 'list').mockResolvedValue({ nodes: [] });
    useSelectionStore.setState({ activeHierarchy: 'history' });
    render(<DetailPanel />);
    expect(await screen.findByText('No history')).toBeInTheDocument();
  });

  // action-matching-mode spec (2026-08-20): Settings has no tree of its own (it's a
  // system-wide page) — the pane is just a short caption, mirroring History above.
  it('renders a caption, not a tree, for the settings hierarchy', () => {
    useSelectionStore.setState({ activeHierarchy: 'settings' });
    render(<HierarchyPane />);
    expect(screen.getByText('System-wide configuration')).toBeInTheDocument();
  });

  // Settings has no per-row selection to gate on (like History) — it renders
  // unconditionally, so this pins the DetailPanel wiring rather than a ternary branch.
  it('mounts SettingsPanel when the settings hierarchy is active', async () => {
    vi.spyOn(systemSettingsApi.systemSettings, 'get').mockResolvedValue({ actionMatching: 'loose', actionServerTrust: 'strict', actionServerAllowlist: [] });
    useSelectionStore.setState({ activeHierarchy: 'settings' });
    render(<DetailPanel />);
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });
});
