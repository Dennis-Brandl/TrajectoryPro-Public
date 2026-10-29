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
 * import-preserve-code.test.ts — an environment re-import must never wipe
 * authored state code.
 *
 *   - Designer emits a NEW oid for an action after "Create New Version" or a
 *     delete-and-recreate; the importer used to treat the old oid as an orphan
 *     and hard-delete it with every code version. Now an unmatched oid falls
 *     back to a name match inside the environment and the row is re-keyed.
 *   - An action that vanished from the package keeps its row (flagged
 *     `orphaned_at`) when it has code; without code it is deleted as before.
 *   - A matched action that already has code gets a `signature_change` flag
 *     when its input/output signature differs from the one the code was
 *     written against. The baseline survives further re-imports until the
 *     author resolves it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import request from 'supertest'
import JSZip from 'jszip'
import {
  ActionRepository,
  InstanceRepository,
  SettingsRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
  createTestTransactionHelper,
} from '@mission/autopilot-storage'
import { createTestDb, type TestDb } from '@mission/autopilot-storage/testing'
import { InstanceManager } from '@mission/autopilot-engine'
import { SseManager } from '../sse-manager.js'
import { createManagementRouter } from '../routes/management.js'
import { syncEnvironmentActions } from '../lib/import-actions.js'
import { errorHandler } from '../middleware/error-handler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

interface Harness {
  app: express.Express
  db: TestDb
  manager: InstanceManager
  environmentRepo: EnvironmentRepository
  actionRepo: ActionRepository
  codeVersionRepo: CodeVersionRepository
  instanceRepo: InstanceRepository
  logRepo: LogRepository
}

async function createHarness(): Promise<Harness> {
  const db = await createTestDb()
  const environmentRepo = new EnvironmentRepository(db)
  const actionRepo = new ActionRepository(db)
  const codeVersionRepo = new CodeVersionRepository(db)
  const instanceRepo = new InstanceRepository(db)
  const logRepo = new LogRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const sseManager = new SseManager()
  const manager = new InstanceManager(db, {
    scriptPath: SCRIPT_PATH,
    poolSize: 1,
    onStateChange: () => {},
    onTerminal: () => {},
    onError: () => {},
  })
  const app = express()
  app.use(express.json())
  app.use(
    '/management/v1',
    createManagementRouter({
      q: db,
      txRunner: createTestTransactionHelper(db),
      manager,
      environmentRepo,
      actionRepo,
      codeVersionRepo,
      instanceRepo,
      logRepo,
      settingsRepo,
      sseManager,
    })
  )
  app.use(errorHandler)
  return { app, db, manager, environmentRepo, actionRepo, codeVersionRepo, instanceRepo, logRepo }
}

// ---------------------------------------------------------------------------
// Package builders
// ---------------------------------------------------------------------------

interface IncomingAction {
  oid: string
  local_id: string
  version?: string
  inputs?: unknown[]
  outputs?: unknown[]
}

const ENV_OID = 'env-preserve-001'

/** A `.WFenvir` env library with one environment (the library / bundle import path). */
function envLibrary(actions: IncomingAction[], envVersion = '1.0'): Buffer {
  const now = '2026-09-02T00:00:00.000Z'
  return Buffer.from(
    JSON.stringify({
      local_id: 'Preserve library',
      oid: `${ENV_OID}_lib`,
      version: '1.0.0',
      last_modified_date: now,
      schemaVersion: '4.0',
      environment_specifications: [
        {
          oid: ENV_OID,
          local_id: 'PreserveEnv',
          version: envVersion,
          last_modified_date: now,
          action_property_specifications: [],
          value_property_specifications: [],
          resource_property_specifications: [],
          included_actions: actions.map((a) => ({
            oid: a.oid,
            local_id: a.local_id,
            version: a.version ?? '1.0',
            last_modified_date: now,
            action_visibility: 'observable',
            input_parameter_specifications: a.inputs ?? [],
            output_parameter_specifications: a.outputs ?? [],
            property_specifications: [],
          })),
        },
      ],
    })
  )
}

/** A `.WFenvirX` single-env package (the other env import path). */
async function singleEnvPackage(actions: IncomingAction[], envVersion = '1.0'): Promise<Buffer> {
  const zip = new JSZip()
  const now = '2026-09-02T00:00:00.000Z'
  zip.file(
    'manifest.json',
    JSON.stringify({
      packageType: 'environment-package',
      format_version: 1,
      environment_oid: ENV_OID,
      environment_local_id: 'PreserveEnv',
    })
  )
  zip.file(
    'PreserveEnv.WFenvir',
    JSON.stringify({
      oid: ENV_OID,
      local_id: 'PreserveEnv',
      version: envVersion,
      last_modified_date: now,
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      description: null,
    })
  )
  for (const a of actions) {
    zip.file(
      `actions/${a.local_id}-${a.oid}.WFaction`,
      JSON.stringify({
        oid: a.oid,
        local_id: a.local_id,
        version: a.version ?? '1.0',
        last_modified_date: now,
        action_visibility: 'observable',
        input_parameter_specifications: a.inputs ?? [],
        output_parameter_specifications: a.outputs ?? [],
        property_specifications: [],
      })
    )
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** A `.WFactionCodeX` (per-action upload with code). */
async function actionCodeX(a: IncomingAction, states: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'action.WFaction',
    JSON.stringify({
      oid: a.oid,
      local_id: a.local_id,
      version: a.version ?? '1.0',
      last_modified_date: '2026-09-02T00:00:00.000Z',
      environment_oid: ENV_OID,
      action_visibility: 'observable',
      input_parameter_specifications: a.inputs ?? [],
      output_parameter_specifications: a.outputs ?? [],
      property_specifications: [],
    })
  )
  for (const [state, source] of Object.entries(states)) zip.file(`code/${state}.py`, source)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function uploadEnvLibrary(
  h: Harness,
  actions: IncomingAction[],
  envVersion?: string,
  status = 200
) {
  return request(h.app)
    .post('/management/v1/upload')
    .attach('files', envLibrary(actions, envVersion), 'PreserveEnv.WFenvir')
    .expect(status)
}

async function uploadSingleEnv(h: Harness, actions: IncomingAction[], envVersion?: string) {
  return request(h.app)
    .post('/management/v1/upload')
    .attach('files', await singleEnvPackage(actions, envVersion), {
      filename: 'PreserveEnv.WFenvirX',
      contentType: 'application/zip',
    })
    .expect(200)
}

async function uploadActionCodeX(h: Harness, a: IncomingAction, states: Record<string, string>) {
  return request(h.app)
    .post('/management/v1/upload')
    .attach('files', await actionCodeX(a, states), {
      filename: `${a.local_id}.WFactionCodeX`,
      contentType: 'application/zip',
    })
    .expect(200)
}

async function seedCode(h: Harness, actionOid: string, states: Record<string, string>) {
  for (const [state, source_code] of Object.entries(states)) {
    await h.codeVersionRepo.saveAndActivate({
      action_oid: actionOid,
      state,
      source_code,
      created_by: 'test',
    })
  }
}

async function seedInstance(h: Harness, actionOid: string, opts: { completed: boolean }) {
  const inst = await h.instanceRepo.create({
    runtime_action_instance_id: 'replaced',
    action_oid: actionOid,
    environment_oid: ENV_OID,
    workflow_instance_id: 'wf-1',
    step_instance_id: 'step-inst-1',
    step_oid: 'step-1',
    visibility: 'observable',
    state: opts.completed ? 'COMPLETE' : 'EXECUTING',
    input_parameters: [],
    output_parameters: [],
    state_history: [],
    pinned_code_versions: [],
    states_with_code_executed: [],
  })
  if (opts.completed) {
    await h.instanceRepo.updateState(inst.runtime_action_instance_id, 'COMPLETE', {
      completed_at: new Date().toISOString(),
    })
  }
  return inst
}

const COUNT_INT = { id: 'count', value_type: 'integer', default_value: '1', description: null }
const COUNT_NUM = { ...COUNT_INT, value_type: 'number' }
const UNIT = { id: 'unit', value_type: 'string', default_value: '', description: null }
const RESULT = {
  id: 'result',
  value_type: 'string',
  default_value: '',
  target_property_name: null,
  target_entry_name: null,
  description: null,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('environment re-import preserves authored code', () => {
  let h: Harness

  beforeEach(async () => {
    h = await createHarness()
  })

  afterEach(async () => {
    await h.manager.shutdown()
    await h.db.close()
  })

  describe('name fallback when Designer emits a new oid', () => {
    it('re-keys the action so code, timeout and instance history follow the new oid', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix' }])
      await seedCode(h, 'a1', { STARTING: 'print("s")', EXECUTING: 'print("e")' })
      await h.actionRepo.update('a1', { timeout_seconds: 30 })
      const inst = await seedInstance(h, 'a1', { completed: true })

      const res = await uploadEnvLibrary(h, [{ oid: 'a2', local_id: 'Mix', version: '2.0' }], '2.0')
      expect(res.status).toBe(200)
      expect(res.body.data.diff).toMatchObject({
        added: [],
        removed: [],
        rekeyed: ['Mix'],
        orphaned: [],
      })

      expect(await h.actionRepo.findByOid('a1')).toBeNull()
      const moved = await h.actionRepo.findByOid('a2')
      expect(moved).toMatchObject({
        local_id: 'Mix',
        version: '2.0',
        timeout_seconds: 30,
        orphaned_at: null,
        signature_change: null,
      })
      expect(await h.codeVersionRepo.countByAction('a2')).toBe(2)
      expect((await h.codeVersionRepo.getActive('a2', 'EXECUTING'))?.source_code).toBe('print("e")')
      expect(
        (await h.instanceRepo.findByAction('a2')).map((i) => i.runtime_action_instance_id)
      ).toEqual([inst.runtime_action_instance_id])
    })

    it('re-keys through the single-env .WFenvirX path too', async () => {
      await uploadSingleEnv(h, [{ oid: 'a1', local_id: 'Mix' }])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })

      await uploadSingleEnv(h, [{ oid: 'a2', local_id: 'Mix' }], '2.0')

      expect(await h.actionRepo.findByOid('a1')).toBeNull()
      expect((await h.codeVersionRepo.getActive('a2', 'EXECUTING'))?.source_code).toBe('print("e")')
    })

    it('re-keys a per-action .WFactionCodeX upload and stacks the new code on the old history', async () => {
      await uploadEnvLibrary(h, [])
      await uploadActionCodeX(h, { oid: 'a1', local_id: 'Mix' }, { STARTING: 'v1' })

      await uploadActionCodeX(h, { oid: 'a2', local_id: 'Mix' }, { STARTING: 'v2' })

      expect(await h.actionRepo.findByOid('a1')).toBeNull()
      const history = await h.codeVersionRepo.getVersionHistory('a2', 'STARTING')
      expect(history.map((v) => v.source_code)).toEqual(['v2', 'v1'])
      expect((await h.codeVersionRepo.getActive('a2', 'STARTING'))?.source_code).toBe('v2')
    })

    it('re-points execution_log entries from the old oid to the new one', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix' }])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })
      await h.logRepo.insert(
        {
          runtime_action_instance_id: 'inst-log-1',
          action_oid: 'a1',
          action_name: 'Mix',
          environment_oid: ENV_OID,
          environment_name: 'PreserveEnv',
          workflow_instance_id: 'wf-1',
          step_oid: 'step-1',
          input_parameters: [],
          output_parameters: [],
          states_executed: [],
          code_versions_used: {},
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 1,
          final_status: 'COMPLETED',
        },
        10000
      )

      await uploadEnvLibrary(h, [{ oid: 'a2', local_id: 'Mix', version: '2.0' }], '2.0')

      const entries = (await h.logRepo.query({})).entries
      expect(entries.map((e) => e.action_oid)).toEqual(['a2'])
    })

    it('falls back to oid-only matching when the name is ambiguous', async () => {
      await uploadEnvLibrary(h, [
        { oid: 'a1', local_id: 'Mix' },
        { oid: 'a2', local_id: 'Mix' },
      ])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })

      const res = await uploadEnvLibrary(h, [{ oid: 'a3', local_id: 'Mix' }])

      expect(res.body.data.diff).toMatchObject({ added: ['Mix'], rekeyed: [] })
      expect(await h.codeVersionRepo.countByAction('a3')).toBe(0)
      // a1 has code → kept as an orphan; a2 has none → deleted
      expect((await h.actionRepo.findByOid('a1'))?.orphaned_at).toEqual(expect.any(String))
      expect(await h.actionRepo.findByOid('a2')).toBeNull()
    })
  })

  describe('actions missing from the package', () => {
    it('keeps an orphan that has code and flags it; deletes one without code', async () => {
      await uploadEnvLibrary(h, [
        { oid: 'a1', local_id: 'Mix' },
        { oid: 'a2', local_id: 'Bake' },
      ])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })

      const res = await uploadEnvLibrary(h, [{ oid: 'a3', local_id: 'Chop' }])
      expect(res.body.data.diff).toMatchObject({
        added: ['Chop'],
        removed: ['Bake'],
        orphaned: ['Mix'],
      })

      const kept = await h.actionRepo.findByOid('a1')
      expect(kept?.orphaned_at).toEqual(expect.any(String))
      expect(await h.codeVersionRepo.countByAction('a1')).toBe(1)
      expect(await h.actionRepo.findByOid('a2')).toBeNull()

      const env = await request(h.app).get(`/management/v1/environments/${ENV_OID}`).expect(200)
      const byName = Object.fromEntries(
        (env.body.data.actions as Array<{ local_id: string }>).map((a) => [a.local_id, a])
      )
      expect(byName['Mix']).toMatchObject({ oid: 'a1', orphaned_at: kept?.orphaned_at })
      expect(byName['Chop']).toMatchObject({ oid: 'a3', orphaned_at: null, signature_change: null })
      expect(byName['Bake']).toBeUndefined()
    })

    it('keeps the first orphan timestamp across repeated imports', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix' }])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })
      await uploadEnvLibrary(h, [])
      const first = (await h.actionRepo.findByOid('a1'))?.orphaned_at
      await uploadEnvLibrary(h, [], '3.0')
      expect((await h.actionRepo.findByOid('a1'))?.orphaned_at).toBe(first)
    })

    it('clears the orphan flag when the action comes back by oid or by name', async () => {
      await uploadEnvLibrary(h, [
        { oid: 'a1', local_id: 'Mix' },
        { oid: 'b1', local_id: 'Bake' },
      ])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })
      await seedCode(h, 'b1', { EXECUTING: 'print("b")' })
      await uploadEnvLibrary(h, [])
      expect((await h.actionRepo.findByOid('a1'))?.orphaned_at).not.toBeNull()

      await uploadEnvLibrary(h, [
        { oid: 'a1', local_id: 'Mix' },
        { oid: 'b2', local_id: 'Bake' },
      ])

      expect((await h.actionRepo.findByOid('a1'))?.orphaned_at).toBeNull()
      expect(await h.actionRepo.findByOid('b1')).toBeNull()
      expect((await h.actionRepo.findByOid('b2'))?.orphaned_at).toBeNull()
      expect((await h.codeVersionRepo.getActive('b2', 'EXECUTING'))?.source_code).toBe('print("b")')
    })

    it('deletes a code-less orphan together with its terminal instance rows on the library path', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix' }])
      await seedInstance(h, 'a1', { completed: true })

      // Before the fix this path skipped the instance delete and the FK rolled the upload back.
      await uploadEnvLibrary(h, [])

      expect(await h.actionRepo.findByOid('a1')).toBeNull()
      expect(await h.instanceRepo.findByAction('a1')).toEqual([])
    })
  })

  describe('signature change flag', () => {
    const original = { inputs: [COUNT_INT], outputs: [RESULT] }

    it('does not flag an action that has no code', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', ...original }])
      const res = await uploadEnvLibrary(h, [
        { oid: 'a1', local_id: 'Mix', inputs: [COUNT_NUM], outputs: [] },
      ])
      expect(res.body.data.diff.signature_changed).toEqual([])
      expect((await h.actionRepo.findByOid('a1'))?.signature_change).toBeNull()
    })

    it('does not flag a matched action whose signature is unchanged', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', ...original }])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', version: '2.0', ...original }])
      expect((await h.actionRepo.findByOid('a1'))?.signature_change).toBeNull()
    })

    it('flags an action with code, recording the baseline signature and the changes', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', ...original }])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })

      const res = await uploadEnvLibrary(h, [
        { oid: 'a1', local_id: 'Mix', inputs: [COUNT_NUM, UNIT], outputs: [] },
      ])

      expect(res.body.data.diff.signature_changed).toEqual(['Mix'])
      const flagged = await h.actionRepo.findByOid('a1')
      expect(flagged?.signature_change).toEqual({
        flagged_at: expect.any(String),
        baseline_input_parameter_specifications: [COUNT_INT],
        baseline_output_parameter_specifications: [RESULT],
        changes: [
          'input `count` type integer → number',
          'input `unit` added (string)',
          'output `result` removed',
        ],
      })
      // The stored specs are the incoming ones — the flag is a note, not a veto.
      expect(flagged?.input_parameter_specifications).toEqual([COUNT_NUM, UNIT])

      const env = await request(h.app).get(`/management/v1/environments/${ENV_OID}`).expect(200)
      expect(env.body.data.actions[0].signature_change).toEqual(flagged?.signature_change)
      const detail = await request(h.app).get('/management/v1/actions/a1').expect(200)
      expect(detail.body.data.signature_change).toEqual(flagged?.signature_change)
    })

    it('keeps the original baseline across a further re-import and recomputes the changes', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', ...original }])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })
      await uploadEnvLibrary(h, [
        { oid: 'a1', local_id: 'Mix', inputs: [COUNT_NUM, UNIT], outputs: [] },
      ])
      const first = (await h.actionRepo.findByOid('a1'))?.signature_change

      await uploadEnvLibrary(h, [
        { oid: 'a1', local_id: 'Mix', inputs: [COUNT_NUM], outputs: [RESULT] },
      ])

      expect((await h.actionRepo.findByOid('a1'))?.signature_change).toEqual({
        ...first,
        changes: ['input `count` type integer → number'],
      })
    })

    it('clears the flag when a later import restores the baseline signature', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', ...original }])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', inputs: [COUNT_NUM], outputs: [] }])
      expect((await h.actionRepo.findByOid('a1'))?.signature_change).not.toBeNull()

      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', ...original }])
      expect((await h.actionRepo.findByOid('a1'))?.signature_change).toBeNull()
    })

    it('carries the comparison across an oid re-key', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', ...original }])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })

      await uploadEnvLibrary(h, [{ oid: 'a2', local_id: 'Mix', inputs: [], outputs: [RESULT] }])

      expect((await h.actionRepo.findByOid('a2'))?.signature_change).toMatchObject({
        baseline_input_parameter_specifications: [COUNT_INT],
        changes: ['input `count` removed'],
      })
    })
  })

  describe('DELETE /actions/:oid/signature-change', () => {
    it('clears the flag', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', inputs: [COUNT_INT] }])
      await seedCode(h, 'a1', { EXECUTING: 'print("e")' })
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', inputs: [] }])
      expect((await h.actionRepo.findByOid('a1'))?.signature_change).not.toBeNull()

      const res = await request(h.app).delete('/management/v1/actions/a1/signature-change')
      expect(res.status).toBe(200)
      expect(res.body.data).toEqual({ oid: 'a1', signature_change: null })
      expect((await h.actionRepo.findByOid('a1'))?.signature_change).toBeNull()
    })

    it('returns 404 for an unknown action', async () => {
      const res = await request(h.app).delete('/management/v1/actions/nope/signature-change')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('DELETE /actions/:oid', () => {
    it('removes the action with its code and terminal instances', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix' }])
      await seedCode(h, 'a1', { STARTING: 's', EXECUTING: 'e' })
      await seedInstance(h, 'a1', { completed: true })

      const res = await request(h.app).delete('/management/v1/actions/a1')
      expect(res.status).toBe(200)
      expect(res.body.data).toEqual({
        deleted: true,
        action_oid: 'a1',
        code_versions_removed: 2,
        instances_removed: 1,
      })
      expect(await h.actionRepo.findByOid('a1')).toBeNull()
      expect(await h.instanceRepo.findByAction('a1')).toEqual([])
    })

    it('refuses with 409 while an instance is still active', async () => {
      await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix' }])
      await seedInstance(h, 'a1', { completed: false })

      const res = await request(h.app).delete('/management/v1/actions/a1')
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('CONFLICT')
      expect(await h.actionRepo.findByOid('a1')).not.toBeNull()
    })

    it('returns 404 for an unknown action', async () => {
      const res = await request(h.app).delete('/management/v1/actions/nope')
      expect(res.status).toBe(404)
    })
  })
})

// ---------------------------------------------------------------------------
// Review follow-ups
// ---------------------------------------------------------------------------

async function flagMix(h: Harness) {
  await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', inputs: [COUNT_INT] }])
  await seedCode(h, 'a1', { EXECUTING: 'print("e")' })
  await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', inputs: [] }])
  expect((await h.actionRepo.findByOid('a1'))?.signature_change).not.toBeNull()
}

describe('import edge cases (review)', () => {
  let h: Harness

  beforeEach(async () => {
    h = await createHarness()
  })

  afterEach(async () => {
    await h.manager.shutdown()
    await h.db.close()
  })

  it('moves an action whose oid already lives in another environment instead of failing the upload', async () => {
    await h.environmentRepo.create({
      oid: 'env-other',
      local_id: 'Other',
      version: '1',
      last_modified_date: '2026-09-02T00:00:00.000Z',
      description: null,
      schema_version: '4.0',
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'Other.WFenvir',
    })
    await h.actionRepo.create({
      oid: 'a1',
      environment_oid: 'env-other',
      local_id: 'Mix',
      version: '1.0',
      last_modified_date: '2026-09-02T00:00:00.000Z',
      action_visibility: 'observable',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
    })
    await seedCode(h, 'a1', { EXECUTING: 'print("e")' })

    const res = await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix' }])

    expect(res.body.data.diff).toMatchObject({ added: ['Mix'], rekeyed: [] })
    expect((await h.actionRepo.findByOid('a1'))?.environment_oid).toBe(ENV_OID)
    expect((await h.codeVersionRepo.getActive('a1', 'EXECUTING'))?.source_code).toBe('print("e")')
    expect(await h.actionRepo.findByEnvironment('env-other')).toEqual([])
  })

  it('keeps a code-less orphan that still has a running instance instead of deleting rows under the engine', async () => {
    await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix' }])
    const inst = await seedInstance(h, 'a1', { completed: false })

    const res = await uploadEnvLibrary(h, [])

    expect(res.body.data.diff).toMatchObject({ removed: [], orphaned: ['Mix'] })
    expect((await h.actionRepo.findByOid('a1'))?.orphaned_at).toEqual(expect.any(String))
    expect(await h.instanceRepo.findById(inst.runtime_action_instance_id)).not.toBeNull()
  })

  it('stores a duplicated oid once and reports it once', async () => {
    await uploadEnvLibrary(h, [])
    const repos = {
      actions: h.actionRepo,
      codeVersions: h.codeVersionRepo,
      instances: h.instanceRepo,
      log: h.logRepo,
    }
    const incoming = (version: string) => ({
      oid: 'a1',
      environment_oid: ENV_OID,
      local_id: 'Mix',
      version,
      last_modified_date: '2026-09-02T00:00:00.000Z',
      action_visibility: 'observable' as const,
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
    })

    const result = await syncEnvironmentActions(repos, ENV_OID, [incoming('1.0'), incoming('2.0')])

    expect(result.storedOids).toEqual(['a1'])
    expect(result.diff.added).toEqual(['Mix'])
    expect((await h.actionRepo.findByOid('a1'))?.version).toBe('2.0')
  })

  it('reports rekeyed for per-action uploads', async () => {
    await uploadEnvLibrary(h, [])
    await uploadActionCodeX(h, { oid: 'a1', local_id: 'Mix' }, { STARTING: 'v1' })
    const res = await uploadActionCodeX(h, { oid: 'a2', local_id: 'Mix' }, { STARTING: 'v2' })
    expect(res.body.data.diff.rekeyed).toEqual(['Mix'])
  })
})

describe('signature flag lifecycle (review)', () => {
  let h: Harness

  beforeEach(async () => {
    h = await createHarness()
  })

  afterEach(async () => {
    await h.manager.shutdown()
    await h.db.close()
  })

  it('clears the flag when the last code for the action is cleared by state', async () => {
    await flagMix(h)
    await request(h.app).delete('/management/v1/code/a1/EXECUTING').expect(200)
    expect((await h.actionRepo.findByOid('a1'))?.signature_change).toBeNull()
  })

  it('keeps the flag while another state still has code', async () => {
    await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', inputs: [COUNT_INT] }])
    await seedCode(h, 'a1', { STARTING: 's', EXECUTING: 'e' })
    await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', inputs: [] }])
    await request(h.app).delete('/management/v1/code/a1/STARTING').expect(200)
    expect((await h.actionRepo.findByOid('a1'))?.signature_change).not.toBeNull()
  })

  it('a code-bearing .WFactionCodeX import replaces the code of record and clears the flag', async () => {
    await flagMix(h)
    const res = await uploadActionCodeX(
      h,
      { oid: 'a1', local_id: 'Mix', inputs: [] },
      { EXECUTING: 'print("new")' }
    )
    expect(res.body.data.diff.signature_changed).toEqual([])
    expect((await h.actionRepo.findByOid('a1'))?.signature_change).toBeNull()
  })

  it('a .WFactionCodeX without code still compares the signature', async () => {
    await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', inputs: [COUNT_INT] }])
    await seedCode(h, 'a1', { EXECUTING: 'e' })
    const res = await uploadActionCodeX(h, { oid: 'a1', local_id: 'Mix', inputs: [] }, {})
    expect(res.body.data.diff.signature_changed).toEqual(['Mix'])
    expect((await h.actionRepo.findByOid('a1'))?.signature_change).not.toBeNull()
  })

  it('a bundle that carries code sets its own signature as the code of record and clears the flag', async () => {
    // Baseline [COUNT_INT] with code; Designer then ships [UNIT] → flag.
    await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', inputs: [COUNT_INT] }])
    await seedCode(h, 'a1', { EXECUTING: 'e' })
    await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', inputs: [UNIT] }])
    // The export now carries [UNIT] + the code; it differs from the baseline.
    const exported = await request(h.app)
      .get(`/management/v1/environments/${ENV_OID}/export-bundle`)
      .responseType('blob')
      .expect(200)
    await uploadEnvLibrary(h, [{ oid: 'a1', local_id: 'Mix', inputs: [] }])
    expect((await h.actionRepo.findByOid('a1'))?.signature_change).not.toBeNull()

    await request(h.app)
      .post('/management/v1/upload')
      .attach('files', exported.body, 'PreserveEnv.WFenvirBundleX')
      .expect(200)

    const a1 = await h.actionRepo.findByOid('a1')
    expect(a1?.signature_change).toBeNull()
    expect(a1?.input_parameter_specifications).toEqual([UNIT])
    expect(await h.codeVersionRepo.getVersionHistory('a1', 'EXECUTING')).toHaveLength(2)
  })
})
