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
import { useSpecificationStore } from '../../specificationStore'
import type { Specification } from '../types'

// Mock the saveScheduler so tests don't fire real timers
vi.mock('../saveScheduler', () => ({ scheduleFlush: vi.fn() }))

function makeSpec(overrides: Partial<Specification> = {}): Specification {
  return {
    id: 'spec-1',
    parentSpecificationId: null,
    rootSpecificationId: 'spec-1',
    libraryId: 'lib-1',
    name: 'Test Spec',
    description: null,
    typeName: null,
    version: '1.0.0',
    state: 'Draft',
    data: { nodes: [], edges: [] },
    dataSchemaVersion: 3,
    history: [],
    createdAt: 1000,
    updatedAt: 1000,
    lastEditedByUserId: null,
    ...overrides,
  }
}

beforeEach(() => {
  useSpecificationStore.getState()._reset()
})

describe('updateSpecData', () => {
  it('shallow-merges dataPatch into spec.data without clobbering other keys', () => {
    const spec = makeSpec({ data: { nodes: [{ id: 'n1' }], edges: [{ id: 'e1' }] } })
    useSpecificationStore.setState((s) => {
      s.specs.set(spec.id, { ...spec })
    })

    useSpecificationStore.getState().updateSpecData('spec-1', { images: { 'foo.png': 'data:image/png;base64,abc' } })

    const updated = useSpecificationStore.getState().specs.get('spec-1')!
    expect(updated.data.images).toEqual({ 'foo.png': 'data:image/png;base64,abc' })
    // Original keys must still be present
    expect(updated.data.nodes).toEqual([{ id: 'n1' }])
    expect(updated.data.edges).toEqual([{ id: 'e1' }])
  })

  it('§3.13 i5 (revised): applies mid-save edits and re-dirties for a follow-up save', () => {
    // Original edit-lock made updateSpecData a no-op while savingIds.has(id),
    // which silently dropped keystrokes in controlled inputs (the input's
    // value prop reverted to the unchanged store state on the next render).
    // Revised behavior: the mutation IS applied; dirtyIds is re-added so
    // batchSave's F1 check schedules a follow-up save; preEditSnapshots is
    // NOT overwritten when set.
    const spec = makeSpec({ data: { nodes: [], images: { 'existing.png': 'data:uri' } } })
    useSpecificationStore.setState((s) => {
      s.specs.set(spec.id, { ...spec })
      s.savingIds.add(spec.id)
    })

    useSpecificationStore.getState().updateSpecData('spec-1', { images: { 'new.png': 'data:image/png;base64,xyz' } })

    const updated = useSpecificationStore.getState().specs.get('spec-1')!
    // Mid-save shallow-merge IS applied — top-level keys not in the patch are
    // preserved (nodes unchanged), and the patched key (images) is replaced
    // wholesale (updateSpecData uses { ...spec.data, ...patch }, no deep merge).
    expect(updated.data.nodes).toEqual([])
    expect(updated.data.images).toEqual({ 'new.png': 'data:image/png;base64,xyz' })
    expect(useSpecificationStore.getState().dirtyIds.has('spec-1')).toBe(true)
  })

  it('is a no-op when the spec does not exist', () => {
    // No spec seeded — store is empty after _reset
    const stateBefore = useSpecificationStore.getState()
    expect(stateBefore.specs.size).toBe(0)

    // Should not throw
    expect(() => {
      useSpecificationStore.getState().updateSpecData('nonexistent-id', { images: {} })
    }).not.toThrow()

    // Store still empty
    expect(useSpecificationStore.getState().specs.size).toBe(0)
  })
})
