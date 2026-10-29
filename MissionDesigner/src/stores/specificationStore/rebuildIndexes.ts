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

// Phase 35 §3.2 B2: atomically rebuild derived indexes after a mutation.
// mutatedIds = null → full rebuild (initial load, rare).
// mutatedIds = [...] → incremental — touch only affected parent entries.

import type { Specification, SpecificationStoreState } from './types'

const MAX_WALK_DEPTH = 100

export function rebuildIndexes(draft: SpecificationStoreState, mutatedIds: string[] | null): void {
  if (mutatedIds === null) {
    fullRebuild(draft)
    return
  }
  incrementalRebuild(draft, mutatedIds)
}

function fullRebuild(draft: SpecificationStoreState): void {
  const childrenOf = new Map<string, Specification[]>()
  const rootsInLibrary = new Map<string, Specification[]>()
  const rootOf = new Map<string, string>()

  for (const spec of draft.specs.values()) {
    if (draft.pendingDeletes.has(spec.id)) continue
    if (spec.parentSpecificationId) {
      const list = childrenOf.get(spec.parentSpecificationId) ?? []
      list.push(spec)
      childrenOf.set(spec.parentSpecificationId, list)
    } else {
      const list = rootsInLibrary.get(spec.libraryId) ?? []
      list.push(spec)
      rootsInLibrary.set(spec.libraryId, list)
    }
  }
  // Resolve rootOf by walking parent chain
  for (const spec of draft.specs.values()) {
    rootOf.set(spec.id, walkToRoot(draft, spec.id))
  }
  // Freeze arrays and store
  draft.childrenOf = new Map()
  for (const [k, arr] of childrenOf) draft.childrenOf.set(k, Object.freeze(arr.slice()) as readonly Specification[])
  draft.rootsInLibrary = new Map()
  for (const [k, arr] of rootsInLibrary)
    draft.rootsInLibrary.set(k, Object.freeze(arr.slice()) as readonly Specification[])
  draft.rootOf = rootOf

  recountDirty(draft)
}

function incrementalRebuild(draft: SpecificationStoreState, mutatedIds: string[]): void {
  // Contract: mutatedIds must include every id whose childrenOf/rootOf/rootsInLibrary
  // entry could have changed. Concretely, callers must include:
  //   - the mutated spec's id
  //   - if reparented: BOTH the old parentSpecificationId AND the new parentSpecificationId
  //     (so the old parent's childrenOf entry is rebuilt without the departed child)
  //   - if the spec became/stopped being a root: the affected libraryId is inferred from
  //     the spec's current state, so no extra caller action needed
  //
  // This loop treats every id in mutatedIds two ways:
  //   (a) as a spec whose current parent is an affected parent (or whose libraryId is affected
  //       if it's a root), AND
  //   (b) as a potential parent whose own childrenOf needs rebuilding (covers the "old parent"
  //       case when the caller passed a bare parent id).
  const affectedParents = new Set<string>()
  const affectedLibraries = new Set<string>()
  for (const id of mutatedIds) {
    // (a) treat id as a spec — its CURRENT parent's childrenOf must be rebuilt
    const spec = draft.specs.get(id)
    if (spec) {
      if (spec.parentSpecificationId) {
        affectedParents.add(spec.parentSpecificationId)
      } else {
        affectedLibraries.add(spec.libraryId)
      }
    }
    // (b) treat id as a potential parent — its OWN childrenOf entry may have gained
    // or lost children. Always add to affectedParents; if no specs actually have
    // parentSpecificationId === id, the rebuild produces an empty array (correct).
    affectedParents.add(id)
  }
  // Rebuild childrenOf for each affected parent
  for (const parentId of affectedParents) {
    const children: Specification[] = []
    for (const spec of draft.specs.values()) {
      if (draft.pendingDeletes.has(spec.id)) continue
      if (spec.parentSpecificationId === parentId) children.push(spec)
    }
    draft.childrenOf.set(parentId, Object.freeze(children) as readonly Specification[])
  }
  // Rebuild rootsInLibrary for each affected library
  for (const libraryId of affectedLibraries) {
    const roots: Specification[] = []
    for (const spec of draft.specs.values()) {
      if (draft.pendingDeletes.has(spec.id)) continue
      if (!spec.parentSpecificationId && spec.libraryId === libraryId) roots.push(spec)
    }
    draft.rootsInLibrary.set(libraryId, Object.freeze(roots) as readonly Specification[])
  }
  // Rebuild rootOf for each mutated spec
  for (const id of mutatedIds) {
    if (draft.specs.has(id)) draft.rootOf.set(id, walkToRoot(draft, id))
  }
  recountDirty(draft)
}

function walkToRoot(draft: SpecificationStoreState, startId: string): string {
  let cur: string | null = startId
  let depth = 0
  while (cur && depth < MAX_WALK_DEPTH) {
    const spec = draft.specs.get(cur)
    if (!spec) return startId
    if (!spec.parentSpecificationId) return spec.id
    cur = spec.parentSpecificationId
    depth++
  }
  return startId // cycle guard fallback
}

function recountDirty(draft: SpecificationStoreState): void {
  const counts = new Map<string, number>()
  for (const id of draft.dirtyIds) {
    const spec = draft.specs.get(id)
    if (!spec) continue
    counts.set(spec.libraryId, (counts.get(spec.libraryId) ?? 0) + 1)
  }
  draft.dirtyCountByLibrary = counts
}
