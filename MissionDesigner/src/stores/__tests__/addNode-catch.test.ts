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

beforeEach(() => {
  useFlowStore.setState({ nodes: [], edges: [] })
})

function add(node: Partial<WorkflowNode> & { id: string; type: string }) {
  useFlowStore
    .getState()
    .addNode({ position: { x: 0, y: 0 }, data: { label: 'X', stepType: node.type }, ...node } as WorkflowNode)
}

describe('addNode CATCH default outputs', () => {
  it('seeds the four named outputs on a new catch node', () => {
    add({ id: 'c1', type: 'catch' })
    const n = useFlowStore.getState().nodes.find((x) => x.id === 'c1')!
    const outs = (n.data as { outputs?: { name: string }[] }).outputs ?? []
    expect(outs.map((o) => o.name)).toEqual(['Message', 'Reason', 'Step', 'StepID'])
  })

  it('does not add outputs to non-catch nodes', () => {
    add({ id: 's1', type: 'actionProxyWait' })
    const n = useFlowStore.getState().nodes.find((x) => x.id === 's1')!
    expect((n.data as { outputs?: unknown[] }).outputs ?? []).toEqual([])
  })

  it('does not overwrite outputs a catch node already has', () => {
    add({
      id: 'c2',
      type: 'catch',
      data: { label: 'C', stepType: 'catch', outputs: [{ id: 'x', name: 'Custom' }] },
    } as never)
    const n = useFlowStore.getState().nodes.find((x) => x.id === 'c2')!
    expect((n.data as { outputs: { name: string }[] }).outputs.map((o) => o.name)).toEqual(['Custom'])
  })
})
