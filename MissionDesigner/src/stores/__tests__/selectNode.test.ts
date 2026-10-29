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

import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from '@/stores/flowStore'
import type { WorkflowNode } from '@/types/nodes'

describe('selectNode', () => {
  beforeEach(() => {
    useFlowStore.setState({
      nodes: [
        { id: 'a', type: 'start', position: { x: 0, y: 0 }, data: { label: 'A' }, selected: true },
        { id: 'b', type: 'catch', position: { x: 0, y: 0 }, data: { label: 'B' }, selected: false },
        { id: 'c', type: 'end', position: { x: 0, y: 0 }, data: { label: 'C' }, selected: false },
      ] as unknown as WorkflowNode[],
    })
  })

  it('selects the target node and deselects all others', () => {
    useFlowStore.getState().selectNode('b')
    const nodes = useFlowStore.getState().nodes
    expect(nodes.find((n) => n.id === 'a')!.selected).toBe(false)
    expect(nodes.find((n) => n.id === 'b')!.selected).toBe(true)
    expect(nodes.find((n) => n.id === 'c')!.selected).toBe(false)
  })
})
