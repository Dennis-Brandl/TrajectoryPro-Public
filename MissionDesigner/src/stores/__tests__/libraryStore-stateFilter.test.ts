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
import { useLibraryStore } from '@/stores/libraryStore'

describe('libraryStore stateFilter', () => {
  beforeEach(() => {
    useLibraryStore.setState({ stateFilter: 'all' })
  })

  it('default is "all"', () => {
    expect(useLibraryStore.getState().stateFilter).toBe('all')
  })

  it('setStateFilter updates the value', () => {
    useLibraryStore.getState().setStateFilter('Effective')
    expect(useLibraryStore.getState().stateFilter).toBe('Effective')
  })

  it('switching active entity type does NOT reset stateFilter', () => {
    useLibraryStore.getState().setStateFilter('Effective')
    useLibraryStore.getState().setActiveEntityType('action')
    expect(useLibraryStore.getState().stateFilter).toBe('Effective')
  })
})
