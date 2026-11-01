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

import type { withTransaction } from '../../lib/db'

/** The connection-scoped query function withTransaction hands its callback. */
export type Querier = Parameters<Parameters<typeof withTransaction>[0]>[0]

export interface ElementRows {
  libraryId: string
  name: string
  /** Every version of the element: roots in the library sharing the name. */
  rootIds: string[]
  /** Roots plus all their descendants. */
  allRowIds: string[]
}

/**
 * Resolves the element a spec belongs to: every root in the same library with
 * the same name (all versions) and their full trees. `anySpecId` may be a
 * child; its root decides the library and name. With `lock`, the rows are
 * taken FOR UPDATE so the move holds them until the transaction ends.
 */
export async function loadElement(q: Querier, anySpecId: string, opts: { lock: boolean }): Promise<ElementRows | null> {
  const forUpdate = opts.lock ? ' FOR UPDATE' : ''
  const [row] = await q<{ rootSpecificationId: string }>(
    'SELECT "rootSpecificationId" FROM specification WHERE id = $1',
    [anySpecId],
  )
  if (!row) return null
  const [root] = await q<{ libraryId: string; name: string }>(
    'SELECT "libraryId", name FROM specification WHERE id = $1',
    [row.rootSpecificationId],
  )
  if (!root) return null

  const roots = await q<{ id: string }>(
    `SELECT id FROM specification
      WHERE "parentSpecificationId" IS NULL AND "libraryId" = $1 AND name = $2
      ORDER BY id${forUpdate}`,
    [root.libraryId, root.name],
  )
  const rootIds = roots.map((r) => r.id)
  if (rootIds.length === 0) return null
  const all = await q<{ id: string }>(
    `SELECT id FROM specification WHERE "rootSpecificationId" = ANY($1::text[]) ORDER BY id${forUpdate}`,
    [rootIds],
  )
  return { libraryId: root.libraryId, name: root.name, rootIds, allRowIds: all.map((r) => r.id) }
}
