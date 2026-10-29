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
import { withAtomic } from '../database.js'
import type { Instance, InstanceInput, InstanceRow } from '../types.js'

const INSERT_SQL = `
  INSERT INTO instances (
    runtime_action_instance_id, action_oid, environment_oid,
    workflow_instance_id, step_instance_id, step_oid,
    visibility, state,
    input_parameters, output_parameters, state_history,
    pinned_code_versions, states_with_code_executed,
    created_at, started_at, completed_at, error, traceback, is_logged
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
`

export class InstanceRepository {
  constructor(private readonly q: Queryable) {}

  private fromRow(row: InstanceRow): Instance {
    return {
      runtime_action_instance_id: row.runtime_action_instance_id,
      action_oid: row.action_oid,
      environment_oid: row.environment_oid,
      workflow_instance_id: row.workflow_instance_id,
      step_instance_id: row.step_instance_id,
      step_oid: row.step_oid,
      visibility: row.visibility,
      state: row.state,
      input_parameters: JSON.parse(row.input_parameters) as unknown[],
      output_parameters: JSON.parse(row.output_parameters) as unknown[],
      state_history: JSON.parse(row.state_history) as unknown[],
      pinned_code_versions: JSON.parse(row.pinned_code_versions) as unknown[],
      states_with_code_executed: JSON.parse(row.states_with_code_executed) as unknown[],
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      error: row.error,
      traceback: row.traceback,
      is_logged: row.is_logged,
    }
  }

  async create(input: InstanceInput): Promise<Instance> {
    const created_at = new Date().toISOString()
    const initialHistory = JSON.stringify([{ state: input.state, timestamp: created_at }])

    const row: InstanceRow = {
      runtime_action_instance_id: randomUUID(),
      action_oid: input.action_oid,
      environment_oid: input.environment_oid,
      workflow_instance_id: input.workflow_instance_id,
      step_instance_id: input.step_instance_id,
      step_oid: input.step_oid,
      visibility: input.visibility,
      state: input.state,
      input_parameters: JSON.stringify(input.input_parameters),
      output_parameters: JSON.stringify(input.output_parameters),
      state_history: initialHistory,
      pinned_code_versions: JSON.stringify(input.pinned_code_versions),
      states_with_code_executed: JSON.stringify(input.states_with_code_executed),
      created_at,
      started_at: null,
      completed_at: null,
      error: null,
      traceback: null,
      is_logged: false,
    }

    await this.q.query(INSERT_SQL, [
      row.runtime_action_instance_id,
      row.action_oid,
      row.environment_oid,
      row.workflow_instance_id,
      row.step_instance_id,
      row.step_oid,
      row.visibility,
      row.state,
      row.input_parameters,
      row.output_parameters,
      row.state_history,
      row.pinned_code_versions,
      row.states_with_code_executed,
      row.created_at,
      row.started_at,
      row.completed_at,
      row.error,
      row.traceback,
      row.is_logged,
    ])
    return this.fromRow(row)
  }

  async findById(id: string): Promise<Instance | null> {
    const res = await this.q.query(
      'SELECT * FROM instances WHERE runtime_action_instance_id = $1',
      [id]
    )
    const row = res.rows[0] as InstanceRow | undefined
    return row ? this.fromRow(row) : null
  }

  async updateState(
    id: string,
    newState: string,
    updates?: {
      started_at?: string
      completed_at?: string
      error?: string | null
      traceback?: string | null
    }
  ): Promise<Instance | null> {
    const out = await this.transitionState(id, null, newState, updates)
    return out === 'not_found' || out === 'stale' ? null : out
  }

  /**
   * Compare-and-set state transition. Reads the row FOR UPDATE inside one
   * transaction; when `expectedState` is given and the stored state differs,
   * returns 'stale' and writes nothing (the caller's command was validated
   * against a snapshot that no longer holds). `expectedState: null` = unconditional.
   */
  async transitionState(
    id: string,
    expectedState: string | null,
    newState: string,
    updates?: {
      started_at?: string
      completed_at?: string
      error?: string | null
      traceback?: string | null
    }
  ): Promise<Instance | 'not_found' | 'stale'> {
    return withAtomic(this.q, async (tx) => {
      const found = await tx.query(
        'SELECT * FROM instances WHERE runtime_action_instance_id = $1 FOR UPDATE',
        [id]
      )
      const existing = found.rows[0] as InstanceRow | undefined
      if (!existing) return 'not_found'
      if (expectedState !== null && existing.state !== expectedState) return 'stale'

      const currentHistory = JSON.parse(existing.state_history) as unknown[]
      const newHistoryEntry = { state: newState, timestamp: new Date().toISOString() }
      const newHistory = JSON.stringify([...currentHistory, newHistoryEntry])

      let i = 1
      const fields: string[] = [`state = $${i++}`, `state_history = $${i++}`]
      const values: unknown[] = [newState, newHistory]

      if (updates?.started_at !== undefined) {
        fields.push(`started_at = $${i++}`)
        values.push(updates.started_at)
      }
      if (updates?.completed_at !== undefined) {
        fields.push(`completed_at = $${i++}`)
        values.push(updates.completed_at)
      }
      if (updates?.error !== undefined) {
        fields.push(`error = $${i++}`)
        values.push(updates.error)
      }
      if (updates?.traceback !== undefined) {
        fields.push(`traceback = $${i++}`)
        values.push(updates.traceback)
      }

      values.push(id)
      await tx.query(
        `UPDATE instances SET ${fields.join(', ')} WHERE runtime_action_instance_id = $${i}`,
        values
      )
      const updated = await tx.query(
        'SELECT * FROM instances WHERE runtime_action_instance_id = $1',
        [id]
      )
      return this.fromRow(updated.rows[0] as InstanceRow)
    })
  }

  async updateOutputParameters(id: string, outputParameters: unknown[]): Promise<Instance | null> {
    const res = await this.q.query(
      `UPDATE instances SET output_parameters = $1 WHERE runtime_action_instance_id = $2`,
      [JSON.stringify(outputParameters), id]
    )
    if ((res.rowCount ?? 0) === 0) return null
    const found = await this.q.query(
      'SELECT * FROM instances WHERE runtime_action_instance_id = $1',
      [id]
    )
    return this.fromRow(found.rows[0] as InstanceRow)
  }

  async markStatesWithCodeExecuted(id: string, states: string[]): Promise<Instance | null> {
    const res = await this.q.query(
      `UPDATE instances SET states_with_code_executed = $1 WHERE runtime_action_instance_id = $2`,
      [JSON.stringify(states), id]
    )
    if ((res.rowCount ?? 0) === 0) return null
    const found = await this.q.query(
      'SELECT * FROM instances WHERE runtime_action_instance_id = $1',
      [id]
    )
    return this.fromRow(found.rows[0] as InstanceRow)
  }

  async markLogged(id: string): Promise<boolean> {
    const res = await this.q.query(
      `UPDATE instances SET is_logged = true
       WHERE runtime_action_instance_id = $1 AND NOT is_logged`,
      [id]
    )
    return (res.rowCount ?? 0) > 0
  }

  async findByStatus(state: string): Promise<Instance[]> {
    const res = await this.q.query(
      'SELECT * FROM instances WHERE state = $1 ORDER BY created_at DESC',
      [state]
    )
    return (res.rows as InstanceRow[]).map((r) => this.fromRow(r))
  }

  async findActive(): Promise<Instance[]> {
    const res = await this.q.query(
      'SELECT * FROM instances WHERE completed_at IS NULL ORDER BY created_at DESC'
    )
    return (res.rows as InstanceRow[]).map((r) => this.fromRow(r))
  }

  async findByAction(actionOid: string): Promise<Instance[]> {
    const res = await this.q.query(
      'SELECT * FROM instances WHERE action_oid = $1 ORDER BY created_at DESC',
      [actionOid]
    )
    return (res.rows as InstanceRow[]).map((r) => this.fromRow(r))
  }

  async findByWorkflow(workflowInstanceId: string): Promise<Instance[]> {
    const res = await this.q.query('SELECT * FROM instances WHERE workflow_instance_id = $1', [
      workflowInstanceId,
    ])
    return (res.rows as InstanceRow[]).map((r) => this.fromRow(r))
  }

  /** True when the environment has any instance that has not completed. */
  async hasActiveByEnvironment(environmentOid: string): Promise<boolean> {
    const res = await this.q.query(
      'SELECT 1 FROM instances WHERE environment_oid = $1 AND completed_at IS NULL LIMIT 1',
      [environmentOid]
    )
    return res.rows.length > 0
  }

  /** Deletes only completed instances; an incomplete one is kept (a leak then trips the FK, not data loss). */
  async deleteByEnvironment(environmentOid: string): Promise<number> {
    const res = await this.q.query(
      'DELETE FROM instances WHERE environment_oid = $1 AND completed_at IS NOT NULL',
      [environmentOid]
    )
    return res.rowCount ?? 0
  }

  async deleteByAction(actionOid: string): Promise<number> {
    const res = await this.q.query('DELETE FROM instances WHERE action_oid = $1', [actionOid])
    return res.rowCount ?? 0
  }

  /** Re-points every instance of `fromEnvironmentOid` at `toEnvironmentOid` (environment re-key). */
  async reassignEnvironment(fromEnvironmentOid: string, toEnvironmentOid: string): Promise<number> {
    const res = await this.q.query(
      'UPDATE instances SET environment_oid = $2 WHERE environment_oid = $1',
      [fromEnvironmentOid, toEnvironmentOid]
    )
    return res.rowCount ?? 0
  }

  /** Re-points every instance of `fromActionOid` at `toActionOid` (import re-key). */
  async reassignAction(fromActionOid: string, toActionOid: string): Promise<number> {
    const res = await this.q.query('UPDATE instances SET action_oid = $2 WHERE action_oid = $1', [
      fromActionOid,
      toActionOid,
    ])
    return res.rowCount ?? 0
  }

  /**
   * Force-delete a single instance row by id, ignoring its state. Used by the
   * management `DELETE /instances/:id` route so operators can clean up
   * instances stuck in non-terminal states (e.g. ABORTING with a dead worker)
   * that would otherwise block environment deletion. Returns the number of
   * rows removed (0 if not found, 1 on success).
   */
  async deleteById(instanceId: string): Promise<number> {
    const res = await this.q.query('DELETE FROM instances WHERE runtime_action_instance_id = $1', [
      instanceId,
    ])
    return res.rowCount ?? 0
  }

  async cleanup(retentionHours: number): Promise<number> {
    const threshold = new Date(Date.now() - retentionHours * 3600000).toISOString()
    const res = await this.q.query(
      `DELETE FROM instances
       WHERE completed_at IS NOT NULL
         AND is_logged
         AND completed_at < $1`,
      [threshold]
    )
    return res.rowCount ?? 0
  }

  async count(): Promise<number> {
    const res = await this.q.query('SELECT COUNT(*)::int AS cnt FROM instances')
    return (res.rows[0] as { cnt: number }).cnt
  }

  async countActive(): Promise<number> {
    const res = await this.q.query(
      'SELECT COUNT(*)::int AS cnt FROM instances WHERE completed_at IS NULL'
    )
    return (res.rows[0] as { cnt: number }).cnt
  }

  async findAll(limit?: number, offset?: number): Promise<Instance[]> {
    let sql = `SELECT * FROM instances ORDER BY created_at DESC`
    const params: unknown[] = []
    let i = 1

    if (limit !== undefined) {
      sql += ` LIMIT $${i++}`
      params.push(limit)
      if (offset !== undefined) {
        sql += ` OFFSET $${i}`
        params.push(offset)
      }
    }

    const res = await this.q.query(sql, params)
    return (res.rows as InstanceRow[]).map((r) => this.fromRow(r))
  }
}
