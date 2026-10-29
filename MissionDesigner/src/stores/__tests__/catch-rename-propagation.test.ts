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
import { useFlowStore } from '../flowStore'
import type { WorkflowNode } from '@/types/nodes'

describe('renameCatchId propagation', () => {
  beforeEach(() => {
    useFlowStore.setState({
      nodes: [
        {
          id: 'a1',
          type: 'actionProxyWait',
          position: { x: 0, y: 0 },
          data: {
            label: 'A',
            stepType: 'actionProxyWait',
            trySpecifications: [{ mode: 'ERROR', catch_id: 'OldId', release_on_catch: true }],
          },
        },
        {
          id: 'c1',
          type: 'catch',
          position: { x: 0, y: 0 },
          data: { label: 'C', stepType: 'catch', catchId: 'OldId' },
        },
      ] as unknown as WorkflowNode[],
      edges: [],
    })
  })
  it('renames the CATCH and every referencing TRY', () => {
    useFlowStore.getState().renameCatchId('OldId', 'NewId')
    const nodes = useFlowStore.getState().nodes
    expect((nodes.find((n) => n.id === 'c1')!.data as { catchId: string }).catchId).toBe('NewId')
    expect(
      (nodes.find((n) => n.id === 'a1')!.data as { trySpecifications: Array<{ catch_id: string }> })
        .trySpecifications[0].catch_id,
    ).toBe('NewId')
  })
  it('no-ops when oldId === newId', () => {
    const before = useFlowStore.getState().nodes
    useFlowStore.getState().renameCatchId('OldId', 'OldId')
    expect(useFlowStore.getState().nodes).toBe(before)
  })
})
