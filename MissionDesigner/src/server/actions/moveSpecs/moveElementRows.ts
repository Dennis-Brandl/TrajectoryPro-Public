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

import { createMovedEntry, parseHistory, serializeHistory } from '../../../types/specification-history'
import { SPEC_MOVE_FLAG_SQL } from './flag'
import type { ElementRows, Querier } from './loadElement'

/**
 * Re-parents every row of the element into `toLibraryId` and appends a `moved`
 * history entry to each root. Ids, states, versions and root links are left
 * alone. Must run inside the caller's transaction.
 */
export async function moveElementRows(
  q: Querier,
  el: ElementRows,
  toLibraryId: string,
  account: string,
  entry: { fromTeamId?: string; toTeamId?: string },
): Promise<void> {
  await q(SPEC_MOVE_FLAG_SQL)
  await q('UPDATE specification SET "libraryId" = $1, "updatedAt" = $2 WHERE id = ANY($3::text[])', [
    toLibraryId,
    Date.now(),
    el.allRowIds,
  ])
  const roots = await q<{ id: string; version: string; history: string | null }>(
    'SELECT id, version, history FROM specification WHERE id = ANY($1::text[])',
    [el.rootIds],
  )
  for (const r of roots) {
    const history = parseHistory(r.history)
    history.push(
      createMovedEntry({
        account,
        version: r.version,
        fromLibraryId: el.libraryId,
        toLibraryId,
        ...entry,
      }),
    )
    await q('UPDATE specification SET history = $1 WHERE id = $2', [serializeHistory(history), r.id])
  }
}
