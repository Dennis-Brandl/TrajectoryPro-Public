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

import { createNewVersionEntry, serializeHistory } from '../../types/specification-history'

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
