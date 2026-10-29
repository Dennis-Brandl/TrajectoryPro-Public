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

import type { Queryable } from '../database.js'
import { withAtomic } from '../database.js'
import type {
  ExecutionLogEntry,
  ExecutionLogInput,
  ExecutionLogRow,
  FinalStatus,
} from '../types.js'

// ---------------------------------------------------------------------------
// Query filter types
// ---------------------------------------------------------------------------

export interface LogQueryFilters {
  actionOid?: string
  actionName?: string
  environmentOid?: string
  environmentName?: string
  finalStatus?: FinalStatus
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class LogRepository {
  constructor(private readonly q: Queryable) {}

  private fromRow(row: ExecutionLogRow): ExecutionLogEntry {
    return {
      id: row.id,
      runtime_action_instance_id: row.runtime_action_instance_id,
      action_oid: row.action_oid,
      action_name: row.action_name,
      environment_oid: row.environment_oid,
      environment_name: row.environment_name,
      workflow_instance_id: row.workflow_instance_id,
      step_oid: row.step_oid,
      input_parameters: JSON.parse(row.input_parameters) as unknown[],
      output_parameters: JSON.parse(row.output_parameters) as unknown[],
      states_executed: JSON.parse(row.states_executed) as unknown[],
      code_versions_used: JSON.parse(row.code_versions_used) as Record<string, unknown>,
      started_at: row.started_at,
      completed_at: row.completed_at,
      duration_ms: row.duration_ms,
      final_status: row.final_status,
      error: row.error,
    }
  }

  private toRow(input: ExecutionLogInput): Omit<ExecutionLogRow, 'id'> {
    return {
      runtime_action_instance_id: input.runtime_action_instance_id,
      action_oid: input.action_oid,
      action_name: input.action_name,
      environment_oid: input.environment_oid,
      environment_name: input.environment_name,
      workflow_instance_id: input.workflow_instance_id,
      step_oid: input.step_oid,
      input_parameters: JSON.stringify(input.input_parameters),
      output_parameters: JSON.stringify(input.output_parameters),
      states_executed: JSON.stringify(input.states_executed),
      code_versions_used: JSON.stringify(input.code_versions_used),
      started_at: input.started_at,
      completed_at: input.completed_at,
      duration_ms: input.duration_ms,
      final_status: input.final_status,
      error: input.error ?? null,
    }
  }

  /**
   * Insert a log entry and trim to maxSize in a single transaction.
   * Returns the created entry.
   */
  async insert(input: ExecutionLogInput, maxSize: number): Promise<ExecutionLogEntry> {
    return withAtomic(this.q, async (tx) => {
      const row = this.toRow(input)
      const insertRes = await tx.query(
        `INSERT INTO execution_log (
           runtime_action_instance_id, action_oid, action_name,
           environment_oid, environment_name, workflow_instance_id, step_oid,
           input_parameters, output_parameters, states_executed, code_versions_used,
           started_at, completed_at, duration_ms, final_status, error
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
          row.runtime_action_instance_id,
          row.action_oid,
          row.action_name,
          row.environment_oid,
          row.environment_name,
          row.workflow_instance_id,
          row.step_oid,
          row.input_parameters,
          row.output_parameters,
          row.states_executed,
          row.code_versions_used,
          row.started_at,
          row.completed_at,
          row.duration_ms,
          row.final_status,
          row.error,
        ]
      )
      const insertedId = (insertRes.rows[0] as { id: number }).id

      const countRes = await tx.query('SELECT COUNT(*)::int AS cnt FROM execution_log')
      const currentCount = (countRes.rows[0] as { cnt: number }).cnt
      if (currentCount > maxSize) {
        await tx.query(
          `DELETE FROM execution_log
           WHERE id IN (SELECT id FROM execution_log ORDER BY id ASC LIMIT $1)`,
          [currentCount - maxSize]
        )
      }

      const inserted = await tx.query('SELECT * FROM execution_log WHERE id = $1', [insertedId])
      const insertedRow = inserted.rows[0] as ExecutionLogRow | undefined
      if (!insertedRow) {
        // Entry was trimmed away (maxSize 0 edge case) — reconstruct from input
        return this.fromRow({ id: insertedId, ...row } as ExecutionLogRow)
      }
      return this.fromRow(insertedRow)
    })
  }

  async findById(id: number): Promise<ExecutionLogEntry | null> {
    const res = await this.q.query('SELECT * FROM execution_log WHERE id = $1', [id])
    const row = res.rows[0] as ExecutionLogRow | undefined
    return row ? this.fromRow(row) : null
  }

  /**
   * Delete a single log row by id. Used by ExecutionLogger.writeLog(): the
   * loser of the is_logged claim (two overlapping terminal passes both
   * inserted a row before either claimed) removes the row it just inserted.
   */
  async deleteById(id: number): Promise<number> {
    const res = await this.q.query('DELETE FROM execution_log WHERE id = $1', [id])
    return res.rowCount ?? 0
  }

  /**
   * Dynamic query with optional filters and pagination.
   * Returns { entries, total } for pagination support.
   */
  async query(filters: LogQueryFilters): Promise<{ entries: ExecutionLogEntry[]; total: number }> {
    const whereClauses: string[] = []
    const params: unknown[] = []
    let i = 1

    if (filters.actionOid !== undefined) {
      whereClauses.push(`action_oid = $${i++}`)
      params.push(filters.actionOid)
    }
    if (filters.actionName !== undefined) {
      // ILIKE (not LIKE): SQLite's LIKE was case-insensitive for ASCII by
      // default, and the ported test suite asserts that behavior — PG's LIKE
      // is case-sensitive, so ILIKE is required for parity.
      whereClauses.push(`action_name ILIKE $${i++}`)
      params.push(`%${filters.actionName}%`)
    }
    if (filters.environmentOid !== undefined) {
      whereClauses.push(`environment_oid = $${i++}`)
      params.push(filters.environmentOid)
    }
    if (filters.environmentName !== undefined) {
      // ILIKE for the same reason as action_name above.
      whereClauses.push(`environment_name ILIKE $${i++}`)
      params.push(`%${filters.environmentName}%`)
    }
    if (filters.finalStatus !== undefined) {
      whereClauses.push(`final_status = $${i++}`)
      params.push(filters.finalStatus)
    }
    if (filters.startDate !== undefined) {
      whereClauses.push(`completed_at >= $${i++}`)
      params.push(filters.startDate)
    }
    if (filters.endDate !== undefined) {
      whereClauses.push(`completed_at <= $${i++}`)
      params.push(filters.endDate)
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    // Count query (no LIMIT/OFFSET) — reuses the same $1..$n placeholders/params.
    const countSql = `SELECT COUNT(*)::int AS cnt FROM execution_log ${whereClause}`
    const countRes = await this.q.query(countSql, params)
    const total = (countRes.rows[0] as { cnt: number }).cnt

    // Paginated query
    const limit = Math.min(filters.limit ?? 50, 500)
    const offset = filters.offset ?? 0
    const limitIdx = i++
    const offsetIdx = i
    const rowSql = `
      SELECT * FROM execution_log
      ${whereClause}
      ORDER BY id DESC
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `
    const rowParams = [...params, limit, offset]
    const res = await this.q.query(rowSql, rowParams)
    const entries = (res.rows as ExecutionLogRow[]).map((r) => this.fromRow(r))

    return { entries, total }
  }

  /**
   * Trim the log to maxSize entries (keeps the most recent).
   * Returns the number of deleted entries.
   */
  /** Re-points every entry of `fromEnvironmentOid` at `toEnvironmentOid` (environment re-key). */
  async reassignEnvironment(fromEnvironmentOid: string, toEnvironmentOid: string): Promise<number> {
    const res = await this.q.query(
      'UPDATE execution_log SET environment_oid = $2 WHERE environment_oid = $1',
      [fromEnvironmentOid, toEnvironmentOid]
    )
    return res.rowCount ?? 0
  }

  /** Re-points every entry of `fromActionOid` at `toActionOid` (action re-key on import). */
  async reassignAction(fromActionOid: string, toActionOid: string): Promise<number> {
    const res = await this.q.query(
      'UPDATE execution_log SET action_oid = $2 WHERE action_oid = $1',
      [fromActionOid, toActionOid]
    )
    return res.rowCount ?? 0
  }

  async trimToSize(maxSize: number): Promise<number> {
    return withAtomic(this.q, async (tx) => {
      const countRes = await tx.query('SELECT COUNT(*)::int AS cnt FROM execution_log')
      const currentCount = (countRes.rows[0] as { cnt: number }).cnt

      if (currentCount <= maxSize) return 0

      const excess = currentCount - maxSize
      const res = await tx.query(
        `DELETE FROM execution_log
         WHERE id IN (
           SELECT id FROM execution_log ORDER BY id ASC LIMIT $1
         )`,
        [excess]
      )
      return res.rowCount ?? 0
    })
  }

  async count(): Promise<number> {
    const res = await this.q.query('SELECT COUNT(*)::int AS cnt FROM execution_log')
    return (res.rows[0] as { cnt: number }).cnt
  }

  async getRecent(limit: number): Promise<ExecutionLogEntry[]> {
    const res = await this.q.query('SELECT * FROM execution_log ORDER BY id DESC LIMIT $1', [limit])
    return (res.rows as ExecutionLogRow[]).map((r) => this.fromRow(r))
  }

  async deleteAll(): Promise<number> {
    const res = await this.q.query('DELETE FROM execution_log')
    return res.rowCount ?? 0
  }
}
