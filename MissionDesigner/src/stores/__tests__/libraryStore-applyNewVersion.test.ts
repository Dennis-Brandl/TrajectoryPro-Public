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

import { describe, it, expect, vi } from 'vitest'
import { useLibraryStore } from '@/stores/libraryStore'

describe('libraryStore applyNewVersion', () => {
  it('triggers a refetch of both the spec list and spec tree for the affected library', async () => {
    const fetchSpecifications = vi.fn().mockResolvedValue(undefined)
    const fetchSpecTree = vi.fn().mockResolvedValue(undefined)
    useLibraryStore.setState({ fetchSpecifications, fetchSpecTree } as unknown as Parameters<
      typeof useLibraryStore.setState
    >[0])
    const newSpec = {
      id: 'new-1',
      libraryId: 'lib-A',
      name: 'X',
      version: '1.1.0',
      state: 'Draft',
      history: [],
    } as never
    await useLibraryStore.getState().applyNewVersion(newSpec)
    expect(fetchSpecifications).toHaveBeenCalledWith('lib-A')
    expect(fetchSpecTree).toHaveBeenCalledWith('lib-A')
    expect(useLibraryStore.getState().selectedSpecificationId).toBe('new-1')
    expect(useLibraryStore.getState().selectedLibraryId).toBe('lib-A')
  })
})
