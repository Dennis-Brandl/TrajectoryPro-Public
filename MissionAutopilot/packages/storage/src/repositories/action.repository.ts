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
import type { Action, ActionInput, ActionRow, SignatureChange } from '../types.js'

const INSERT_SQL = `
  INSERT INTO actions (
    oid, environment_oid, local_id, version, last_modified_date, description,
    action_visibility, input_parameter_specifications,
    output_parameter_specifications, property_specifications, timeout_seconds,
    state, signature_change, orphaned_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
`

export class ActionRepository {
  constructor(private readonly q: Queryable) {}

  private toRow(input: ActionInput): ActionRow {
    return {
      oid: input.oid,
      environment_oid: input.environment_oid,
      local_id: input.local_id,
      version: input.version,
      last_modified_date: input.last_modified_date,
      description: input.description ?? null,
      action_visibility: input.action_visibility,
      input_parameter_specifications: JSON.stringify(input.input_parameter_specifications),
      output_parameter_specifications: JSON.stringify(input.output_parameter_specifications),
      property_specifications: JSON.stringify(input.property_specifications),
      timeout_seconds: input.timeout_seconds ?? null,
      state: input.state ?? 'Draft',
      signature_change: input.signature_change ? JSON.stringify(input.signature_change) : null,
      orphaned_at: input.orphaned_at ?? null,
    }
  }

  private fromRow(row: ActionRow): Action {
    return {
      oid: row.oid,
      environment_oid: row.environment_oid,
      local_id: row.local_id,
      version: row.version,
      last_modified_date: row.last_modified_date,
      description: row.description,
      action_visibility: row.action_visibility,
      input_parameter_specifications: JSON.parse(row.input_parameter_specifications) as unknown[],
      output_parameter_specifications: JSON.parse(row.output_parameter_specifications) as unknown[],
      property_specifications: JSON.parse(row.property_specifications) as unknown[],
      timeout_seconds: row.timeout_seconds,
      state: row.state as Action['state'],
      signature_change: row.signature_change
        ? (JSON.parse(row.signature_change) as SignatureChange)
        : null,
      orphaned_at: row.orphaned_at,
    }
  }

  async create(input: ActionInput): Promise<Action> {
    const row = this.toRow(input)
    await this.q.query(INSERT_SQL, [
      row.oid,
      row.environment_oid,
      row.local_id,
      row.version,
      row.last_modified_date,
      row.description,
      row.action_visibility,
      row.input_parameter_specifications,
      row.output_parameter_specifications,
      row.property_specifications,
      row.timeout_seconds,
      row.state,
      row.signature_change,
      row.orphaned_at,
    ])
    return this.fromRow(row)
  }

  async findByOid(oid: string): Promise<Action | null> {
    const res = await this.q.query('SELECT * FROM actions WHERE oid = $1', [oid])
    const row = res.rows[0] as ActionRow | undefined
    return row ? this.fromRow(row) : null
  }

  async findByEnvironment(environmentOid: string): Promise<Action[]> {
    const res = await this.q.query(
      'SELECT * FROM actions WHERE environment_oid = $1 ORDER BY local_id ASC',
      [environmentOid]
    )
    return (res.rows as ActionRow[]).map((r) => this.fromRow(r))
  }

  async findAll(): Promise<Action[]> {
    const res = await this.q.query('SELECT * FROM actions ORDER BY local_id ASC')
    return (res.rows as ActionRow[]).map((r) => this.fromRow(r))
  }

  async update(oid: string, input: Partial<ActionInput>): Promise<Action | null> {
    const existing = await this.findRawByOid(oid)
    if (!existing) return null

    const fields: string[] = []
    const values: unknown[] = []
    let i = 1

    const fieldMap: Record<string, () => void> = {
      environment_oid: () => {
        fields.push(`environment_oid = $${i++}`)
        values.push(input.environment_oid)
      },
      local_id: () => {
        fields.push(`local_id = $${i++}`)
        values.push(input.local_id)
      },
      version: () => {
        fields.push(`version = $${i++}`)
        values.push(input.version)
      },
      last_modified_date: () => {
        fields.push(`last_modified_date = $${i++}`)
        values.push(input.last_modified_date)
      },
      description: () => {
        fields.push(`description = $${i++}`)
        values.push(input.description ?? null)
      },
      action_visibility: () => {
        fields.push(`action_visibility = $${i++}`)
        values.push(input.action_visibility)
      },
      input_parameter_specifications: () => {
        fields.push(`input_parameter_specifications = $${i++}`)
        values.push(JSON.stringify(input.input_parameter_specifications))
      },
      output_parameter_specifications: () => {
        fields.push(`output_parameter_specifications = $${i++}`)
        values.push(JSON.stringify(input.output_parameter_specifications))
      },
      property_specifications: () => {
        fields.push(`property_specifications = $${i++}`)
        values.push(JSON.stringify(input.property_specifications))
      },
      timeout_seconds: () => {
        fields.push(`timeout_seconds = $${i++}`)
        values.push(input.timeout_seconds ?? null)
      },
      state: () => {
        fields.push(`state = $${i++}`)
        values.push(input.state)
      },
      signature_change: () => {
        fields.push(`signature_change = $${i++}`)
        values.push(input.signature_change ? JSON.stringify(input.signature_change) : null)
      },
      orphaned_at: () => {
        fields.push(`orphaned_at = $${i++}`)
        values.push(input.orphaned_at ?? null)
      },
    }

    for (const key of Object.keys(input) as (keyof ActionInput)[]) {
      if (key === 'oid') continue
      if (key in fieldMap) fieldMap[key]()
    }

    if (fields.length === 0) return this.fromRow(existing)

    values.push(oid)
    await this.q.query(`UPDATE actions SET ${fields.join(', ')} WHERE oid = $${i}`, values)

    const updated = await this.findRawByOid(oid)
    return this.fromRow(updated!)
  }

  async delete(oid: string): Promise<boolean> {
    const res = await this.q.query('DELETE FROM actions WHERE oid = $1', [oid])
    return (res.rowCount ?? 0) > 0
  }

  /** Re-points every action of `fromEnvironmentOid` at `toEnvironmentOid` (environment re-key). */
  async reassignEnvironment(fromEnvironmentOid: string, toEnvironmentOid: string): Promise<number> {
    const res = await this.q.query(
      'UPDATE actions SET environment_oid = $2 WHERE environment_oid = $1',
      [fromEnvironmentOid, toEnvironmentOid]
    )
    return res.rowCount ?? 0
  }

  async deleteByEnvironment(environmentOid: string): Promise<number> {
    const res = await this.q.query('DELETE FROM actions WHERE environment_oid = $1', [
      environmentOid,
    ])
    return res.rowCount ?? 0
  }

  async count(): Promise<number> {
    const res = await this.q.query('SELECT COUNT(*)::int AS cnt FROM actions')
    return (res.rows[0] as { cnt: number }).cnt
  }

  async countByEnvironment(environmentOid: string): Promise<number> {
    const res = await this.q.query(
      'SELECT COUNT(*)::int AS cnt FROM actions WHERE environment_oid = $1',
      [environmentOid]
    )
    return (res.rows[0] as { cnt: number }).cnt
  }

  async upsert(input: ActionInput): Promise<{ action: Action; created: boolean }> {
    const existing = await this.findRawByOid(input.oid)
    if (!existing) {
      const action = await this.create(input)
      return { action, created: true }
    }
    const updatedAction = await this.update(input.oid, input)
    return { action: updatedAction!, created: false }
  }

  private async findRawByOid(oid: string): Promise<ActionRow | undefined> {
    const res = await this.q.query('SELECT * FROM actions WHERE oid = $1', [oid])
    return res.rows[0] as ActionRow | undefined
  }
}
