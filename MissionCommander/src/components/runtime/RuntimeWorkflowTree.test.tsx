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
import { useSelectionStore } from '@/stores/selectionStore';
import * as api from '@/lib/api/runtime-workflows';
import { RuntimeWorkflowTree } from './RuntimeWorkflowTree';

const NODES = [
  { id: 'wc1', name: 'Plant', parentWorkCenterId: null, depth: 0, typeName: null },
  { id: 'wc2', name: 'Line 1', parentWorkCenterId: 'wc1', depth: 1, typeName: null },
];
const LEAVES = [
  { id: 'rw1', workCenterId: 'wc2', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001', masterName: 'Mix', masterVersion: '1.0.0', status: 'running' as const },
  { id: 'rw2', workCenterId: 'wc2', runtimeNumber: 2, runtimeLabel: 'BLEND-20261007-002', masterName: 'Fill', masterVersion: '1.0.0', status: 'paused' as const },
];

beforeEach(() => {
  useSelectionStore.setState({ activeHierarchy: 'runtime', selectedRuntimeWorkflowId: null });
  vi.spyOn(api.runtimeWorkflows, 'activeTree').mockResolvedValue({ nodes: NODES, runtimeWorkflows: LEAVES });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('RuntimeWorkflowTree', () => {
  it('renders the recursive WC tree with active leaves, and an em-dash for an empty center', async () => {
    render(<RuntimeWorkflowTree />);
    expect(await screen.findByText('Plant')).toBeInTheDocument();
    expect(screen.getByText('Line 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /MIX-20261007-001 · Mix/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /BLEND-20261007-002 · Fill/ })).toBeInTheDocument();
    // Plant has zero own leaves — the muted em-dash line marks it (spec §4.2).
    expect(screen.getByLabelText('No active runtime workflows in Plant')).toBeInTheDocument();
  });

  it('shows a per-center count chip and selects a leaf into the store', async () => {
    render(<RuntimeWorkflowTree />);
    expect(await screen.findByTitle('2 active runtime workflows')).toHaveTextContent('2');
    await userEvent.click(screen.getByRole('button', { name: /MIX-20261007-001 · Mix/ }));
    expect(useSelectionStore.getState().selectedRuntimeWorkflowId).toBe('rw1');
  });

  it('collapse hides a center’s leaves', async () => {
    render(<RuntimeWorkflowTree />);
    await screen.findByText('Line 1');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Line 1' }));
    expect(screen.queryByRole('button', { name: /MIX-20261007-001 · Mix/ })).toBeNull();
  });
});
