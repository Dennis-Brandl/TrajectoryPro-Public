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
 * environment-bundle.test.ts — Integration tests for the
 * GET /environments/:oid/export-bundle endpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
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
import type { Instance } from '@mission/autopilot-storage'
import { SseManager } from '../sse-manager.js'
import { createManagementRouter } from '../routes/management.js'
import { errorHandler } from '../middleware/error-handler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

interface TestHarness {
  app: express.Express
  db: TestDb
  manager: InstanceManager
  envOid: string
  actionOids: string[]
}

async function createHarness(): Promise<TestHarness> {
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
    onStateChange: (instanceId: string, state: string, instance: Instance) => {
      const history = instance.state_history as Array<{ state: string; timestamp: string }>
      const prev = history.length >= 2 ? (history[history.length - 2]?.state ?? '') : ''
      sseManager.publishStateChange(instanceId, state, prev, instance)
    },
    onTerminal: (instanceId: string, state: string, instance: Instance) => {
      const history = instance.state_history as Array<{ state: string; timestamp: string }>
      const prev = history.length >= 2 ? (history[history.length - 2]?.state ?? '') : ''
      sseManager.publishTerminal(instanceId, state, prev, instance)
    },
    onError: (instanceId: string, error: Error) => {
      sseManager.publishError(instanceId, error.message)
    },
  })

  const app = express()
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    })
  )
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

  return { app, db, manager, envOid: '', actionOids: [] }
}

async function seedKitchenLite(harness: TestHarness): Promise<void> {
  // Upload one environment with 2 actions via the bulk upload endpoint.
  const envPayload = {
    local_id: 'KitchenLite',
    oid: '11111111-1111-1111-1111-111111111111',
    version: '1',
    last_modified_date: '2026-05-19T00:00:00.000Z',
    schemaVersion: '4.0',
    environment_specifications: [
      {
        oid: '22222222-2222-2222-2222-222222222222',
        local_id: 'KitchenLite',
        version: '1',
        last_modified_date: '2026-05-19T00:00:00.000Z',
        description: null,
        action_property_specifications: [],
        value_property_specifications: [],
        resource_property_specifications: [],
        included_actions: [
          {
            oid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            local_id: 'Boil',
            version: '1',
            last_modified_date: '2026-05-19T00:00:00.000Z',
            description: null,
            action_visibility: 'observable',
            input_parameter_specifications: [
              { id: 'temp', value_type: 'number', default_value: '100', description: null },
            ],
            output_parameter_specifications: [
              { id: 'status', value_type: 'string', default_value: '0', description: null },
            ],
            property_specifications: [],
            timeout_seconds: null,
          },
          {
            oid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            local_id: 'Chop',
            version: '1',
            last_modified_date: '2026-05-19T00:00:00.000Z',
            description: null,
            action_visibility: 'opaque',
            input_parameter_specifications: [],
            output_parameter_specifications: [
              { id: 'status', value_type: 'string', default_value: '0', description: null },
            ],
            property_specifications: [],
            timeout_seconds: null,
          },
        ],
      },
    ],
  }

  await request(harness.app)
    .post('/management/v1/upload')
    .attach('files', Buffer.from(JSON.stringify(envPayload)), 'KitchenLite.WFenvir')
    .expect(200)

  // Attach code to the Boil action via POST /management/v1/code/:action_oid/:state
  await request(harness.app)
    .post('/management/v1/code/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/STARTING')
    .send({ source_code: '# Boil STARTING\noutputs["status"] = "0"\n' })
    .expect(201)

  await request(harness.app)
    .post('/management/v1/code/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/EXECUTING')
    .send({ source_code: '# Boil EXECUTING\nimport time\ntime.sleep(0.01)\n' })
    .expect(201)

  harness.envOid = '22222222-2222-2222-2222-222222222222'
  harness.actionOids = [
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  ]
}

describe('environment-bundle export', () => {
  let harness: TestHarness

  beforeEach(async () => {
    harness = await createHarness()
    await seedKitchenLite(harness)
  })

  afterEach(async () => {
    await harness.manager.shutdown()
    await harness.db.close()
  })

  it('returns 404 for unknown env oid', async () => {
    const res = await request(harness.app).get(
      '/management/v1/environments/99999999-9999-9999-9999-999999999999/export-bundle'
    )
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('emits a valid .WFenvirBundleX ZIP with manifest + inner .WFenvir + code', async () => {
    const res = await request(harness.app)
      .get(`/management/v1/environments/${harness.envOid}/export-bundle`)
      .responseType('blob')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/zip/)
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="KitchenLite.WFenvirBundleX"'
    )

    const zip = await JSZip.loadAsync(res.body as Buffer)

    const manifestEntry = zip.file('manifest.json')
    expect(manifestEntry).not.toBeNull()
    const manifest = JSON.parse(await manifestEntry!.async('text'))
    expect(manifest.format).toBe('WFenvirBundleX')
    expect(manifest.format_version).toBe(1)
    expect(manifest.environment_oid).toBe(harness.envOid)
    expect(manifest.environment_local_id).toBe('KitchenLite')
    expect(manifest.action_count).toBe(2)
    expect(manifest.code_file_count).toBe(2)

    const innerEntry = zip.file('KitchenLite.WFenvir')
    expect(innerEntry).not.toBeNull()
    const innerJson = JSON.parse(await innerEntry!.async('text'))
    // Top-level library fields the upload handler requires
    expect(innerJson.oid).toBe(harness.envOid)
    expect(innerJson.local_id).toBe('KitchenLite')
    expect(innerJson.version).toBe('1')
    expect(innerJson.last_modified_date).toBeTruthy()
    expect(innerJson.schemaVersion).toBe('4.0')
    expect(innerJson.environment_specifications).toHaveLength(1)

    // Inner env spec
    const envSpec = innerJson.environment_specifications[0]
    expect(envSpec.oid).toBe(harness.envOid)
    expect(envSpec.local_id).toBe('KitchenLite')
    expect(envSpec.included_actions).toHaveLength(2)

    // Spot-check one included action's parameter specs round-tripped
    const boil = envSpec.included_actions.find((a: { local_id: string }) => a.local_id === 'Boil')
    expect(boil).toBeTruthy()
    expect(boil.input_parameter_specifications).toHaveLength(1)
    expect(boil.input_parameter_specifications[0].id).toBe('temp')

    // Mission Designer schema compatibility (master-environment-library.json
    // requires action_name + action_library on each included_action).
    expect(boil.action_name).toBe('Boil')
    expect(boil.action_library).toBe('KitchenLite')

    const boilStarting = zip.file(`code/${harness.actionOids[0]}/STARTING.py`)
    const boilExecuting = zip.file(`code/${harness.actionOids[0]}/EXECUTING.py`)
    expect(boilStarting).not.toBeNull()
    expect(boilExecuting).not.toBeNull()
    expect(await boilStarting!.async('text')).toContain('# Boil STARTING')

    // Chop has no code — no code files for it
    const chopFile = zip.file(`code/${harness.actionOids[1]}/STARTING.py`)
    expect(chopFile).toBeNull()
  })

  it('rejects upload with no inner .WFenvir entry', async () => {
    // Build a malformed bundle: ZIP missing the inner .WFenvir
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ format: 'WFenvirBundleX', format_version: 1 }))
    zip.file('code/abc/STARTING.py', '# orphan')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })

    const res = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', buf, 'Malformed.WFenvirBundleX')

    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/inner|envir|missing/i)
  })

  it('accepts .WFenvirBundleX through the upload allowlist', async () => {
    // Use the exported bundle from a seeded env as input.
    const exportRes = await request(harness.app)
      .get(`/management/v1/environments/${harness.envOid}/export-bundle`)
      .responseType('blob')
    expect(exportRes.status).toBe(200)

    // Delete the env so the upload re-creates it
    await request(harness.app).delete(`/management/v1/environments/${harness.envOid}`).expect(200)

    const uploadRes = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', exportRes.body, 'KitchenLite.WFenvirBundleX')

    expect(uploadRes.status).toBe(200)

    // A4: the transaction-loop branch processes the bundle and re-creates the env.
    const afterRes = await request(harness.app).get(`/management/v1/environments/${harness.envOid}`)
    expect(afterRes.status).toBe(200)
    expect(afterRes.body.data.local_id).toBe('KitchenLite')

    // Also confirm a known-absent OID is still absent (sanity check).
    const afterEmptyRes = await request(harness.app).get(
      '/management/v1/environments/44444444-4444-4444-4444-444444444444'
    )
    expect(afterEmptyRes.status).toBe(404)
  })

  it('rejects upload of a bundle whose inner .WFenvir has an unsupported schemaVersion', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ format: 'WFenvirBundleX', format_version: 1 }))
    zip.file(
      'Bad.WFenvir',
      JSON.stringify({
        local_id: 'Bad',
        oid: 'bad-oid',
        version: '1',
        last_modified_date: '2026-05-19T00:00:00.000Z',
        schemaVersion: '2.0',
        environment_specifications: [],
      })
    )
    const buf = await zip.generateAsync({ type: 'nodebuffer' })

    const res = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', buf, 'Bad.WFenvirBundleX')

    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/schemaVersion/i)
  })

  it('round-trips: export → delete → re-upload restores env + actions + code', async () => {
    // Export bundle
    const exportRes = await request(harness.app)
      .get(`/management/v1/environments/${harness.envOid}/export-bundle`)
      .responseType('blob')
    expect(exportRes.status).toBe(200)

    // Capture original code text for byte-equal comparison after round-trip
    const beforeZip = await JSZip.loadAsync(exportRes.body)
    const beforeStartingEntry = beforeZip.file(`code/${harness.actionOids[0]}/STARTING.py`)
    expect(beforeStartingEntry).not.toBeNull()
    const beforeStarting = await beforeStartingEntry!.async('text')

    // Delete the env
    await request(harness.app).delete(`/management/v1/environments/${harness.envOid}`).expect(200)

    // Re-upload
    const uploadRes = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', exportRes.body, 'KitchenLite.WFenvirBundleX')
    expect(uploadRes.status).toBe(200)

    // Verify env exists and has the same shape
    const envRes = await request(harness.app)
      .get(`/management/v1/environments/${harness.envOid}`)
      .expect(200)
    expect(envRes.body.data.local_id).toBe('KitchenLite')
    // The env detail's actions array length should be 2 (Boil + Chop).
    expect(envRes.body.data.actions).toHaveLength(2)

    // Verify code byte-equality for one state on one action (via active version)
    const codeRes = await request(harness.app)
      .get(`/management/v1/code/${harness.actionOids[0]}/STARTING/active`)
      .expect(200)
    expect(codeRes.body.data.source_code).toBe(beforeStarting)
  })

  it('round-trips an env with no code (no spurious code rows)', async () => {
    // Seed a fresh env with one action and NO code attached
    const noCodeEnv = {
      local_id: 'NoCode',
      oid: '55555555-5555-5555-5555-555555555555',
      version: '1',
      last_modified_date: '2026-05-19T00:00:00.000Z',
      schemaVersion: '4.0',
      environment_specifications: [
        {
          oid: '66666666-6666-6666-6666-666666666666',
          local_id: 'NoCode',
          version: '1',
          last_modified_date: '2026-05-19T00:00:00.000Z',
          description: null,
          action_property_specifications: [],
          value_property_specifications: [],
          resource_property_specifications: [],
          included_actions: [
            {
              oid: '77777777-7777-7777-7777-777777777777',
              local_id: 'Silent',
              version: '1',
              last_modified_date: '2026-05-19T00:00:00.000Z',
              description: null,
              action_visibility: 'opaque',
              input_parameter_specifications: [],
              output_parameter_specifications: [],
              property_specifications: [],
              timeout_seconds: null,
            },
          ],
        },
      ],
    }
    await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', Buffer.from(JSON.stringify(noCodeEnv)), 'NoCode.WFenvir')
      .expect(200)

    const exportRes = await request(harness.app)
      .get('/management/v1/environments/66666666-6666-6666-6666-666666666666/export-bundle')
      .responseType('blob')
    expect(exportRes.status).toBe(200)

    await request(harness.app)
      .delete('/management/v1/environments/66666666-6666-6666-6666-666666666666')
      .expect(200)

    const uploadRes = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', exportRes.body, 'NoCode.WFenvirBundleX')
    expect(uploadRes.status).toBe(200)

    // Env exists, action exists, no code versions
    const envRes = await request(harness.app)
      .get('/management/v1/environments/66666666-6666-6666-6666-666666666666')
      .expect(200)
    const actions = envRes.body.data.actions
    expect(actions).toHaveLength(1)
    // The action's states_with_code should be empty (no code rows were created).
    const action = actions[0]
    expect(action.states_with_code).toEqual([])
  })

  it('emits a valid bundle for an empty env (zero actions)', async () => {
    // Seed a second env with no actions
    const emptyEnvPayload = {
      local_id: 'EmptyLite',
      oid: '33333333-3333-3333-3333-333333333333',
      version: '1',
      last_modified_date: '2026-05-19T00:00:00.000Z',
      schemaVersion: '4.0',
      environment_specifications: [
        {
          oid: '44444444-4444-4444-4444-444444444444',
          local_id: 'EmptyLite',
          version: '1',
          last_modified_date: '2026-05-19T00:00:00.000Z',
          description: null,
          action_property_specifications: [],
          value_property_specifications: [],
          resource_property_specifications: [],
          included_actions: [],
        },
      ],
    }
    await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', Buffer.from(JSON.stringify(emptyEnvPayload)), 'EmptyLite.WFenvir')
      .expect(200)

    const res = await request(harness.app)
      .get('/management/v1/environments/44444444-4444-4444-4444-444444444444/export-bundle')
      .responseType('blob')

    expect(res.status).toBe(200)
    const zip = await JSZip.loadAsync(res.body)
    const manifestEntry = zip.file('manifest.json')
    expect(manifestEntry).not.toBeNull()
    const manifest = JSON.parse(await manifestEntry!.async('text'))
    expect(manifest.action_count).toBe(0)
    expect(manifest.code_file_count).toBe(0)

    // No code files should exist
    const codeEntries = Object.keys(zip.files).filter((n) => n.startsWith('code/'))
    expect(codeEntries).toHaveLength(0)

    const innerEntry = zip.file('EmptyLite.WFenvir')
    expect(innerEntry).not.toBeNull()
    const innerJson = JSON.parse(await innerEntry!.async('text'))
    expect(innerJson.environment_specifications).toHaveLength(1)
    expect(innerJson.environment_specifications[0].included_actions).toEqual([])
  })

  // ---- .WFenvirX export tests ----

  it('GET /export-envir-x returns 404 for unknown env oid', async () => {
    const res = await request(harness.app).get(
      '/management/v1/environments/99999999-9999-9999-9999-999999999999/export-envir-x'
    )
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('GET /export-envir-x emits a valid .WFenvirX ZIP (single-env shape: manifest + root .WFenvir + actions/*.WFaction, no code)', async () => {
    const res = await request(harness.app)
      .get(`/management/v1/environments/${harness.envOid}/export-envir-x`)
      .responseType('blob')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/zip/)
    expect(res.headers['content-disposition']).toBe('attachment; filename="KitchenLite.WFenvirX"')

    const zip = await JSZip.loadAsync(res.body as Buffer)
    const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir)

    // Must have manifest.json, root .WFenvir, and one .WFaction per action (2 actions)
    expect(zip.file('manifest.json')).not.toBeNull()
    expect(zip.file('KitchenLite.WFenvir')).not.toBeNull()
    // 2 actions → 2 actions/*.WFaction entries + 1 root .WFenvir + 1 manifest.json = 4 entries
    expect(entries).toHaveLength(4)

    // manifest.json must identify as single-env package
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
    expect(manifest.packageType).toBe('environment-package')
    expect(manifest.formatVersion).toBe(1)
    expect(manifest.environmentName).toBe('KitchenLite')
    expect(manifest.actionCount).toBe(2)

    // Root .WFenvir must be single-env shape (NOT library-wrapped)
    const envJson = JSON.parse(await zip.file('KitchenLite.WFenvir')!.async('text'))
    expect(envJson.oid).toBe(harness.envOid)
    expect(envJson.local_id).toBe('KitchenLite')
    // Must NOT have environment_specifications (that is the legacy library shape)
    expect(envJson.environment_specifications).toBeUndefined()

    // actions/*.WFaction entries for each action — no code (.py) files
    const actionEntries = entries.filter((n) => n.startsWith('actions/') && n.endsWith('.WFaction'))
    expect(actionEntries).toHaveLength(2)
    const codeEntries = entries.filter((n) => n.endsWith('.py'))
    expect(codeEntries).toHaveLength(0)
  })

  it('GET /export-envir-x can round-trip through the existing upload handler', async () => {
    // Export the .WFenvirX
    const exportRes = await request(harness.app)
      .get(`/management/v1/environments/${harness.envOid}/export-envir-x`)
      .responseType('blob')
    expect(exportRes.status).toBe(200)

    // Delete the env
    await request(harness.app).delete(`/management/v1/environments/${harness.envOid}`).expect(200)

    // Re-upload via the existing upload handler using a .WFenvirX filename
    const uploadRes = await request(harness.app)
      .post('/management/v1/upload')
      .attach('files', exportRes.body as Buffer, 'KitchenLite.WFenvirX')
    expect(uploadRes.status).toBe(200)

    // Env is restored with 2 actions
    const envRes = await request(harness.app)
      .get(`/management/v1/environments/${harness.envOid}`)
      .expect(200)
    expect(envRes.body.data.local_id).toBe('KitchenLite')
    expect(envRes.body.data.actions).toHaveLength(2)

    // Actions have no code (states_with_code is empty) since .WFenvirX carries no code
    for (const action of envRes.body.data.actions as Array<{ states_with_code: string[] }>) {
      expect(action.states_with_code).toEqual([])
    }
  })
})
