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

// One-time boot pass (spec 2026-10-19 §B.3): Designer used to stamp
// actionProxyConfig.timeout_ms = 30000 into ACTION PROXY nodes with no UI to set it.
// Now that the field is user-settable a 30000 may be deliberate, so the old stamps are
// cleared ONCE (app_setting marker, not the per-row dataSchemaVersion), only in editable
// specs (a child is judged by its root's state). updatedAt/dataSchemaVersion untouched.

import { rawQuery, withTransaction } from './db'

export const ACTION_TIMEOUT_CLEAR_KEY = 'actionProxyTimeoutClearV1'
export const STAMPED_TIMEOUT_MS = 30000

/** Pure: deletes actionProxyConfig.timeout_ms === 30000 on every node in data.nodes; returns how many. */
export function clearStampedTimeouts(data: Record<string, unknown>): number {
  const nodes = Array.isArray(data.nodes) ? (data.nodes as Array<Record<string, unknown>>) : []
  let cleared = 0
  for (const node of nodes) {
    const nodeData = node?.data as Record<string, unknown> | undefined
    const cfg = nodeData?.actionProxyConfig as Record<string, unknown> | undefined
    if (cfg && typeof cfg === 'object' && cfg.timeout_ms === STAMPED_TIMEOUT_MS) {
      delete cfg.timeout_ms
      cleared++
    }
  }
  return cleared
}

export async function clearStampedActionTimeouts(): Promise<{
  skipped: boolean
  specs: number
  steps: number
  unreadable: number
  failed: number
}> {
  const done = await rawQuery(`SELECT 1 FROM "app_setting" WHERE key = $1`, [ACTION_TIMEOUT_CLEAR_KEY])
  if (done.length > 0) return { skipped: true, specs: 0, steps: 0, unreadable: 0, failed: 0 }

  const rows = await rawQuery<{ id: string; name: string; data: string }>(
    `SELECT s.id, s.name, s.data FROM "specification" s
     LEFT JOIN "specification" r ON r.id = s."rootSpecificationId"
     WHERE COALESCE(r.state, s.state) IN ('Draft', 'InTest', 'InReview')`,
  )

  let specs = 0
  let steps = 0
  let failed = 0
  const unreadableIds: string[] = []
  for (const row of rows) {
    // A permanently unreadable row must not block the marker (it would re-clear deliberate 30000s every boot).
    let parsed: Record<string, unknown> | null = null
    try {
      const p: unknown = JSON.parse(row.data)
      if (p && typeof p === 'object' && !Array.isArray(p)) parsed = p as Record<string, unknown>
    } catch {
      parsed = null
    }
    if (!parsed) {
      unreadableIds.push(row.id)
      console.warn(`[migration] action timeout clear: spec "${row.name}" (${row.id}) is unreadable — skipped`)
      continue
    }
    const data = parsed
    try {
      await withTransaction(async (q) => {
        const n = clearStampedTimeouts(data)
        if (n > 0) {
          await q(`UPDATE "specification" SET data = $1 WHERE id = $2`, [JSON.stringify(data), row.id])
          specs++
          steps += n
        }
      })
    } catch (e) {
      failed++
      console.error(
        `[migration] action timeout clear FAILED spec "${row.name}" (${row.id}) — will retry next boot:`,
        e instanceof Error ? e.message : e,
      )
    }
  }

  const unreadable = unreadableIds.length
  console.info(
    `[migration] action timeout clear: ${specs} specs, ${steps} steps cleared, ${unreadable} unreadable, ${failed} failed`,
  )
  if (failed === 0) {
    await rawQuery(`INSERT INTO "app_setting" (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [
      ACTION_TIMEOUT_CLEAR_KEY,
      JSON.stringify({ ranAt: new Date().toISOString(), specs, steps, unreadable, unreadableIds }),
    ])
  }
  return { skipped: false, specs, steps, unreadable, failed }
}
