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

import type { ChildSpecification } from '@/types/library'

/**
 * The minimal spec shape `collectChildTree` needs — a structural subset of the
 * specificationStore `Specification` so this stays decoupled from the store and
 * unit-testable with plain objects.
 */
export interface TreeSpec {
  id: string
  parentSpecificationId: string | null
  name: string
  description: string | null
  typeName?: string | null
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/**
 * Walk the loaded descendant tree of `rootId` (the specificationStore
 * `childrenOf` index — parentId → direct children, populated by `loadTree` when
 * a workflow opens) and convert it to the flat `ChildSpecification[]` that
 * `buildNestedChildExport` (in workflow-exporters.ts) consumes.
 *
 * `parentChildSpecId` follows the export tree's linkage convention: `null` for a
 * direct child of the root, otherwise the parent spec's id. A seen-set seeded
 * with the root guards against cycles and prevents the root ever appearing as
 * its own descendant. Returns `[]` when nothing is loaded — so a caller that
 * gathers no tree simply exports the top-level workflow (no regression).
 */
export function collectChildTree(
  rootId: string,
  childrenOf: ReadonlyMap<string, readonly TreeSpec[]>,
): ChildSpecification[] {
  const out: ChildSpecification[] = []
  const seen = new Set<string>([rootId])
  let frontier: string[] = [rootId]
  let depth = 1

  while (frontier.length > 0) {
    const next: string[] = []
    for (const parentId of frontier) {
      for (const child of childrenOf.get(parentId) ?? []) {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        out.push({
          id: child.id,
          parentSpecificationId: child.parentSpecificationId ?? rootId,
          parentChildSpecId: child.parentSpecificationId === rootId ? null : child.parentSpecificationId,
          name: child.name,
          description: child.description,
          typeName: child.typeName ?? null,
          data: child.data,
          depth,
          createdAt: child.createdAt,
          updatedAt: child.updatedAt,
        })
        next.push(child.id)
      }
    }
    frontier = next
    depth++
  }

  return out
}
