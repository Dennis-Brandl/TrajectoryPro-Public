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

// Phase 35 §2.10: convert a parsed ImportPlan into a BatchSaveRequest
// suitable for runBatchSave().
//
// The imageRefs[] in the BatchSaveRequest is intentionally always empty.
// Image bytes for the import are inserted into image_blob + image directly
// in a separate post-batch-save step (see packages.ts handler in C3). The
// reason: batch-save's imageRefs[] links existing image rows by id, but
// import creates fresh image rows. Splitting the steps keeps the function
// pure and testable.

import { randomUUID } from 'node:crypto'
import type { BatchSaveRequest } from '../batchSave/requestSchema'
import type { ImportPlan } from './parseEnvelope'

export interface ImportImageInsert {
  newSpecId: string
  /** Bare filename as extracted from node data (after any OID-prefix strip). */
  filename: string
  /**
   * Source spec id as it appeared in the envelope. Used by insertImportImages
   * to reconstruct the ZIP entry key `{sourceSpecId}-{filename}` for server
   * round-trip exports (which name entries `images/{specId}-{filename}`).
   */
  sourceSpecId: string
}

export interface ImportBatchResult {
  batch: BatchSaveRequest
  /** sourceId → newId for every spec in the import */
  idMap: Map<string, string>
  /** New image inserts the post-batch-save step must do, keyed by new spec id */
  imageInserts: ImportImageInsert[]
}

export function buildImportBatch(
  plan: ImportPlan,
  targetLibraryId: string,
  reservedRoots: ReadonlyArray<{ name: string; version: string }> = [],
): ImportBatchResult {
  const idMap = new Map<string, string>()
  for (const s of plan.specs) idMap.set(s.sourceId, randomUUID())

  // Auto-rename to avoid the specification name-uniqueness indexes rather than
  // failing the whole import with a 409:
  //   - root spec:  UNIQUE(libraryId, name, version)         WHERE parentSpecificationId IS NULL
  //   - child spec: UNIQUE(parentSpecificationId, name, ver) WHERE parentSpecificationId IS NOT NULL
  // A package can legitimately carry two children that share (name, version)
  // under one parent (older editor schemas allowed it), and re-importing a
  // workflow that already exists collides on the root index. `reservedRoots`
  // seeds the already-taken root (name, version) pairs in the target library so
  // a reload disambiguates instead of erroring.
  const nameBySourceId = computeDedupedNames(plan, idMap, reservedRoots)

  // Resolve each spec into a SpecCreate. Roots get the target library id;
  // children get the same library id (coexistence rule #4 carries it through).
  const creates = plan.specs.map((s) => {
    const newId = idMap.get(s.sourceId)!
    const newRootId = idMap.get(s.rootSourceId)!
    const newParentId = s.parentSourceId ? idMap.get(s.parentSourceId)! : null
    return {
      op: 'create' as const,
      id: newId,
      parentSpecificationId: newParentId,
      rootSpecificationId: newRootId,
      libraryId: targetLibraryId,
      name: nameBySourceId.get(s.sourceId)!,
      description: s.description,
      typeName: s.typeName ?? null,
      data: s.dataJson,
      dataSchemaVersion: s.dataSchemaVersion,
      version: s.version,
      state: s.state as 'Draft' | 'InTest' | 'InReview' | 'Approved' | 'Effective' | 'Superseded' | 'Obsolete',
    }
  })

  // specification_environment bindings: remap the source spec id via idMap,
  // preserve the environmentLibraryId verbatim. Rows whose env library does
  // not exist on the target (or is not visible to the importing user) are
  // filtered out by the route handler BEFORE runBatchSave; leaving them in
  // here would hit the specenv_* triggers and fail the whole transaction.
  const specEnvs = plan.specEnvs
    .map((e) => {
      const newSpecId = idMap.get(e.specSourceId)
      if (!newSpecId) return null
      return {
        op: 'create' as const,
        specificationId: newSpecId,
        environmentLibraryId: e.environmentLibraryId,
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  const proxyRefs = plan.proxyRefs
    .map((p) => {
      const newParent = idMap.get(p.parentSourceId)
      const newTarget = idMap.get(p.targetSourceId)
      if (!newParent || !newTarget) return null
      return {
        op: 'create' as const,
        parentSpecificationId: newParent,
        nodeId: p.nodeId,
        targetSpecificationId: newTarget,
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)

  const batch: BatchSaveRequest = {
    specs: creates,
    proxyRefs,
    specEnvs,
    imageDeletes: [],
    imageRefs: [],
  }

  // Dedupe by (newSpecId, filename) — the same image element legitimately
  // appears across phone/tablet/desktop form layouts, so the parser emits one
  // imageRef per layout. Without dedup, insertImportImages tries to create
  // multiple `image` rows with the same (specificationId, filename) and trips
  // the UNIQUE constraint.
  const seen = new Set<string>()
  const imageInserts: ImportImageInsert[] = []
  for (const r of plan.imageRefs) {
    const newSpecId = idMap.get(r.specSourceId)
    if (!newSpecId) continue
    const key = `${newSpecId}\0${r.filename}`
    if (seen.has(key)) continue
    seen.add(key)
    imageInserts.push({
      newSpecId,
      filename: r.filename,
      sourceSpecId: r.specSourceId,
    })
  }

  return { batch, idMap, imageInserts }
}

/**
 * Assign each imported spec a name that won't collide on the DB's name-uniqueness
 * indexes — within this import AND against pre-existing roots (`reservedRoots`).
 * Duplicates get a ` (n)` suffix. Keys mirror the two partial unique indexes; a
 * non-root's effective version is its ROOT's version (phase2Apply derives every
 * non-root spec's version from its root). Names are only display labels — proxy
 * refs, env links and embedded-workflow navigation all key off ids — so renaming
 * is safe.
 */
function computeDedupedNames(
  plan: ImportPlan,
  idMap: Map<string, string>,
  reservedRoots: ReadonlyArray<{ name: string; version: string }>,
): Map<string, string> {
  const versionBySourceId = new Map(plan.specs.map((s) => [s.sourceId, s.version] as const))
  const usedRootKeys = new Set(reservedRoots.map((r) => `${r.name}\0${r.version}`))
  const usedChildKeys = new Set<string>()
  const nameBySourceId = new Map<string, string>()

  const disambiguate = (base: string, isTaken: (candidate: string) => boolean): string => {
    if (!isTaken(base)) return base
    for (let n = 2; ; n++) {
      const candidate = `${base} (${n})`
      if (!isTaken(candidate)) return candidate
    }
  }

  for (const s of plan.specs) {
    if (s.parentSourceId === null) {
      const version = s.version
      const name = disambiguate(s.name, (c) => usedRootKeys.has(`${c}\0${version}`))
      usedRootKeys.add(`${name}\0${version}`)
      nameBySourceId.set(s.sourceId, name)
    } else {
      const newParentId = idMap.get(s.parentSourceId)
      const version = versionBySourceId.get(s.rootSourceId) ?? s.version
      const name = disambiguate(s.name, (c) => usedChildKeys.has(`${newParentId}\0${c}\0${version}`))
      usedChildKeys.add(`${newParentId}\0${name}\0${version}`)
      nameBySourceId.set(s.sourceId, name)
    }
  }

  return nameBySourceId
}
