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

import { useMemo } from 'react'
import { useLibraryStore, useSpecIndex } from '@/stores/libraryStore'
import type { Specification } from '@/types/library'

interface SpecLookupResult {
  spec: Specification | null
  libraryId: string | null
}

/**
 * Looks up a specification by ID using the memoized O(1) spec index.
 * Returns the spec and the library ID it belongs to.
 */
export function useSpecificationById(specId: string | null | undefined): SpecLookupResult {
  const specIndex = useSpecIndex()

  return useMemo(() => {
    if (!specId) return { spec: null, libraryId: null }
    const entry = specIndex.get(specId)
    return entry ? { spec: entry.spec, libraryId: entry.libraryId } : { spec: null, libraryId: null }
  }, [specId, specIndex])
}

/**
 * Non-hook helper for finding a spec by ID in store state.
 * Use in callbacks, store actions, or non-component code.
 */
export function findSpecificationById(specId: string): SpecLookupResult {
  const specifications = useLibraryStore.getState().specifications
  for (const [libId, specs] of specifications.entries()) {
    const found = specs.find((s) => s.id === specId)
    if (found) return { spec: found, libraryId: libId }
  }
  return { spec: null, libraryId: null }
}
