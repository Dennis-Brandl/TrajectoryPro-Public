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

// Phase 3 (design §8): auto-supersede sweep. Among the in-force versions of a
// root-spec lineage (same libraryId + name, state Effective, effectiveFrom ≤ now)
// only the newest stays Effective; the rest flip to Superseded with a system
// history entry. Future-dated versions (effectiveFrom > now) are untouched, as
// are Effective rows with no effectiveFrom (pre-Phase-3 legacy data). Pure
// function of the injected clock — tests pass a fixed `now`. Raw SQL via
// withTransaction keeps the sweep atomic on a single connection.

import { withTransaction } from '../lib/db'
import { parseHistory, serializeHistory, createStateChangeEntry } from '../../types/specification-history'
import type { SpecificationState } from '../../types/library'

export interface SupersedeSweepResult {
  superseded: string[]
}

interface CandidateRow {
  id: string
  libraryId: string
  name: string
  version: string | null
  effectiveFrom: number
  createdAt: number
  history: string
}

export async function supersedeSweep(now: number, libraryId?: string): Promise<SupersedeSweepResult> {
  const superseded: string[] = []
  await withTransaction(async (q) => {
    const baseSql = `SELECT id, "libraryId", name, version, "effectiveFrom", "createdAt", history
         FROM specification
        WHERE "parentSpecificationId" IS NULL AND state = 'Effective'
          AND "effectiveFrom" IS NOT NULL AND "effectiveFrom" <= $1`
    const orderSql = ` ORDER BY "libraryId", name, "effectiveFrom" DESC, "createdAt" DESC`
    const rawRows = libraryId
      ? await q(`${baseSql} AND "libraryId" = $2${orderSql}`, [now, libraryId])
      : await q(`${baseSql}${orderSql}`, [now])

    // I2: effectiveFrom and createdAt are bigint columns — raw query returns strings in Postgres.
    const rows: CandidateRow[] = (rawRows as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      libraryId: r.libraryId as string,
      name: r.name as string,
      version: r.version as string | null,
      effectiveFrom: Number(r.effectiveFrom),
      createdAt: Number(r.createdAt),
      history: r.history as string,
    }))

    let keeper: CandidateRow | null = null
    for (const row of rows) {
      if (!keeper || keeper.libraryId !== row.libraryId || keeper.name !== row.name) {
        keeper = row // first row per lineage = newest in-force version — stays Effective
        continue
      }
      const entry = createStateChangeEntry({
        account: 'system',
        version: row.version ?? '1.0.0',
        fromState: 'Effective' as SpecificationState,
        toState: 'Superseded' as SpecificationState,
        reason: `auto-superseded by version ${keeper.version ?? '?'} (effectiveFrom ${keeper.effectiveFrom})`,
        system: true,
      })
      await q('UPDATE specification SET state = $1, history = $2, "updatedAt" = $3 WHERE id = $4', [
        'Superseded',
        serializeHistory([...parseHistory(row.history), entry]),
        now,
        row.id,
      ])
      superseded.push(row.id)
    }
  })
  return { superseded }
}
