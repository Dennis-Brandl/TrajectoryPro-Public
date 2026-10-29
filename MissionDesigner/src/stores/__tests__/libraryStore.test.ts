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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useLibraryStore } from '@/stores/libraryStore'
import type { Library, Specification, EntityType } from '@/types/library'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLibrary(id: string, overrides: Partial<Library> = {}): Library {
  return {
    id,
    name: `Library ${id}`,
    entityType: 'workflow' as EntityType,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function makeSpecification(id: string, libraryId: string, overrides: Partial<Specification> = {}): Specification {
  return {
    id,
    libraryId,
    name: `Spec ${id}`,
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: {},
    history: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Reset before every test
// ---------------------------------------------------------------------------

beforeEach(() => {
  useLibraryStore.setState({
    libraries: [],
    specifications: new Map(),
    childLibraries: new Map(),
    activeEntityType: 'workflow',
    searchQuery: '',
    selectedLibraryId: null,
    selectedSpecificationId: null,
    isLoading: false,
    error: null,
  })
  vi.restoreAllMocks()
})

// ===========================================================================
// UI state actions
// ===========================================================================

describe('setActiveEntityType', () => {
  it('updates activeEntityType and clears selection', () => {
    useLibraryStore.setState({ selectedLibraryId: 'lib-1', selectedSpecificationId: 'spec-1' })
    useLibraryStore.getState().setActiveEntityType('step')
    const state = useLibraryStore.getState()
    expect(state.activeEntityType).toBe('step')
    expect(state.selectedLibraryId).toBeNull()
    expect(state.selectedSpecificationId).toBeNull()
  })
})

describe('setSearchQuery', () => {
  it('updates searchQuery', () => {
    useLibraryStore.getState().setSearchQuery('hello')
    expect(useLibraryStore.getState().searchQuery).toBe('hello')
  })
})

describe('setSelectedLibrary', () => {
  it('sets selectedLibraryId and clears spec selection', () => {
    useLibraryStore.setState({ selectedSpecificationId: 'spec-1' })
    useLibraryStore.getState().setSelectedLibrary('lib-42')
    const state = useLibraryStore.getState()
    expect(state.selectedLibraryId).toBe('lib-42')
    expect(state.selectedSpecificationId).toBeNull()
  })
})

describe('setSelectedSpecification', () => {
  it('sets selectedSpecificationId', () => {
    useLibraryStore.getState().setSelectedSpecification('spec-99')
    expect(useLibraryStore.getState().selectedSpecificationId).toBe('spec-99')
  })

  it('also updates selectedLibraryId when provided', () => {
    useLibraryStore.getState().setSelectedSpecification('spec-1', 'lib-7')
    const state = useLibraryStore.getState()
    expect(state.selectedSpecificationId).toBe('spec-1')
    expect(state.selectedLibraryId).toBe('lib-7')
  })

  it('preserves existing selectedLibraryId when libraryId not given', () => {
    useLibraryStore.setState({ selectedLibraryId: 'lib-existing' })
    useLibraryStore.getState().setSelectedSpecification('spec-1')
    expect(useLibraryStore.getState().selectedLibraryId).toBe('lib-existing')
  })
})

describe('clearError', () => {
  it('sets error to null', () => {
    useLibraryStore.setState({ error: 'Some error' })
    useLibraryStore.getState().clearError()
    expect(useLibraryStore.getState().error).toBeNull()
  })
})

// ===========================================================================
// validateStepReference
// ===========================================================================

describe('validateStepReference', () => {
  it('returns true when the spec exists in any library', () => {
    const specs = new Map([['lib-1', [makeSpecification('spec-abc', 'lib-1')]]])
    useLibraryStore.setState({ specifications: specs })

    expect(useLibraryStore.getState().validateStepReference('spec-abc')).toBe(true)
  })

  it('returns false when the spec does not exist', () => {
    useLibraryStore.setState({ specifications: new Map() })

    expect(useLibraryStore.getState().validateStepReference('ghost-id')).toBe(false)
  })
})

// ===========================================================================
// getStepSpecifications
// ===========================================================================

describe('getStepSpecifications', () => {
  it('returns specs only from step-type libraries', () => {
    const stepLib = makeLibrary('lib-step', { entityType: 'step' })
    const wfLib = makeLibrary('lib-wf', { entityType: 'workflow' })
    const stepSpec = makeSpecification('s1', 'lib-step')
    const wfSpec = makeSpecification('s2', 'lib-wf')
    const specs = new Map([
      ['lib-step', [stepSpec]],
      ['lib-wf', [wfSpec]],
    ])
    useLibraryStore.setState({ libraries: [stepLib, wfLib], specifications: specs, childLibraries: new Map() })

    const result = useLibraryStore.getState().getStepSpecifications()

    expect(result).toHaveLength(1)
    expect(result[0].spec.id).toBe('s1')
    expect(result[0].library.id).toBe('lib-step')
  })

  it('returns empty array when no step libraries exist', () => {
    useLibraryStore.setState({
      libraries: [makeLibrary('lib-wf', { entityType: 'workflow' })],
      specifications: new Map(),
      childLibraries: new Map(),
    })

    expect(useLibraryStore.getState().getStepSpecifications()).toHaveLength(0)
  })
})
