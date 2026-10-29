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
import { buildBatchSavePayload } from '../specificationStore/buildBatchSavePayload'
import { useSpecificationStore } from '../specificationStore'
import type { Specification } from '../specificationStore/types'

function mkSpec(overrides: Partial<Specification> & { id: string }): Specification {
  return {
    id: overrides.id,
    parentSpecificationId: overrides.parentSpecificationId ?? null,
    rootSpecificationId: overrides.rootSpecificationId ?? overrides.id,
    libraryId: overrides.libraryId ?? 'lib',
    name: overrides.name ?? 'spec',
    description: null,
    typeName: null,
    version: '1.0.0',
    state: 'Draft',
    data: overrides.data ?? { nodes: [] },
    dataSchemaVersion: 3,
    history: [],
    createdAt: 0,
    updatedAt: 0,
    lastEditedByUserId: null,
  }
}

beforeEach(() => {
  useSpecificationStore.getState()._reset()
})

describe('buildBatchSavePayload', () => {
  it('emits create for an unsaved new spec', () => {
    useSpecificationStore.setState((s) => {
      const spec = mkSpec({ id: 'new' })
      s.specs.set('new', spec)
      s.dirtyIds.add('new')
      s.unsavedNewIds.add('new')
    })
    const payload = buildBatchSavePayload()
    expect(payload.specs[0]).toMatchObject({ op: 'create', id: 'new' })
    // libraryVersionGuards has been removed from the payload
    expect((payload as { libraryVersionGuards?: unknown }).libraryVersionGuards).toBeUndefined()
  })

  it('emits update for a dirty existing spec', () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r', mkSpec({ id: 'r', name: 'Renamed' }))
      s.dirtyIds.add('r')
    })
    const payload = buildBatchSavePayload()
    expect(payload.specs[0]).toMatchObject({ op: 'update', id: 'r', name: 'Renamed' })
    expect((payload.specs[0] as { expectedRowVersion?: unknown }).expectedRowVersion).toBeUndefined()
  })

  it('emits delete for pendingDeletes', () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r', mkSpec({ id: 'r' }))
      s.pendingDeletes.add('r')
    })
    const payload = buildBatchSavePayload()
    expect(payload.specs[0]).toMatchObject({ op: 'delete', id: 'r' })
    expect((payload.specs[0] as { expectedRowVersion?: unknown }).expectedRowVersion).toBeUndefined()
  })

  it('excludes specs still in pendingCreationIds (§3.13 i6)', () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('new', mkSpec({ id: 'new' }))
      s.dirtyIds.add('new')
      s.unsavedNewIds.add('new')
      s.pendingCreationIds.add('new')
    })
    const payload = buildBatchSavePayload()
    expect(payload.specs).toHaveLength(0)
  })

  it('serializes data blob as JSON string', () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('r', mkSpec({ id: 'r', data: { nodes: [{ id: 'n1' }] } }))
      s.dirtyIds.add('r')
    })
    const payload = buildBatchSavePayload()
    expect((payload.specs[0] as { data?: string }).data).toBe('{"nodes":[{"id":"n1"}]}')
  })
})
