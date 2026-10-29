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
import { useNotationStore, resolveSpecNotation, persistNotationToActiveSpec } from '../notationStore'
import { useLibraryStore } from '../libraryStore'
import { useSpecificationStore } from '../specificationStore'
import type { Specification } from '@/types/library'

function makeSpec(id: string, libraryId: string, data: Record<string, unknown> = {}): Specification {
  return {
    id,
    libraryId,
    name: 'Foo',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data,
    history: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('resolveSpecNotation', () => {
  it('returns the notation when present and valid', () => {
    expect(resolveSpecNotation({ notation: 'bpmn' })).toBe('bpmn')
    expect(resolveSpecNotation({ notation: 'flowchart' })).toBe('flowchart')
    expect(resolveSpecNotation({ notation: 'isa88' })).toBe('isa88')
  })

  it('defaults to flowchart when notation is missing — prevents bleed from previous spec', () => {
    expect(resolveSpecNotation({})).toBe('flowchart')
    expect(resolveSpecNotation(undefined)).toBe('flowchart')
  })

  it('defaults to flowchart when notation is not a recognised value', () => {
    expect(resolveSpecNotation({ notation: 'mermaid' })).toBe('flowchart')
    expect(resolveSpecNotation({ notation: null })).toBe('flowchart')
  })
})

describe('persistNotationToActiveSpec', () => {
  beforeEach(() => {
    useSpecificationStore.getState()._reset()
    useLibraryStore.setState({ selectedSpecificationId: null })
  })

  it('writes notation into the selected spec.data', () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('spec-A', makeSpec('spec-A', 'lib-X') as never)
    })
    useLibraryStore.setState({ selectedSpecificationId: 'spec-A' })

    persistNotationToActiveSpec('bpmn')

    const updated = useSpecificationStore.getState().specs.get('spec-A')
    expect(updated?.data.notation).toBe('bpmn')
  })

  it('preserves other spec.data fields when writing notation', () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('spec-A', makeSpec('spec-A', 'lib-X', { nodes: [], edges: [], custom: 42 }) as never)
    })
    useLibraryStore.setState({ selectedSpecificationId: 'spec-A' })

    persistNotationToActiveSpec('isa88')

    const data = useSpecificationStore.getState().specs.get('spec-A')?.data
    expect(data?.notation).toBe('isa88')
    expect(data?.nodes).toEqual([])
    expect(data?.custom).toBe(42)
  })

  it('is a no-op when no spec is selected', () => {
    useSpecificationStore.setState((s) => {
      s.specs.set('spec-A', makeSpec('spec-A', 'lib-X') as never)
    })
    useLibraryStore.setState({ selectedSpecificationId: null })

    expect(() => persistNotationToActiveSpec('bpmn')).not.toThrow()
    const data = useSpecificationStore.getState().specs.get('spec-A')?.data
    expect(data?.notation).toBeUndefined()
  })

  it('is a no-op when the selected id has no matching spec', () => {
    useLibraryStore.setState({ selectedSpecificationId: 'missing' })
    expect(() => persistNotationToActiveSpec('bpmn')).not.toThrow()
  })
})

describe('cross-spec notation leak (regression)', () => {
  beforeEach(() => {
    useSpecificationStore.getState()._reset()
    useLibraryStore.setState({ selectedSpecificationId: null })
    useNotationStore.setState({ notation: 'flowchart' })
  })

  it('navigating to a sibling spec without saved notation does not inherit the previous spec notation', () => {
    // Two same-named specs in different libraries, neither has spec.data.notation saved
    useSpecificationStore.setState((s) => {
      s.specs.set('spec-A', makeSpec('spec-A', 'lib-X') as never)
      s.specs.set('spec-B', makeSpec('spec-B', 'lib-Y') as never)
    })

    // Open A, change notation to bpmn, persist
    useLibraryStore.setState({ selectedSpecificationId: 'spec-A' })
    useNotationStore.getState().setNotation('bpmn')
    persistNotationToActiveSpec('bpmn')

    // Navigate to B and resolve its notation as the route hydration would
    useLibraryStore.setState({ selectedSpecificationId: 'spec-B' })
    const specB = useSpecificationStore.getState().specs.get('spec-B')
    const resolved = resolveSpecNotation(specB?.data)

    // B has no saved notation; it must fall back to the default, NOT inherit bpmn from A
    expect(resolved).toBe('flowchart')
  })
})
