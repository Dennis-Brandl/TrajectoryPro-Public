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

// Data-safety round 2 §1 (round 3 §3: the whole removed set): the released specs a delete of a
// library removes (its tree, the library plus its sub-libraries, and everything that cascades),
// so a library delete can refuse or ask for an administrator's confirmation.

import { compareSemver } from '@/types/version'
import { editLockedStates } from '../authz/policy'

export type Q = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>

export interface ReleasedSpec {
  id: string
  name: string
  version: string
  state: string
  embeddedCount: number
}

/** The edit-locked states minus Obsolete (an Obsolete spec may be deleted). Reads app_setting via
 *  rawQuery, so call it BEFORE `withTransaction` (PGlite deadlocks otherwise). */
export async function releasedStates(): Promise<string[]> {
  return [...(await editLockedStates())].filter((s) => s !== 'Obsolete')
}

// The removed set: every spec a delete of the library removes. That is the specs in the tree
// (the library plus its sub-libraries) plus, through the ON DELETE CASCADE on
// parentSpecificationId and rootSpecificationId, every spec whose parent or root is removed,
// wherever it lives. UNION (not UNION ALL) ends the recursion: a root is its own root.
const REMOVED = `WITH RECURSIVE tree(id) AS (
  SELECT id FROM "library" WHERE id = $1
  UNION ALL
  SELECT l.id FROM "library" l JOIN tree t ON l."parentLibraryId" = t.id
), removed(id) AS (
  SELECT s.id FROM "specification" s WHERE s."libraryId" IN (SELECT id FROM tree)
  UNION
  SELECT s.id FROM "specification" s
    JOIN removed r ON s."parentSpecificationId" = r.id OR s."rootSpecificationId" = r.id
)`

/** Released specs among those a delete of `libraryId` removes (the removed set above): released
 *  removed roots, with their embedded-child count, plus any released removed child whose root is
 *  not a listed released root (its root is not released, or is not removed), listed under its
 *  root's name with the child's own id, version and state. Sorted by name then version. `lock`
 *  takes FOR UPDATE (ordered by id) on the whole removed set so a concurrent state change waits
 *  for this transaction. */
export async function findReleasedInTree(
  q: Q,
  libraryId: string,
  released: string[],
  opts: { lock?: boolean } = {},
): Promise<ReleasedSpec[]> {
  if (opts.lock) {
    await q(`${REMOVED} SELECT id FROM "specification" WHERE id IN (SELECT id FROM removed) ORDER BY id FOR UPDATE`, [
      libraryId,
    ])
  }
  if (released.length === 0) return []
  const rows = await q<{ id: string; name: string; version: string; state: string; embeddedCount: number | string }>(
    `${REMOVED}
     SELECT s.id, s.name, s.version, s.state,
            (SELECT count(*) FROM "specification" c WHERE c."rootSpecificationId" = s.id AND c.id <> s.id) AS "embeddedCount"
       FROM "specification" s
      WHERE s.id IN (SELECT id FROM removed)
        AND s."parentSpecificationId" IS NULL
        AND s.state = ANY($2::text[])
     UNION ALL
     SELECT c.id, r.name, c.version, c.state, 0 AS "embeddedCount"
       FROM "specification" c
       JOIN "specification" r ON r.id = c."rootSpecificationId"
      WHERE c.id IN (SELECT id FROM removed)
        AND c."parentSpecificationId" IS NOT NULL
        AND c.state = ANY($2::text[])
        AND NOT (r.state = ANY($2::text[])
                 AND r."parentSpecificationId" IS NULL
                 AND r.id IN (SELECT id FROM removed))`,
    [libraryId, released],
  )
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      state: r.state,
      embeddedCount: Number(r.embeddedCount),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || compareSemver(a.version, b.version))
}
