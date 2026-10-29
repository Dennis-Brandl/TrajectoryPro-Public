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

// Regression: deleting an embedded sub-workflow proxy node must delete the child
// specification it owns (and that child's embedded descendants), not orphan it.
// Reference-mode proxies point at a spec owned elsewhere and must be left alone.

import { describe, it, expect, beforeEach } from 'vitest'
import type { NodeChange } from '@xyflow/react'
import { useFlowStore } from '@/stores/flowStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import type { Specification } from '@/stores/specificationStore/types'
import type { WorkflowNode } from '@/types/nodes'

/** Seed a SAVED spec (placed directly in the specs map → not unsavedNewIds). */
function seedSpec(id: string, parentId: string | null = null): void {
  useSpecificationStore.setState((s) => {
    const spec: Specification = {
      id,
      parentSpecificationId: parentId,
      rootSpecificationId: parentId ?? id,
      libraryId: 'lib-1',
      name: id,
      description: null,
      typeName: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [] },
      dataSchemaVersion: 3,
      history: [],
      createdAt: 0,
      updatedAt: 0,
      lastEditedByUserId: null,
    }
    s.specs.set(id, spec)
  })
}

function embeddedProxyNode(id: string, childSpecId: string): WorkflowNode {
  return {
    id,
    type: 'workflowProxy',
    position: { x: 0, y: 0 },
    data: {
      label: childSpecId,
      stepType: 'workflowProxy',
      subWorkflowMode: 'embedded',
      embeddedWorkflowSpecId: childSpecId,
    },
    selected: true,
  }
}

function referenceProxyNode(id: string, refSpecId: string): WorkflowNode {
  return {
    id,
    type: 'workflowProxy',
    position: { x: 0, y: 0 },
    data: {
      label: refSpecId,
      stepType: 'workflowProxy',
      subWorkflowMode: 'reference',
      referencedStepSpecId: refSpecId,
    },
    selected: true,
  }
}

beforeEach(() => {
  useSpecificationStore.getState()._reset()
  useFlowStore.setState({ nodes: [], edges: [], hydratedSpecId: null })
  useFlowStore.temporal.getState().clear()
})

describe('deleting an embedded sub-workflow proxy node deletes its child spec', () => {
  it('deleteSelectedNodes cascades the embedded child + descendants into pendingDeletes', () => {
    // Saved embedded subtree: child C (of open parent P) → grandchild G.
    seedSpec('C', 'P')
    seedSpec('G', 'C')
    useFlowStore.setState({ nodes: [embeddedProxyNode('node-C', 'C')] })

    useFlowStore.getState().deleteSelectedNodes()

    const pending = useSpecificationStore.getState().pendingDeletes
    expect(pending.has('C'), 'embedded child marked for deletion').toBe(true)
    expect(pending.has('G'), 'embedded grandchild cascade-deleted').toBe(true)
  })

  it('the Delete-key path (onNodesChange remove) also cascades the child spec', () => {
    seedSpec('C', 'P')
    useFlowStore.setState({ nodes: [embeddedProxyNode('node-C', 'C')] })

    useFlowStore.getState().onNodesChange([{ type: 'remove', id: 'node-C' } as NodeChange<WorkflowNode>])

    expect(useSpecificationStore.getState().pendingDeletes.has('C')).toBe(true)
  })

  it('does NOT delete the target of a reference-mode proxy node', () => {
    seedSpec('R') // a referenced spec owned elsewhere
    useFlowStore.setState({ nodes: [referenceProxyNode('node-R', 'R')] })

    useFlowStore.getState().deleteSelectedNodes()

    expect(useSpecificationStore.getState().pendingDeletes.has('R'), 'referenced spec untouched').toBe(false)
  })
})
