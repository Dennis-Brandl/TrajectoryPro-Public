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

// Phase 35 §3.4: selector hooks. Array-returning hooks use useShallow to
// short-circuit re-renders when the underlying array reference is stable
// (which it is, because rebuildIndexes only touches affected parents).

import { useShallow } from 'zustand/react/shallow'
import { useSpecificationStore, EMPTY_ARRAY } from '../specificationStore'
import type { Specification, Library, SaveError } from './types'

export const useSpec = (id: string): Specification | undefined => useSpecificationStore((s) => s.specs.get(id))

export const useLibrary = (id: string): Library | undefined => useSpecificationStore((s) => s.libraries.get(id))

export const useChildren = (parentId: string): readonly Specification[] =>
  useSpecificationStore(useShallow((s) => s.childrenOf.get(parentId) ?? (EMPTY_ARRAY as readonly Specification[])))

export const useRootsInLibrary = (libraryId: string): readonly Specification[] =>
  useSpecificationStore(useShallow((s) => s.rootsInLibrary.get(libraryId) ?? (EMPTY_ARRAY as readonly Specification[])))

export const useRootForLibrary = (libraryId: string): Specification | undefined =>
  useSpecificationStore((s) => {
    const roots = s.rootsInLibrary.get(libraryId)
    return roots && roots.length > 0 ? roots[0] : undefined
  })

export const useDirtyCount = (): number => useSpecificationStore((s) => s.dirtyIds.size)

export const useDirtyCountForLibrary = (libraryId: string): number =>
  useSpecificationStore((s) => s.dirtyCountByLibrary.get(libraryId) ?? 0)

export const useIsDirty = (id: string): boolean => useSpecificationStore((s) => s.dirtyIds.has(id))

export const useSaveError = (): SaveError | null => useSpecificationStore((s) => s.lastSaveError)

export const useLibrarySaveError = (): SaveError | null => useSpecificationStore((s) => s.lastLibrarySaveError)

export const useIsSaving = (id: string): boolean => useSpecificationStore((s) => s.savingIds.has(id))

export const useBootPhase = () => useSpecificationStore((s) => s.bootPhase)

// Imperative (non-hook) reads — used by payload builder + non-React code
export function getSpec(id: string): Specification | undefined {
  return useSpecificationStore.getState().specs.get(id)
}

export function getLibrary(id: string): Library | undefined {
  return useSpecificationStore.getState().libraries.get(id)
}

export function getChildren(parentId: string): readonly Specification[] {
  return useSpecificationStore.getState().childrenOf.get(parentId) ?? (EMPTY_ARRAY as readonly Specification[])
}

/** Cycle-guarded descendant walk (§3.13 i13). Max depth 100. */
export function getDescendants(rootId: string): Specification[] {
  const state = useSpecificationStore.getState()
  const visited = new Set<string>()
  const out: Specification[] = []
  const queue = [rootId]
  let depth = 0
  while (queue.length > 0 && depth < 100) {
    const batch = queue.splice(0, queue.length)
    for (const id of batch) {
      if (visited.has(id)) continue
      visited.add(id)
      const spec = state.specs.get(id)
      if (spec) out.push(spec)
      const children = state.childrenOf.get(id) ?? []
      for (const c of children) queue.push(c.id)
    }
    depth++
  }
  return out
}
