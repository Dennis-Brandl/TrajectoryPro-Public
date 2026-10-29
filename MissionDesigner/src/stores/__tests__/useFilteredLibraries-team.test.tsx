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
import { renderHook } from '@testing-library/react'
import { useLibraryStore, useFilteredLibraries } from '../libraryStore'
import type { Library } from '@/types/library'

function lib(id: string, teamId: string | null): Library {
  return {
    id,
    teamId,
    parentLibraryId: null,
    name: `Lib ${id}`,
    entityType: 'workflow',
    createdAt: 1,
    updatedAt: 1,
  }
}

beforeEach(() => {
  useLibraryStore.setState({
    libraries: [lib('a', 'team-a'), lib('b', 'team-b'), lib('c', 'team-a')],
    childLibraries: new Map(),
    specifications: new Map(),
    activeEntityType: 'workflow',
    searchQuery: '',
    selectedTeamId: null,
  })
})

describe('useFilteredLibraries — team filter (Phase 5b)', () => {
  it('returns all visible libraries when selectedTeamId is null', () => {
    const { result } = renderHook(() => useFilteredLibraries())
    expect(result.current.map((l) => l.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('scopes to the selected team', () => {
    useLibraryStore.setState({ selectedTeamId: 'team-a' })
    const { result } = renderHook(() => useFilteredLibraries())
    expect(result.current.map((l) => l.id).sort()).toEqual(['a', 'c'])
  })

  it('returns empty when the selected team owns no libraries of this type', () => {
    useLibraryStore.setState({ selectedTeamId: 'team-z' })
    const { result } = renderHook(() => useFilteredLibraries())
    expect(result.current).toEqual([])
  })

  it('still applies the entity-type filter alongside the team filter', () => {
    useLibraryStore.setState({
      libraries: [lib('a', 'team-a'), { ...lib('d', 'team-a'), entityType: 'action' }],
      selectedTeamId: 'team-a',
      activeEntityType: 'workflow',
    })
    const { result } = renderHook(() => useFilteredLibraries())
    expect(result.current.map((l) => l.id)).toEqual(['a'])
  })
})
