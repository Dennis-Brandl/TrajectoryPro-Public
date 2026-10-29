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

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { OutdatedActionsChip } from '@/components/canvas/OutdatedActionsChip'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { computeActionSyncState } from '@/lib/action-proxy/sync-state'
import type { Library, Specification } from '@/types/library'
import type { StepNodeData, WorkflowNode } from '@/types/nodes'

vi.mock('@/hooks/useCanEditActiveSpec', () => ({ useCanEditActiveSpec: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/lib/action-proxy/sync-state', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/action-proxy/sync-state')>()
  return { ...mod, computeActionSyncState: vi.fn(mod.computeActionSyncState) }
})

const spec = (id: string, libraryId: string, name: string, data: Record<string, unknown>): Specification =>
  ({
    id,
    libraryId,
    name,
    version: '1.0.0',
    state: 'Draft',
    data,
    history: [],
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as Specification
const proxy = (id: string, outputs: StepNodeData['outputs']): WorkflowNode =>
  ({
    id,
    type: 'actionProxyWait',
    position: { x: 0, y: 0 },
    data: {
      label: 'Run PreheatOven',
      stepType: 'actionProxyWait',
      actionName: 'PreheatOven',
      actionLibraryName: 'Kitchen Actions',
      inputs: [],
      outputs,
    },
  }) as WorkflowNode
const fetchSpecifications = vi.fn(async () => {})

beforeEach(() => {
  vi.mocked(useCanEditActiveSpec).mockReturnValue(true)
  fetchSpecifications.mockClear()
  vi.mocked(computeActionSyncState).mockClear()
  useLibraryStore.setState({
    libraries: [
      { id: 'wf-lib-1', name: 'Workflows', entityType: 'workflow' } as unknown as Library,
      { id: 'action-lib-1', name: 'Kitchen Actions', entityType: 'action' } as unknown as Library,
      { id: 'env-lib-1', name: 'Environments', entityType: 'environment' } as unknown as Library,
    ],
    selectedLibraryId: 'wf-lib-1',
    selectedSpecificationId: 'wf-1',
    specifications: new Map([
      ['wf-lib-1', [spec('wf-1', 'wf-lib-1', 'WF', { environmentSpecIds: ['env-1'] })]],
      [
        'action-lib-1',
        [spec('act-1', 'action-lib-1', 'PreheatOven', { inputs: [], outputs: [{ id: 'o1', name: 'reached' }] })],
      ],
      [
        'env-lib-1',
        [
          spec('env-1', 'env-lib-1', 'Kitchen', {
            included_actions: [{ action_name: 'PreheatOven', action_library: 'Kitchen Actions' }],
          }),
        ],
      ],
    ]),
    fetchSpecifications,
  })
  useFlowStore.setState({
    nodes: [proxy('stale-1', []), proxy('fresh', [{ id: 'o1', name: 'reached' }]), proxy('stale-2', [])],
    edges: [],
    nodeDataRevision: 0,
    hydratedSpecId: null,
  })
})

describe('OutdatedActionsChip (spec 2026-09-04 §6.4.3)', () => {
  it('counts outdated ACTION PROXY steps and updates them all in one bulk write', () => {
    render(<OutdatedActionsChip />)
    expect(screen.getByTestId('outdated-actions-chip').textContent).toContain(
      '2 steps with outdated action definitions',
    )
    fireEvent.click(screen.getByTestId('action-sync-update-all'))
    const s = useFlowStore.getState()
    expect((s.nodes[0].data as StepNodeData).outputs).toEqual([{ id: 'o1', name: 'reached' }])
    expect((s.nodes[2].data as StepNodeData).outputs).toEqual([{ id: 'o1', name: 'reached' }])
    expect(s.nodeDataRevision).toBe(1)
    expect(screen.queryByTestId('outdated-actions-chip')).toBeNull()
  })

  it('uses the singular for one step and disables the button when the spec is not editable', () => {
    vi.mocked(useCanEditActiveSpec).mockReturnValue(false)
    useFlowStore.setState({ nodes: [proxy('stale-1', [])] })
    render(<OutdatedActionsChip />)
    expect(screen.getByTestId('outdated-actions-chip').textContent).toContain('1 step with outdated action definitions')
    expect((screen.getByTestId('action-sync-update-all') as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders nothing when every step is synced, and loads unloaded action libraries', () => {
    useLibraryStore.setState({ specifications: new Map(useLibraryStore.getState().specifications) })
    useFlowStore.setState({ nodes: [proxy('fresh', [{ id: 'o1', name: 'reached' }])] })
    const { container } = render(<OutdatedActionsChip />)
    expect(container.firstChild).toBeNull()
    const specs = new Map(useLibraryStore.getState().specifications)
    specs.delete('action-lib-1')
    act(() => {
      useLibraryStore.setState({ specifications: specs })
    })
    render(<OutdatedActionsChip />)
    expect(fetchSpecifications).toHaveBeenCalledWith('action-lib-1')
  })

  it('a position-only node change does not rescan', () => {
    useFlowStore.setState({ nodes: [proxy('stale-1', [])] })
    render(<OutdatedActionsChip />)
    expect(screen.getByTestId('outdated-actions-chip').textContent).toContain('1 step with outdated action definitions')
    const callsBefore = vi.mocked(computeActionSyncState).mock.calls.length

    act(() => {
      useFlowStore.getState().onNodesChange([{ type: 'position', id: 'stale-1', position: { x: 10, y: 10 } }])
    })

    expect(vi.mocked(computeActionSyncState).mock.calls.length).toBe(callsBefore)
    expect(screen.getByTestId('outdated-actions-chip').textContent).toContain('1 step with outdated action definitions')
  })
})
