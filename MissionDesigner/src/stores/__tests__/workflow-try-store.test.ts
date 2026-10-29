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

import { describe, expect, test, beforeEach } from 'vitest'
import { useFlowStore } from '@/stores/flowStore'
import { resetFlowStore } from '@/test-utils/store-helpers'
import type { WorkflowNode } from '@/types/nodes'

const catchNode = (id: string, catchId: string): WorkflowNode =>
  ({
    id,
    type: 'catch',
    position: { x: 0, y: 0 },
    data: { label: id, stepType: 'catch', catchId },
  }) as unknown as WorkflowNode

describe('workflowTrySpecifications', () => {
  beforeEach(() => resetFlowStore())

  test('setter stores rows', () => {
    useFlowStore.getState().setWorkflowTrySpecifications([{ mode: 'ERROR', catch_id: 'C1', release_on_catch: true }])
    expect(useFlowStore.getState().workflowTrySpecifications).toEqual([
      { mode: 'ERROR', catch_id: 'C1', release_on_catch: true },
    ])
  })

  test('renameCatchId rewrites workflow-level rows in the same update', () => {
    useFlowStore.setState({ nodes: [catchNode('n1', 'C1')] })
    useFlowStore.getState().setWorkflowTrySpecifications([
      { mode: 'ERROR', catch_id: 'C1' },
      { mode: 'TIMEOUT', catch_id: 'OTHER' },
    ])
    useFlowStore.getState().renameCatchId('C1', 'C9')
    expect(useFlowStore.getState().workflowTrySpecifications).toEqual([
      { mode: 'ERROR', catch_id: 'C9' },
      { mode: 'TIMEOUT', catch_id: 'OTHER' },
    ])
    expect((useFlowStore.getState().nodes[0].data as { catchId?: string }).catchId).toBe('C9')
  })
})
