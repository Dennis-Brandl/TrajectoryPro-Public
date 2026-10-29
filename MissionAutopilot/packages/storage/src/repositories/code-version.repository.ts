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

import { randomUUID } from 'node:crypto'
import type { Queryable } from '../database.js'
import { isPool, isUniqueViolation, withAtomic } from '../database.js'
import type { CodeVersion, CodeVersionInput, CodeVersionRow } from '../types.js'

export class CodeVersionRepository {
  constructor(private readonly q: Queryable) {}

  private fromRow(row: CodeVersionRow): CodeVersion {
    return {
      id: row.id,
      action_oid: row.action_oid,
      state: row.state,
      version_number: row.version_number,
      source_code: row.source_code,
      is_active: row.is_active,
      created_at: row.created_at,
      created_by: row.created_by,
      description: row.description,
    }
  }

  async save(input: CodeVersionInput): Promise<CodeVersion> {
    // version_number = MAX+1 computed inside the INSERT itself; two concurrent
    // saves can still snapshot the same MAX, so the UNIQUE(action_oid, state,
    // version_number) violation is retried with a fresh MAX — but ONLY on the
    // pool path, where each attempt auto-commits. Inside a client transaction a
    // failed statement poisons the transaction (25P02), so there we make one
    // attempt and let the error propagate (the caller's transaction rolls back).
    const maxAttempts = isPool(this.q) ? 3 : 1
    for (let attempt = 1; ; attempt++) {
      const id = randomUUID()
      const created_at = new Date().toISOString()
      try {
        const res = await this.q.query(
          `INSERT INTO code_versions
             (id, action_oid, state, version_number, source_code, is_active, created_at, created_by, description)
           SELECT $1, $2, $3,
             COALESCE((SELECT MAX(version_number)::int FROM code_versions
                        WHERE action_oid = $2 AND state = $3), 0) + 1,
             $4, false, $5, $6, $7
           RETURNING *`,
          [
            id,
            input.action_oid,
            input.state,
            input.source_code,
            created_at,
            input.created_by ?? null,
            input.description ?? null,
          ]
        )
        return this.fromRow(res.rows[0] as CodeVersionRow)
      } catch (err) {
        if (isUniqueViolation(err) && attempt < maxAttempts) continue
        throw err
      }
    }
  }

  async activate(id: string): Promise<CodeVersion | null> {
    return withAtomic(this.q, async (tx) => {
      const found = await tx.query('SELECT * FROM code_versions WHERE id = $1', [id])
      const row = found.rows[0] as CodeVersionRow | undefined
      if (!row) return null
      await tx.query(
        'UPDATE code_versions SET is_active = false WHERE action_oid = $1 AND state = $2',
        [row.action_oid, row.state]
      )
      await tx.query('UPDATE code_versions SET is_active = true WHERE id = $1', [id])
      const updated = await tx.query('SELECT * FROM code_versions WHERE id = $1', [id])
      return this.fromRow(updated.rows[0] as CodeVersionRow)
    })
  }

  async deactivate(id: string): Promise<CodeVersion | null> {
    const found = await this.q.query('SELECT * FROM code_versions WHERE id = $1', [id])
    const existing = found.rows[0] as CodeVersionRow | undefined
    if (!existing) return null

    await this.q.query('UPDATE code_versions SET is_active = false WHERE id = $1', [id])
    const updated = await this.q.query('SELECT * FROM code_versions WHERE id = $1', [id])
    return this.fromRow(updated.rows[0] as CodeVersionRow)
  }

  async getActive(actionOid: string, state: string): Promise<CodeVersion | null> {
    const res = await this.q.query(
      'SELECT * FROM code_versions WHERE action_oid = $1 AND state = $2 AND is_active LIMIT 1',
      [actionOid, state]
    )
    const row = res.rows[0] as CodeVersionRow | undefined
    return row ? this.fromRow(row) : null
  }

  async getVersionHistory(actionOid: string, state: string): Promise<CodeVersion[]> {
    const res = await this.q.query(
      'SELECT * FROM code_versions WHERE action_oid = $1 AND state = $2 ORDER BY version_number DESC',
      [actionOid, state]
    )
    return (res.rows as CodeVersionRow[]).map((r) => this.fromRow(r))
  }

  async findById(id: string): Promise<CodeVersion | null> {
    const res = await this.q.query('SELECT * FROM code_versions WHERE id = $1', [id])
    const row = res.rows[0] as CodeVersionRow | undefined
    return row ? this.fromRow(row) : null
  }

  async findByAction(actionOid: string): Promise<CodeVersion[]> {
    const res = await this.q.query(
      'SELECT * FROM code_versions WHERE action_oid = $1 ORDER BY state ASC, version_number DESC',
      [actionOid]
    )
    return (res.rows as CodeVersionRow[]).map((r) => this.fromRow(r))
  }

  async deleteByAction(actionOid: string): Promise<number> {
    const res = await this.q.query('DELETE FROM code_versions WHERE action_oid = $1', [actionOid])
    return res.rowCount ?? 0
  }

  /** Re-points every version of `fromActionOid` at `toActionOid` (import re-key). */
  async reassignAction(fromActionOid: string, toActionOid: string): Promise<number> {
    const res = await this.q.query(
      'UPDATE code_versions SET action_oid = $2 WHERE action_oid = $1',
      [fromActionOid, toActionOid]
    )
    return res.rowCount ?? 0
  }

  async clearByActionAndState(actionOid: string, state: string): Promise<number> {
    const res = await this.q.query(
      'DELETE FROM code_versions WHERE action_oid = $1 AND state = $2',
      [actionOid, state]
    )
    return res.rowCount ?? 0
  }

  async getLatestVersion(actionOid: string, state: string): Promise<CodeVersion | null> {
    const res = await this.q.query(
      'SELECT * FROM code_versions WHERE action_oid = $1 AND state = $2 ORDER BY version_number DESC LIMIT 1',
      [actionOid, state]
    )
    const row = res.rows[0] as CodeVersionRow | undefined
    return row ? this.fromRow(row) : null
  }

  async saveAndActivate(input: CodeVersionInput): Promise<CodeVersion> {
    // IMPORTANT: does NOT call this.save()/this.activate() — those run on this.q,
    // which would escape this transaction. All statements go through tx. NO retry
    // loop here: inside the open transaction a 23505 would poison it (25P02), so
    // a genuine collision propagates as an error and rolls the transaction back.
    return withAtomic(this.q, async (tx) => {
      const id = randomUUID()
      const created_at = new Date().toISOString()
      const res = await tx.query(
        `INSERT INTO code_versions
           (id, action_oid, state, version_number, source_code, is_active, created_at, created_by, description)
         SELECT $1, $2, $3,
           COALESCE((SELECT MAX(version_number)::int FROM code_versions
                      WHERE action_oid = $2 AND state = $3), 0) + 1,
           $4, false, $5, $6, $7
         RETURNING *`,
        [
          id,
          input.action_oid,
          input.state,
          input.source_code,
          created_at,
          input.created_by ?? null,
          input.description ?? null,
        ]
      )
      const saved = res.rows[0] as CodeVersionRow
      await tx.query(
        'UPDATE code_versions SET is_active = false WHERE action_oid = $1 AND state = $2',
        [saved.action_oid, saved.state]
      )
      await tx.query('UPDATE code_versions SET is_active = true WHERE id = $1', [saved.id])
      const updated = await tx.query('SELECT * FROM code_versions WHERE id = $1', [saved.id])
      return this.fromRow(updated.rows[0] as CodeVersionRow)
    })
  }

  async getAllActiveVersions(actionOid: string): Promise<CodeVersion[]> {
    const res = await this.q.query(
      'SELECT * FROM code_versions WHERE action_oid = $1 AND is_active ORDER BY state ASC',
      [actionOid]
    )
    return (res.rows as CodeVersionRow[]).map((r) => this.fromRow(r))
  }

  async count(): Promise<number> {
    const res = await this.q.query('SELECT COUNT(*)::int AS cnt FROM code_versions')
    return (res.rows[0] as { cnt: number }).cnt
  }

  async countByAction(actionOid: string): Promise<number> {
    const res = await this.q.query(
      'SELECT COUNT(*)::int AS cnt FROM code_versions WHERE action_oid = $1',
      [actionOid]
    )
    return (res.rows[0] as { cnt: number }).cnt
  }
}
