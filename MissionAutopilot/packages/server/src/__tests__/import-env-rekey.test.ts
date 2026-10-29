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
 * import-env-rekey.test.ts — Designer's "Create New Version" on an ENVIRONMENT
 * clones it under a fresh oid with the same name. A re-import must treat that
 * as the same environment: when the name is unique on both sides the stored
 * row is re-keyed to the incoming oid and its actions, code, instances and
 * flags follow; the action reconciliation then runs against the new oid.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
import { errorHandler } from '../middleware/error-handler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

interface Harness {
  app: express.Express
  db: TestDb
  manager: InstanceManager
  sseManager: SseManager
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
  return {
    app,
    db,
    manager,
    sseManager,
    environmentRepo,
    actionRepo,
    codeVersionRepo,
    instanceRepo,
    logRepo,
  }
}

// ---------------------------------------------------------------------------
// Package builders
// ---------------------------------------------------------------------------

interface EnvSpec {
  oid: string
  local_id: string
  version?: string
  actions?: Array<{ oid: string; local_id: string }>
}

const NOW = '2026-09-02T00:00:00.000Z'

function envBody(env: EnvSpec) {
  return {
    oid: env.oid,
    local_id: env.local_id,
    version: env.version ?? '1.0',
    last_modified_date: NOW,
    description: null,
    action_property_specifications: [
      { name: 'Config', entries: [{ name: 'Host', value: 'localhost' }] },
    ],
    value_property_specifications: [],
    resource_property_specifications: [],
  }
}

function actionBody(a: { oid: string; local_id: string }) {
  return {
    oid: a.oid,
    local_id: a.local_id,
    version: '1.0',
    last_modified_date: NOW,
    action_visibility: 'observable',
    input_parameter_specifications: [],
    output_parameter_specifications: [],
    property_specifications: [],
  }
}

/** A `.WFenvir` library holding one or more environments. */
function envLibrary(envs: EnvSpec[]): Buffer {
  return Buffer.from(
    JSON.stringify({
      local_id: 'Rekey library',
      oid: 'rekey-lib',
      version: '1.0.0',
      last_modified_date: NOW,
      schemaVersion: '4.0',
      environment_specifications: envs.map((env) => ({
        ...envBody(env),
        included_actions: (env.actions ?? []).map(actionBody),
      })),
    })
  )
}

/** A `.WFenvirX` single-env package. */
async function singleEnvPackage(env: EnvSpec): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({
      packageType: 'environment-package',
      format_version: 1,
      environment_oid: env.oid,
      environment_local_id: env.local_id,
    })
  )
  zip.file(`${env.local_id}.WFenvir`, JSON.stringify(envBody(env)))
  for (const a of env.actions ?? []) {
    zip.file(`actions/${a.local_id}-${a.oid}.WFaction`, JSON.stringify(actionBody(a)))
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function uploadLibrary(h: Harness, envs: EnvSpec[], status = 200) {
  return request(h.app)
    .post('/management/v1/upload')
    .attach('files', envLibrary(envs), 'Rekey.WFenvir')
    .expect(status)
}

async function uploadSingleEnv(h: Harness, env: EnvSpec) {
  return request(h.app)
    .post('/management/v1/upload')
    .attach('files', await singleEnvPackage(env), {
      filename: `${env.local_id}.WFenvirX`,
      contentType: 'application/zip',
    })
    .expect(200)
}

async function seedInstance(h: Harness, envOid: string, actionOid: string) {
  const inst = await h.instanceRepo.create({
    runtime_action_instance_id: 'replaced',
    action_oid: actionOid,
    environment_oid: envOid,
    workflow_instance_id: 'wf-1',
    step_instance_id: 'step-inst-1',
    step_oid: 'step-1',
    visibility: 'observable',
    state: 'COMPLETE',
    input_parameters: [],
    output_parameters: [],
    state_history: [],
    pinned_code_versions: [],
    states_with_code_executed: [],
  })
  await h.instanceRepo.updateState(inst.runtime_action_instance_id, 'COMPLETE', {
    completed_at: new Date().toISOString(),
  })
  return inst
}

const ENV = { oid: 'e1', local_id: 'Kitchen', actions: [{ oid: 'a1', local_id: 'Mix' }] }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('environment re-key on import', () => {
  let h: Harness

  beforeEach(async () => {
    h = await createHarness()
  })

  afterEach(async () => {
    await h.manager.shutdown()
    await h.db.close()
  })

  it('re-keys the environment to the new oid; actions, code, timeout and instances follow', async () => {
    await uploadLibrary(h, [ENV])
    await h.codeVersionRepo.saveAndActivate({
      action_oid: 'a1',
      state: 'EXECUTING',
      source_code: 'print("e")',
      created_by: 'test',
    })
    await h.actionRepo.update('a1', { timeout_seconds: 30 })
    const inst = await seedInstance(h, 'e1', 'a1')

    const res = await uploadLibrary(h, [{ ...ENV, oid: 'e2', version: '2.0' }])

    expect(res.body.data.imported).toEqual([
      expect.objectContaining({
        type: 'environment',
        oid: 'e2',
        local_id: 'Kitchen',
        version: '2.0',
        status: 'updated',
        rekeyed_from: 'e1',
      }),
    ])
    expect(await h.environmentRepo.findByOid('e1')).toBeNull()
    expect((await h.environmentRepo.findByOid('e2'))?.version).toBe('2.0')
    const a1 = await h.actionRepo.findByOid('a1')
    expect(a1).toMatchObject({ environment_oid: 'e2', timeout_seconds: 30 })
    expect((await h.codeVersionRepo.getActive('a1', 'EXECUTING'))?.source_code).toBe('print("e")')
    expect((await h.instanceRepo.findById(inst.runtime_action_instance_id))?.environment_oid).toBe(
      'e2'
    )
    const list = await request(h.app).get('/management/v1/environments').expect(200)
    expect(list.body.data.map((e: { oid: string }) => e.oid)).toEqual(['e2'])
  })

  it('takes the environment-name advisory lock before the by-oid check', async () => {
    await uploadLibrary(h, [ENV])
    const lockSpy = vi.spyOn(EnvironmentRepository.prototype, 'lockName')
    const findByOidSpy = vi.spyOn(EnvironmentRepository.prototype, 'findByOid')
    try {
      await uploadLibrary(h, [{ ...ENV, oid: 'e2' }])
      expect(lockSpy).toHaveBeenCalledWith('Kitchen')
      // The lock must be taken before the by-oid read: a concurrent upload of
      // the same package (same new oid) must see the committed re-key on its
      // by-oid read instead of racing it to `create`.
      const firstLockCall = lockSpy.mock.invocationCallOrder[0]
      const firstFindByOidCall = findByOidSpy.mock.invocationCallOrder[0]
      expect(firstLockCall).toBeDefined()
      expect(firstFindByOidCall).toBeDefined()
      expect(firstLockCall!).toBeLessThan(firstFindByOidCall!)
    } finally {
      lockSpy.mockRestore()
      findByOidSpy.mockRestore()
    }
  })

  it('re-keys through the single-env .WFenvirX path too', async () => {
    await uploadSingleEnv(h, ENV)
    await h.codeVersionRepo.saveAndActivate({
      action_oid: 'a1',
      state: 'EXECUTING',
      source_code: 'print("e")',
      created_by: 'test',
    })

    const res = await uploadSingleEnv(h, { ...ENV, oid: 'e2' })

    expect(res.body.data.imported[0]).toMatchObject({ oid: 'e2', rekeyed_from: 'e1' })
    expect(await h.environmentRepo.findByOid('e1')).toBeNull()
    expect((await h.actionRepo.findByOid('a1'))?.environment_oid).toBe('e2')
    expect((await h.codeVersionRepo.getActive('a1', 'EXECUTING'))?.source_code).toBe('print("e")')
  })

  it('carries code across an environment re-key when the action oid changed as well', async () => {
    await uploadLibrary(h, [ENV])
    await h.codeVersionRepo.saveAndActivate({
      action_oid: 'a1',
      state: 'EXECUTING',
      source_code: 'print("e")',
      created_by: 'test',
    })

    const res = await uploadLibrary(h, [
      { oid: 'e2', local_id: 'Kitchen', actions: [{ oid: 'a2', local_id: 'Mix' }] },
    ])

    expect(res.body.data.diff.rekeyed).toEqual(['Mix'])
    expect(await h.actionRepo.findByOid('a1')).toBeNull()
    expect((await h.actionRepo.findByOid('a2'))?.environment_oid).toBe('e2')
    expect((await h.codeVersionRepo.getActive('a2', 'EXECUTING'))?.source_code).toBe('print("e")')
  })

  it('creates a separate environment when the name is ambiguous among stored environments', async () => {
    await uploadLibrary(h, [ENV])
    // A second stored environment with the same name (seeded directly — the
    // importer itself would now re-key it onto e1).
    await h.environmentRepo.create({
      oid: 'e1b',
      local_id: 'Kitchen',
      version: '1.0',
      last_modified_date: NOW,
      description: null,
      schema_version: '4.0',
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'Kitchen-b.WFenvir',
    })
    expect((await h.environmentRepo.findAll()).map((e) => e.oid).sort()).toEqual(['e1', 'e1b'])

    const res = await uploadLibrary(h, [{ oid: 'e3', local_id: 'Kitchen', actions: [] }])

    expect(res.body.data.imported[0]).toMatchObject({
      oid: 'e3',
      status: 'created',
      rekeyed_from: null,
    })
    expect((await h.environmentRepo.findAll()).map((e) => e.oid).sort()).toEqual([
      'e1',
      'e1b',
      'e3',
    ])
    expect((await h.actionRepo.findByOid('a1'))?.environment_oid).toBe('e1')
  })

  it('does not re-key when the package itself lists the same environment name twice', async () => {
    await uploadLibrary(h, [ENV])

    const res = await uploadLibrary(h, [
      { oid: 'e2', local_id: 'Kitchen', actions: [] },
      { oid: 'e3', local_id: 'Kitchen', actions: [] },
    ])

    expect(
      res.body.data.imported.map((i: { oid: string; rekeyed_from: string | null }) => [
        i.oid,
        i.rekeyed_from,
      ])
    ).toEqual([
      ['e2', null],
      ['e3', null],
    ])
    expect((await h.environmentRepo.findAll()).map((e) => e.oid).sort()).toEqual(['e1', 'e2', 'e3'])
  })

  it('tears down the old oid property buses once the upload commits', async () => {
    await uploadLibrary(h, [ENV])
    const received: string[] = []
    h.sseManager.subscribeProperty('e1', 'Config', (event) => received.push(event.type))
    const payload = {
      entries: [{ name: 'Host', value: 'localhost' }],
      changed_entries: ['Host'],
      source: 'console' as const,
    }
    h.sseManager.publishProperty('e1', 'Config', payload)
    expect(received).toHaveLength(1)

    await uploadLibrary(h, [{ ...ENV, oid: 'e2' }])

    // The old bus (and its listeners) is gone: a publish on the stale oid reaches nobody.
    h.sseManager.publishProperty('e1', 'Config', payload)
    expect(received).toHaveLength(1)
    // A fresh bus: only the post-re-key event is buffered (ids restart at 0; the filter is exclusive).
    expect(h.sseManager.getPropertyEventsSince('e1', 'Config', -1)).toHaveLength(1)
  })
})

describe('environment re-key on import (review follow-ups)', () => {
  let h: Harness

  beforeEach(async () => {
    h = await createHarness()
  })

  afterEach(async () => {
    await h.manager.shutdown()
    await h.db.close()
  })

  it('reports a pure environment re-key with no added or modified actions', async () => {
    await uploadLibrary(h, [ENV])
    const res = await uploadLibrary(h, [{ ...ENV, oid: 'e2' }])
    expect(res.body.data.diff).toMatchObject({ added: [], modified: [], rekeyed: [], removed: [] })
  })

  for (const order of ['renamed first', 'new first'] as const) {
    it(`does not re-key a stored environment whose oid is claimed by another environment in the same upload (${order})`, async () => {
      // e1 "Kitchen" holds Mix + code. In Designer the user renames it to "Pantry"
      // and creates a fresh "Kitchen" (e2); both ship in one library.
      await uploadLibrary(h, [ENV])
      await h.codeVersionRepo.saveAndActivate({
        action_oid: 'a1',
        state: 'EXECUTING',
        source_code: 'print("e")',
        created_by: 'test',
      })
      const renamed = { oid: 'e1', local_id: 'Pantry', actions: [{ oid: 'a1', local_id: 'Mix' }] }
      const fresh = { oid: 'e2', local_id: 'Kitchen', actions: [] }

      const res = await uploadLibrary(
        h,
        order === 'renamed first' ? [renamed, fresh] : [fresh, renamed]
      )

      expect(
        res.body.data.imported.map((i: { oid: string; rekeyed_from: string | null }) => [
          i.oid,
          i.rekeyed_from,
        ])
      ).toEqual(
        expect.arrayContaining([
          ['e1', null],
          ['e2', null],
        ])
      )
      expect((await h.environmentRepo.findByOid('e1'))?.local_id).toBe('Pantry')
      expect((await h.actionRepo.findByOid('a1'))?.environment_oid).toBe('e1')
      expect((await h.codeVersionRepo.getActive('a1', 'EXECUTING'))?.source_code).toBe('print("e")')
      expect(await h.actionRepo.findByEnvironment('e2')).toEqual([])
    })
  }

  it('re-points a still-running instance along with the environment', async () => {
    await uploadLibrary(h, [ENV])
    const inst = await h.instanceRepo.create({
      runtime_action_instance_id: 'replaced',
      action_oid: 'a1',
      environment_oid: 'e1',
      workflow_instance_id: 'wf-1',
      step_instance_id: 'step-inst-1',
      step_oid: 'step-1',
      visibility: 'observable',
      state: 'EXECUTING',
      input_parameters: [],
      output_parameters: [],
      state_history: [],
      pinned_code_versions: [],
      states_with_code_executed: [],
    })

    await uploadLibrary(h, [{ ...ENV, oid: 'e2' }])

    const row = await h.instanceRepo.findById(inst.runtime_action_instance_id)
    expect(row).toMatchObject({ environment_oid: 'e2', action_oid: 'a1', completed_at: null })
  })

  it('re-points execution log history along with the environment', async () => {
    await uploadLibrary(h, [ENV])
    await h.logRepo.insert(
      {
        runtime_action_instance_id: 'inst-log-1',
        action_oid: 'a1',
        action_name: 'Mix',
        environment_oid: 'e1',
        environment_name: 'Kitchen',
        workflow_instance_id: 'wf-1',
        step_oid: 'step-1',
        input_parameters: [],
        output_parameters: [],
        states_executed: ['EXECUTING'],
        code_versions_used: {},
        started_at: NOW,
        completed_at: NOW,
        duration_ms: 1,
        final_status: 'COMPLETED',
        error: null,
      },
      10000
    )

    await uploadLibrary(h, [{ ...ENV, oid: 'e2' }])

    expect((await h.logRepo.query({ environmentOid: 'e2' })).total).toBe(1)
    expect((await h.logRepo.query({ environmentOid: 'e1' })).total).toBe(0)
  })
})
