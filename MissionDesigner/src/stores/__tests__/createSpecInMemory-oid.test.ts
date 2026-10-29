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

// createSpecInMemory must honor a caller-provided id (init.id) so the import
// pipeline can PRESERVE source OIDs for Actions/Environments, while never
// overwriting an existing spec and defaulting to a fresh id otherwise.

import { describe, it, expect, beforeEach } from 'vitest'
import { useSpecificationStore } from '../specificationStore'
import type { Specification } from '../specificationStore/types'

function seedSpec(id: string, libraryId = 'lib'): void {
  useSpecificationStore.setState((s) => {
    const spec: Specification = {
      id,
      parentSpecificationId: null,
      rootSpecificationId: id,
      libraryId,
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

beforeEach(() => {
  useSpecificationStore.getState()._reset()
})

describe('createSpecInMemory — OID preservation on import', () => {
  it('uses init.id when provided (preserves the imported OID)', () => {
    const id = useSpecificationStore.getState().createSpecInMemory({
      parentId: null,
      libraryId: 'lib',
      init: { id: 'preserved-oid', name: 'Env', data: {} },
    })
    expect(id).toBe('preserved-oid')
    expect(useSpecificationStore.getState().specs.get('preserved-oid')?.id).toBe('preserved-oid')
  })

  it('generates a fresh id when init.id is omitted (unchanged behavior)', () => {
    const id = useSpecificationStore.getState().createSpecInMemory({
      parentId: null,
      libraryId: 'lib',
      init: { name: 'New', data: {} },
    })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(useSpecificationStore.getState().specs.has(id)).toBe(true)
  })

  it('never overwrites an existing spec when init.id collides', () => {
    seedSpec('existing')
    const id = useSpecificationStore.getState().createSpecInMemory({
      parentId: null,
      libraryId: 'lib',
      init: { id: 'existing', name: 'Intruder', data: {} },
    })
    expect(id).not.toBe('existing') // fell back to a fresh id
    expect(useSpecificationStore.getState().specs.get('existing')?.name).toBe('existing') // original intact
  })
})
