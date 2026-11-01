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

import {
  createCopiedEntry,
  createNewVersionEntry,
  parseHistory,
  serializeHistory,
} from '../../types/specification-history'

export interface CloneSourceRow {
  id: string
  libraryId: string
  name: string
  description: string | null
  typeName: string | null
  version: string
  state: string
  data: string
  environmentLibraryIds: string | null
  parentSpecificationId: string | null
  rootSpecificationId: string | null
  dataSchemaVersion: number
  lastEditedByUserId: string | null
  history: string
  /** Kept by copySpecificationSubtree; Create New Version leaves it out (a new Draft has none). */
  effectiveFrom?: number | null
}

export interface ClonedRow extends CloneSourceRow {
  createdAt: number
  updatedAt: number
}

export interface CloneArgs {
  source: CloneSourceRow[] // [root, ...descendants] in any order
  newRootVersion: string
  account: string
  newId: () => string // injectable for tests; pass `() => crypto.randomUUID()` in production
  now?: () => number
}

export interface CloneResult {
  rows: ClonedRow[]
  newRootId: string
  oidMap: Map<string, string> // sourceOid → newOid (for owned subtree only)
}

export function cloneSpecificationSubtree(args: CloneArgs): CloneResult {
  const { source, newRootVersion, account, newId } = args
  const now = args.now ?? Date.now

  // Identify source root (the one with parentSpecificationId === null OR not present in own subtree's parent set).
  const sourceIds = new Set(source.map((r) => r.id))
  const root = source.find((r) => r.parentSpecificationId === null || !sourceIds.has(r.parentSpecificationId))
  if (!root) throw new Error('cloneSpecificationSubtree: no root in source rows')

  const oidMap = new Map<string, string>()
  for (const r of source) oidMap.set(r.id, newId())

  const newRootId = oidMap.get(root.id)!

  const rows: ClonedRow[] = source.map((r) => {
    const ts = now()
    const id = oidMap.get(r.id)!
    const isRoot = r.id === root.id
    const newParent = r.parentSpecificationId !== null ? (oidMap.get(r.parentSpecificationId) ?? null) : null
    const newRoot = isRoot ? null : newRootId
    const history = isRoot
      ? serializeHistory([
          createNewVersionEntry({
            account,
            version: newRootVersion,
            fromVersion: root.version,
            fromSpecId: root.id,
          }),
        ])
      : '[]'
    return {
      ...r,
      id,
      parentSpecificationId: newParent,
      rootSpecificationId: newRoot,
      version: isRoot ? newRootVersion : r.version,
      state: 'Draft',
      data: rewriteSpecData(r.data, oidMap),
      history,
      createdAt: ts,
      updatedAt: ts,
    }
  })

  return { rows, newRootId, oidMap }
}

export interface CopyArgs {
  source: CloneSourceRow[] // one or more whole trees, any order
  /** Source id → new id for EVERY source row (and for whatever else the data may point at). */
  idMap: Map<string, string>
  libraryId: string
  account: string
  /** Extra data rewrite after the in-tree remap (e.g. references to other copied elements). */
  rewriteData?: (json: string) => string
  now?: () => number
}

/**
 * State-preserving sibling of cloneSpecificationSubtree, for copies into another
 * team: every row keeps its `state`, `version` and `history`; each root gains a
 * `copied` history entry naming its source. Ids come from `idMap`; rows land in
 * `libraryId`. Roots get the DB convention `rootSpecificationId = id`.
 */
export function copySpecificationSubtree(args: CopyArgs): ClonedRow[] {
  const { source, idMap, libraryId, account } = args
  const now = args.now ?? Date.now
  const mapped = (id: string) => {
    const to = idMap.get(id)
    if (!to) throw new Error(`copySpecificationSubtree: no new id for ${id}`)
    return to
  }
  return source.map((r) => {
    const ts = now()
    const id = mapped(r.id)
    const isRoot = r.parentSpecificationId === null
    let history = r.history
    if (isRoot) {
      const entries = parseHistory(r.history)
      entries.push(createCopiedEntry({ account, version: r.version, fromSpecId: r.id, fromLibraryId: r.libraryId }))
      history = serializeHistory(entries)
    }
    const data = rewriteSpecData(r.data, idMap)
    return {
      ...r,
      id,
      libraryId,
      parentSpecificationId: isRoot ? null : mapped(r.parentSpecificationId!),
      rootSpecificationId: isRoot ? id : mapped(r.rootSpecificationId ?? r.id),
      data: args.rewriteData ? args.rewriteData(data) : data,
      history,
      createdAt: ts,
      updatedAt: ts,
    }
  })
}

/**
 * Walks a spec's `data` jsonb and remaps any internal oid references using oidMap.
 * Reference sites covered:
 *   - `nodes[].data.embeddedWorkflowSpecId`  (workflowProxy embedded mode)
 *   - `nodes[].data.referencedStepSpecId`    (workflowProxy reference mode — only remapped if target is in oidMap)
 *
 * Targets NOT in oidMap (i.e., point outside the cloned subtree) are left untouched.
 * This preserves cross-library references at their pinned version per Q3c-i of the design spec.
 */
function rewriteSpecData(dataJson: string, oidMap: Map<string, string>): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(dataJson)
  } catch {
    return dataJson
  }
  if (!parsed || typeof parsed !== 'object') return dataJson
  const root = parsed as { nodes?: unknown }
  const nodes = Array.isArray(root.nodes) ? root.nodes : null
  if (!nodes) return dataJson

  let changed = false
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    const node = n as { type?: unknown; data?: Record<string, unknown> }
    if (node.type !== 'workflowProxy' || !node.data) continue
    for (const field of ['embeddedWorkflowSpecId', 'referencedStepSpecId'] as const) {
      const value = node.data[field]
      if (typeof value === 'string') {
        const remapped = oidMap.get(value)
        if (remapped) {
          node.data[field] = remapped
          changed = true
        }
      }
    }
  }
  return changed ? JSON.stringify(parsed) : dataJson
}
