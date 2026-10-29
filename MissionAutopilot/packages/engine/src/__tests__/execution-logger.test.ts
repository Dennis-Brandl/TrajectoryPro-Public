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

/**
 * execution-logger.test.ts — Regression test for the stale is_logged race,
 * and for the lost-log window a naive "claim first" fix would reopen.
 *
 * Original bug: writeLog() guarded on the CALLER's `instance.is_logged`
 * snapshot, then inserted the log row, then marked is_logged true. Two
 * overlapping terminal passes for the same instance (e.g. a duplicate
 * onTerminal callback, or a retry racing the original) could both see
 * is_logged=false on their snapshot, both pass the guard, and both insert —
 * a duplicate log row for one terminal instance.
 *
 * A "claim first" fix (mark is_logged before inserting) closes that race but
 * opens a worse one: a process death between the claim and the insert leaves
 * is_logged=true with NO log row, and InstanceRepository.cleanup() later
 * deletes the instance — the execution vanishes without a trace, and nothing
 * un-claims it (no sweep reads is_logged to recover such rows).
 *
 * The actual fix inserts FIRST, then claims: `markLogged()`'s existing
 * `UPDATE … WHERE NOT is_logged` decides exactly one winner among overlapping
 * terminal passes, and the loser deletes the row it just inserted. A crash
 * between insert and claim leaves the row in place with is_logged still
 * false — the instance (and its log) is retained, not lost.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  InstanceRepository,
  ActionRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
  SettingsRepository,
} from '@mission/autopilot-storage'
import { createTestDb, type TestDb } from '@mission/autopilot-storage/testing'
import { ExecutionLogger } from '../instance-manager/execution-logger.js'

describe('ExecutionLogger.writeLog', () => {
  let db: TestDb
  let instanceRepo: InstanceRepository
  let actionRepo: ActionRepository
  let environmentRepo: EnvironmentRepository
  let codeVersionRepo: CodeVersionRepository
  let logRepo: LogRepository
  let settingsRepo: SettingsRepository
  let logger: ExecutionLogger
  let instanceId: string

  beforeEach(async () => {
    db = await createTestDb()
    instanceRepo = new InstanceRepository(db)
    actionRepo = new ActionRepository(db)
    environmentRepo = new EnvironmentRepository(db)
    codeVersionRepo = new CodeVersionRepository(db)
    logRepo = new LogRepository(db)
    settingsRepo = new SettingsRepository(db)
    logger = new ExecutionLogger(
      actionRepo,
      environmentRepo,
      codeVersionRepo,
      logRepo,
      settingsRepo,
      instanceRepo
    )

    const envOid = `env-${Date.now()}-${Math.random()}`
    await environmentRepo.create({
      oid: envOid,
      local_id: 'test-env',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      schema_version: '1',
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'test.json',
    })

    const actionOid = `action-${Date.now()}-${Math.random()}`
    await actionRepo.create({
      oid: actionOid,
      environment_oid: envOid,
      local_id: 'test-action',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      action_visibility: 'observable',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
    })

    const instance = await instanceRepo.create({
      runtime_action_instance_id: 'placeholder',
      action_oid: actionOid,
      environment_oid: envOid,
      workflow_instance_id: 'wf-1',
      step_instance_id: 'step-1',
      step_oid: 'step-oid-1',
      visibility: 'observable',
      state: 'STARTING',
      input_parameters: [],
      output_parameters: [],
      state_history: [{ state: 'STARTING', timestamp: new Date().toISOString() }],
      pinned_code_versions: [],
      states_with_code_executed: [],
    })
    instanceId = instance.runtime_action_instance_id
    await instanceRepo.updateState(instanceId, 'COMPLETED', {
      completed_at: new Date().toISOString(),
    })
  })

  afterEach(async () => {
    await db.close()
  })

  it('two concurrent writeLog calls for the same terminal instance produce exactly one row', async () => {
    const snapshot = (await instanceRepo.findById(instanceId))!
    await Promise.all([
      logger.writeLog(instanceId, 'COMPLETED', snapshot),
      logger.writeLog(instanceId, 'COMPLETED', snapshot),
    ])
    expect((await logRepo.query({})).total).toBe(1)
    expect((await instanceRepo.findById(instanceId))!.is_logged).toBe(true)
  })

  it('the loser of the claim deletes its own row', async () => {
    const snapshot = (await instanceRepo.findById(instanceId))!
    const insertSpy = vi.spyOn(logRepo, 'insert')
    const deleteSpy = vi.spyOn(logRepo, 'deleteById')
    // First writeLog call wins the claim (real markLogged call, so is_logged
    // actually flips true in storage); the second — which already inserted
    // its own row before calling markLogged — is forced to lose and must
    // delete the row it just inserted.
    const originalMarkLogged = instanceRepo.markLogged.bind(instanceRepo)
    const markLoggedSpy = vi
      .spyOn(instanceRepo, 'markLogged')
      .mockImplementationOnce((id: string) => originalMarkLogged(id))
      .mockResolvedValueOnce(false)

    await logger.writeLog(instanceId, 'COMPLETED', snapshot)
    await logger.writeLog(instanceId, 'COMPLETED', snapshot)

    const insertedEntries = await Promise.all(insertSpy.mock.results.map((r) => r.value))
    const loserId = insertedEntries[1]!.id

    expect((await logRepo.query({})).total).toBe(1)
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledWith(loserId)
    expect((await instanceRepo.findById(instanceId))!.is_logged).toBe(true)

    markLoggedSpy.mockRestore()
  })

  it('a failed insert leaves is_logged false, with nothing to give back', async () => {
    const snapshot = (await instanceRepo.findById(instanceId))!
    const insertSpy = vi.spyOn(logRepo, 'insert').mockRejectedValueOnce(new Error('boom'))

    await expect(logger.writeLog(instanceId, 'COMPLETED', snapshot)).rejects.toThrow('boom')
    expect((await instanceRepo.findById(instanceId))!.is_logged).toBe(false)
    expect((await logRepo.query({})).total).toBe(0)

    insertSpy.mockRestore()
    await logger.writeLog(instanceId, 'COMPLETED', snapshot)
    expect((await logRepo.query({})).total).toBe(1)
    expect((await instanceRepo.findById(instanceId))!.is_logged).toBe(true)
  })
})
