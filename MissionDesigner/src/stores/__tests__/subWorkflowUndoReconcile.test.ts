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

// The undo/redo reconcile diff: comparing the embedded sub-workflow proxy set
// before vs after an undo/redo, it deletes subtrees whose proxy vanished and
// restores subtrees whose proxy reappeared. Reference proxies are ignored.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/stores/specificationStore/saveScheduler', () => ({
  scheduleFlush: vi.fn(),
  cancelFlush: vi.fn(),
  hasPendingFlush: () => false,
  flushNow: vi.fn(),
}))

import { useSpecificationStore } from '@/stores/specificationStore'
import { reconcileSubWorkflowSpecsBetween } from '@/stores/flowStore'
import { clearSubWorkflowUndoBuffer } from '@/stores/specificationStore/subWorkflowUndo'
import type { WorkflowNode } from '@/types/nodes'
import type { Specification } from '@/stores/specificationStore/types'

function seedSavedSpec(id: string, parentId: string | null = null): void {
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

function embeddedProxy(id: string, childSpecId: string): WorkflowNode {
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
  }
}

function referenceProxy(id: string, refSpecId: string): WorkflowNode {
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
  }
}

beforeEach(() => {
  useSpecificationStore.getState()._reset()
  clearSubWorkflowUndoBuffer()
})

describe('reconcileSubWorkflowSpecsBetween', () => {
  it('deletes the subtree of an embedded proxy that disappeared', () => {
    seedSavedSpec('C', 'P')
    seedSavedSpec('G', 'C')

    reconcileSubWorkflowSpecsBetween([embeddedProxy('n', 'C')], [])

    const s = useSpecificationStore.getState()
    expect(s.pendingDeletes.has('C')).toBe(true)
    expect(s.pendingDeletes.has('G')).toBe(true)
  })

  it('restores the subtree of an embedded proxy that reappeared', () => {
    seedSavedSpec('C', 'P')
    seedSavedSpec('G', 'C')

    // delete (buffers the subtree), then restore
    reconcileSubWorkflowSpecsBetween([embeddedProxy('n', 'C')], [])
    reconcileSubWorkflowSpecsBetween([], [embeddedProxy('n', 'C')])

    const s = useSpecificationStore.getState()
    expect(s.pendingDeletes.has('C')).toBe(false)
    expect(s.pendingDeletes.has('G')).toBe(false)
    expect(s.specs.has('C')).toBe(true)
  })

  it('ignores reference-mode proxies', () => {
    seedSavedSpec('R')
    reconcileSubWorkflowSpecsBetween([referenceProxy('n', 'R')], [])
    expect(useSpecificationStore.getState().pendingDeletes.has('R')).toBe(false)
  })

  it('is a no-op when the embedded set is unchanged', () => {
    seedSavedSpec('C', 'P')
    const nodes = [embeddedProxy('n', 'C')]
    reconcileSubWorkflowSpecsBetween(nodes, nodes)
    expect(useSpecificationStore.getState().pendingDeletes.has('C')).toBe(false)
  })
})
