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

import { GLOBAL_TEAM_ID } from '@/lib/global-team'

type Q = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>

/**
 * Build a `{ envLibraryName → { envSpecName → envSpecId } }` lookup from the
 * post-apply DB state. Used by resolvePendingEnvSpecsForRow to remap inlined
 * env-spec references in imported workflow/step specs back to concrete OIDs.
 *
 * Querying the DB after the apply loop (rather than tracking during apply)
 * automatically picks up the right OID for every resolution outcome: a
 * created/added/replaced env spec uses its bundle OID; a `conflict + keep`
 * env spec keeps its pre-existing OID; a no-op env spec already had the
 * bundle's OID. The map covers every env library in the DB — extra entries
 * are harmless since the resolver only reads keys it needs.
 *
 * Several teams may hold an environment library of the same name. The import's
 * target team wins, then GLOBAL, then any other team (spec 2026-10-12 U4) —
 * rows are read lowest priority first so a later row overwrites.
 */
export async function buildEnvSpecLookup(q: Q, teamId: string): Promise<Map<string, Map<string, string>>> {
  const envLibs = await q<{ id: string; name: string }>(
    `SELECT id, name FROM "library" WHERE "entityType" = 'environment'
      ORDER BY CASE WHEN "teamId" = $1 THEN 2 WHEN "teamId" = $2 THEN 1 ELSE 0 END, "createdAt", id`,
    [teamId, GLOBAL_TEAM_ID],
  )
  const out = new Map<string, Map<string, string>>()
  for (const lib of envLibs) {
    const specRows = await q<{ id: string; name: string }>(
      'SELECT id, name FROM "specification" WHERE "libraryId" = $1',
      [lib.id],
    )
    const inner = new Map<string, string>()
    for (const s of specRows) inner.set(s.name, s.id)
    out.set(lib.name, inner)
  }
  return out
}
