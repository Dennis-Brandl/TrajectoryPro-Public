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

import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from '@/stores/flowStore'
import type { WorkflowNode } from '@/types/nodes'

const node = (id: string, label: string): WorkflowNode =>
  ({
    id,
    type: 'actionProxyWait',
    position: { x: 0, y: 0 },
    data: { label, stepType: 'actionProxyWait', outputs: [] },
  }) as WorkflowNode

beforeEach(() => {
  useFlowStore.setState({ nodes: [node('a', 'A'), node('b', 'B')], edges: [], nodeDataRevision: 0 })
  useFlowStore.temporal.getState().clear()
})

describe('flowStore.updateNodesData (spec 2026-09-04 §6.4.3)', () => {
  it('merges data into every listed node in one set and bumps nodeDataRevision once', () => {
    useFlowStore.getState().updateNodesData([
      { id: 'a', data: { outputs: [{ id: 'o1', name: 'done' }] } },
      { id: 'b', data: { label: 'B2' } },
    ])
    const s = useFlowStore.getState()
    expect(s.nodes[0].data.outputs).toEqual([{ id: 'o1', name: 'done' }])
    expect(s.nodes[0].data.label).toBe('A')
    expect(s.nodes[1].data.label).toBe('B2')
    expect(s.nodeDataRevision).toBe(1)
  })

  it('is a no-op for an empty list', () => {
    const before = useFlowStore.getState().nodes
    useFlowStore.getState().updateNodesData([])
    expect(useFlowStore.getState().nodes).toBe(before)
    expect(useFlowStore.getState().nodeDataRevision).toBe(0)
  })

  it('undo after updateNodesData restores the nodes AND bumps nodeDataRevision', () => {
    useFlowStore.getState().updateNodesData([{ id: 'a', data: { outputs: [{ id: 'o1', name: 'done' }] } }])
    const revisionAfterUpdate = useFlowStore.getState().nodeDataRevision
    expect(revisionAfterUpdate).toBe(1)

    useFlowStore.temporal.getState().undo()

    const s = useFlowStore.getState()
    expect(s.nodes[0].data.outputs).toEqual([])
    expect(s.nodeDataRevision).toBeGreaterThan(revisionAfterUpdate)
  })

  it('redo bumps nodeDataRevision again and re-applies the update', () => {
    useFlowStore.getState().updateNodesData([{ id: 'a', data: { outputs: [{ id: 'o1', name: 'done' }] } }])
    useFlowStore.temporal.getState().undo()
    const revisionAfterUndo = useFlowStore.getState().nodeDataRevision

    useFlowStore.temporal.getState().redo()

    const s = useFlowStore.getState()
    expect(s.nodes[0].data.outputs).toEqual([{ id: 'o1', name: 'done' }])
    expect(s.nodeDataRevision).toBeGreaterThan(revisionAfterUndo)
  })
})
