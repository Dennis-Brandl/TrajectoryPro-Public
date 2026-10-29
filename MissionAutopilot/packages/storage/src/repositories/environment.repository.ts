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
import type { Environment, EnvironmentInput, EnvironmentRow, LifecycleState } from '../types.js'

const INSERT_SQL = `
  INSERT INTO environments (
    oid, local_id, version, last_modified_date, description,
    schema_version, action_property_specifications,
    value_property_specifications, resource_property_specifications,
    imported_at, source_filename, state
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
`

export class EnvironmentRepository {
  constructor(private readonly q: Queryable) {}

  private toRow(
    input: EnvironmentInput
  ): Omit<EnvironmentRow, 'imported_at'> & { imported_at: string } {
    return {
      oid: input.oid,
      local_id: input.local_id,
      version: input.version,
      last_modified_date: input.last_modified_date,
      description: input.description ?? null,
      schema_version: input.schema_version,
      action_property_specifications: JSON.stringify(input.action_property_specifications),
      value_property_specifications: JSON.stringify(input.value_property_specifications),
      resource_property_specifications: JSON.stringify(input.resource_property_specifications),
      imported_at: new Date().toISOString(),
      source_filename: input.source_filename,
      state: input.state ?? 'Draft',
    }
  }

  private fromRow(row: EnvironmentRow): Environment {
    return {
      oid: row.oid,
      local_id: row.local_id,
      version: row.version,
      last_modified_date: row.last_modified_date,
      description: row.description,
      schema_version: row.schema_version,
      action_property_specifications: JSON.parse(row.action_property_specifications) as unknown[],
      value_property_specifications: JSON.parse(row.value_property_specifications) as unknown[],
      resource_property_specifications: JSON.parse(
        row.resource_property_specifications
      ) as unknown[],
      imported_at: row.imported_at,
      source_filename: row.source_filename,
      state: row.state as LifecycleState,
    }
  }

  async create(input: EnvironmentInput): Promise<Environment> {
    const row = this.toRow(input)
    await this.q.query(INSERT_SQL, [
      row.oid,
      row.local_id,
      row.version,
      row.last_modified_date,
      row.description,
      row.schema_version,
      row.action_property_specifications,
      row.value_property_specifications,
      row.resource_property_specifications,
      row.imported_at,
      row.source_filename,
      row.state,
    ])
    return this.fromRow(row as EnvironmentRow)
  }

  async findByOid(oid: string): Promise<Environment | null> {
    const res = await this.q.query('SELECT * FROM environments WHERE oid = $1', [oid])
    const row = res.rows[0] as EnvironmentRow | undefined
    return row ? this.fromRow(row) : null
  }

  async findAll(): Promise<Environment[]> {
    const res = await this.q.query('SELECT * FROM environments ORDER BY local_id ASC')
    return (res.rows as EnvironmentRow[]).map((r) => this.fromRow(r))
  }

  /**
   * Transaction-scoped advisory lock on an environment NAME. Import's name
   * fallback (`syncEnvironmentRow`) takes it before scanning for a same-named
   * environment so two concurrent uploads re-keying the same name cannot both
   * miss and both create a fresh row. Released at COMMIT/ROLLBACK; outside a
   * transaction it is a no-op that releases immediately. Re-entrant per session.
   * The key shares the 64-bit advisory-lock space with `MIGRATION_LOCK_KEY`
   * (`packages/storage/src/index.ts`); a collision could only over-serialize,
   * never under-serialize.
   */
  async lockName(localId: string): Promise<void> {
    await this.q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`environment:${localId}`])
  }

  async update(oid: string, input: Partial<EnvironmentInput>): Promise<Environment | null> {
    const existing = await this.findRawByOid(oid)
    if (!existing) return null

    const fields: string[] = []
    const values: unknown[] = []
    let i = 1

    const fieldMap: Record<string, () => void> = {
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
      schema_version: () => {
        fields.push(`schema_version = $${i++}`)
        values.push(input.schema_version)
      },
      action_property_specifications: () => {
        fields.push(`action_property_specifications = $${i++}`)
        values.push(JSON.stringify(input.action_property_specifications))
      },
      value_property_specifications: () => {
        fields.push(`value_property_specifications = $${i++}`)
        values.push(JSON.stringify(input.value_property_specifications))
      },
      resource_property_specifications: () => {
        fields.push(`resource_property_specifications = $${i++}`)
        values.push(JSON.stringify(input.resource_property_specifications))
      },
      source_filename: () => {
        fields.push(`source_filename = $${i++}`)
        values.push(input.source_filename)
      },
      state: () => {
        fields.push(`state = $${i++}`)
        values.push(input.state)
      },
    }

    for (const key of Object.keys(input) as (keyof EnvironmentInput)[]) {
      if (key === 'oid') continue
      if (key in fieldMap) fieldMap[key]()
    }

    if (fields.length === 0) return this.fromRow(existing)

    values.push(oid)
    await this.q.query(`UPDATE environments SET ${fields.join(', ')} WHERE oid = $${i}`, values)

    const updated = await this.findRawByOid(oid)
    return this.fromRow(updated!)
  }

  async delete(oid: string): Promise<boolean> {
    const res = await this.q.query('DELETE FROM environments WHERE oid = $1', [oid])
    return (res.rowCount ?? 0) > 0
  }

  async findByLocalId(localId: string): Promise<Environment | null> {
    const res = await this.q.query('SELECT * FROM environments WHERE local_id = $1', [localId])
    const row = res.rows[0] as EnvironmentRow | undefined
    return row ? this.fromRow(row) : null
  }

  async count(): Promise<number> {
    const res = await this.q.query('SELECT COUNT(*)::int AS cnt FROM environments')
    return (res.rows[0] as { cnt: number }).cnt
  }

  async upsert(input: EnvironmentInput): Promise<{ environment: Environment; created: boolean }> {
    const existing = await this.findRawByOid(input.oid)
    if (!existing) {
      const environment = await this.create(input)
      return { environment, created: true }
    }
    const updatedEnv = await this.update(input.oid, input)
    return { environment: updatedEnv!, created: false }
  }

  private async findRawByOid(oid: string): Promise<EnvironmentRow | undefined> {
    const res = await this.q.query('SELECT * FROM environments WHERE oid = $1', [oid])
    return res.rows[0] as EnvironmentRow | undefined
  }
}
