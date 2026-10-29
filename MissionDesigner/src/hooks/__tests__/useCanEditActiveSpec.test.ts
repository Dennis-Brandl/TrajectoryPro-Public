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
import { renderHook } from '@testing-library/react'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { usePrincipalStore } from '@/stores/principalStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'
import type { Library, Specification } from '@/stores/specificationStore/types'

const principal: MePrincipal = {
  userId: 'u1',
  isAdministrator: false,
  memberships: ['team-a'],
  rightsByTeam: { 'team-a': ['workflow:edit'] },
  teams: [{ id: 'team-a', name: 'A' }],
  editLockedStates: ['Approved', 'Effective', 'Superseded', 'Obsolete'],
}

function lib(over: Partial<Library> = {}): Library {
  return {
    id: 'lib1',
    parentLibraryId: null,
    teamId: 'team-a',
    name: 'L',
    entityType: 'workflow',
    description: null,
    author: null,
    changeHistory: null,
    version: '1.0.0',
    environmentLibraryIds: [],
    createdAt: 0,
    updatedAt: 0,
    lastEditedByUserId: null,
    ...over,
  }
}
function spec(state: string): Specification {
  return {
    id: 's1',
    parentSpecificationId: null,
    rootSpecificationId: 's1',
    libraryId: 'lib1',
    name: 'S',
    description: null,
    typeName: null,
    version: '1.0.0',
    state,
    data: {},
    dataSchemaVersion: 3,
    history: [],
    createdAt: 0,
    updatedAt: 0,
    lastEditedByUserId: null,
  }
}

beforeEach(() => {
  usePrincipalStore.setState({ principal })
  useSpecificationStore.setState({ libraries: new Map([['lib1', lib()]]), specs: new Map([['s1', spec('Draft')]]) })
  useLibraryStore.setState({ selectedLibraryId: 'lib1', selectedSpecificationId: 's1' })
})

describe('useCanEditActiveSpec', () => {
  it('true: editor right + non-locked state', () => {
    expect(renderHook(() => useCanEditActiveSpec()).result.current).toBe(true)
  })

  it('false when the spec state is edit-locked', () => {
    useSpecificationStore.setState({ specs: new Map([['s1', spec('Approved')]]) })
    expect(renderHook(() => useCanEditActiveSpec()).result.current).toBe(false)
  })

  it('false when the user lacks the edit right in the team', () => {
    usePrincipalStore.setState({ principal: { ...principal, rightsByTeam: {} } })
    expect(renderHook(() => useCanEditActiveSpec()).result.current).toBe(false)
  })

  it('admin can edit even a locked spec', () => {
    usePrincipalStore.setState({ principal: { ...principal, isAdministrator: true } })
    useSpecificationStore.setState({ specs: new Map([['s1', spec('Effective')]]) })
    expect(renderHook(() => useCanEditActiveSpec()).result.current).toBe(true)
  })

  it('false when no principal (pre-boot)', () => {
    usePrincipalStore.setState({ principal: null })
    expect(renderHook(() => useCanEditActiveSpec()).result.current).toBe(false)
  })
})
