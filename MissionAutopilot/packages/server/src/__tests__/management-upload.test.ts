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
 * management-upload.test.ts — Coverage for the /upload endpoint's .WFactionCodeX branch.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
import { SseManager } from '../sse-manager.js'
import { createManagementRouter } from '../routes/management.js'
import { errorHandler } from '../middleware/error-handler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCRIPT_PATH = path.resolve(__dirname, '../../../python-sidecar/sandbox_runner.py')

interface TestApp {
  app: express.Express
  manager: InstanceManager
  db: TestDb
  environmentRepo: EnvironmentRepository
  actionRepo: ActionRepository
  codeVersionRepo: CodeVersionRepository
}

async function createTestApp(): Promise<TestApp> {
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
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }))
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

  return { app, manager, db, environmentRepo, actionRepo, codeVersionRepo }
}

function buildActionWFactionCodeX(opts: {
  actionOid: string
  actionLocalId: string
  environmentOid: string
  visibility: 'observable' | 'opaque'
  states: Record<string, string>
}): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'action.WFaction',
    JSON.stringify({
      oid: opts.actionOid,
      local_id: opts.actionLocalId,
      version: '1.0.0',
      last_modified_date: '2026-05-09T00:00:00Z',
      environment_oid: opts.environmentOid,
      action_visibility: opts.visibility,
      input_parameter_specifications: [],
      output_parameter_specifications: [
        {
          id: 'status',
          value_type: 'literal',
          default_value: '0',
          description: '0=success, 1=simulated abort, 2=simulated timeout',
        },
      ],
      property_specifications: [],
    })
  )
  for (const [state, source] of Object.entries(opts.states)) {
    zip.file(`code/${state}.py`, source)
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('MGMT-UPLOAD: .WFactionCodeX branch', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await createTestApp()
  })

  afterAll(async () => {
    await testApp.manager.shutdown()
    await testApp.db.close()
  })

  it('imports a new action with code from a .WFactionCodeX', async () => {
    await testApp.environmentRepo.create({
      oid: 'env-codex-1',
      local_id: 'CodexEnv1',
      version: '1.0.0',
      last_modified_date: '2026-05-09T00:00:00Z',
      description: null,
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      schema_version: '4.0',
      source_filename: 'CodexEnv1.WFenvir',
    })

    const buf = await buildActionWFactionCodeX({
      actionOid: 'act-codex-1',
      actionLocalId: 'CodexAction1',
      environmentOid: 'env-codex-1',
      visibility: 'observable',
      states: {
        STARTING: "outputs['status'] = '0'",
        EXECUTING: "outputs['status'] = '0'",
      },
    })

    const res = await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf, {
        filename: 'CodexAction1.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(200)

    expect(res.body.data.imported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'action',
          oid: 'act-codex-1',
          status: 'created',
        }),
      ])
    )

    const action = await testApp.actionRepo.findByOid('act-codex-1')
    expect(action).not.toBeNull()
    expect(action?.action_visibility).toBe('observable')

    const startingActive = await testApp.codeVersionRepo.getActive('act-codex-1', 'STARTING')
    expect(startingActive?.source_code).toBe("outputs['status'] = '0'")

    const executingActive = await testApp.codeVersionRepo.getActive('act-codex-1', 'EXECUTING')
    expect(executingActive?.source_code).toBe("outputs['status'] = '0'")
  })

  it('rejects a .WFactionCodeX missing the action.WFaction entry', async () => {
    const zip = new JSZip()
    zip.file('code/STARTING.py', "outputs['status'] = '0'")
    const buf = await zip.generateAsync({ type: 'nodebuffer' })

    const res = await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf, {
        filename: 'NoAction.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(400)

    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.message).toContain('action.WFaction')
  })

  it('upserts an existing action via .WFactionCodeX (re-upload increments versions)', async () => {
    await testApp.environmentRepo.create({
      oid: 'env-codex-2',
      local_id: 'CodexEnv2',
      version: '1.0.0',
      last_modified_date: '2026-05-09T00:00:00Z',
      description: null,
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      schema_version: '4.0',
      source_filename: 'CodexEnv2.WFenvir',
    })

    const buf1 = await buildActionWFactionCodeX({
      actionOid: 'act-codex-2',
      actionLocalId: 'CodexAction2',
      environmentOid: 'env-codex-2',
      visibility: 'observable',
      states: { STARTING: "outputs['status'] = '0'" },
    })

    await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf1, {
        filename: 'CodexAction2.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(200)

    // Re-upload with updated code
    const buf2 = await buildActionWFactionCodeX({
      actionOid: 'act-codex-2',
      actionLocalId: 'CodexAction2',
      environmentOid: 'env-codex-2',
      visibility: 'observable',
      states: { STARTING: "outputs['status'] = '0'  # v2" },
    })

    const res = await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf2, {
        filename: 'CodexAction2.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(200)

    expect(res.body.data.imported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'action',
          oid: 'act-codex-2',
          status: 'updated',
        }),
      ])
    )

    const versions = await testApp.codeVersionRepo.getVersionHistory('act-codex-2', 'STARTING')
    expect(versions.length).toBe(2)
    const active = await testApp.codeVersionRepo.getActive('act-codex-2', 'STARTING')
    expect(active?.source_code).toBe("outputs['status'] = '0'  # v2")
  })

  it('imports an action without code/ folder (declaration-only ZIP)', async () => {
    await testApp.environmentRepo.create({
      oid: 'env-codex-3',
      local_id: 'CodexEnv3',
      version: '1.0.0',
      last_modified_date: '2026-05-09T00:00:00Z',
      description: null,
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      schema_version: '4.0',
      source_filename: 'CodexEnv3.WFenvir',
    })

    const buf = await buildActionWFactionCodeX({
      actionOid: 'act-codex-3',
      actionLocalId: 'CodexAction3',
      environmentOid: 'env-codex-3',
      visibility: 'opaque',
      states: {}, // no code files
    })

    await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf, {
        filename: 'CodexAction3.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(200)

    const action = await testApp.actionRepo.findByOid('act-codex-3')
    expect(action).not.toBeNull()
    expect(await testApp.codeVersionRepo.findByAction('act-codex-3')).toHaveLength(0)
  })

  it('rejects a corrupt ZIP', async () => {
    const buf = Buffer.from('not a zip')
    const res = await request(testApp.app)
      .post('/management/v1/upload')
      .attach('files', buf, {
        filename: 'Corrupt.WFactionCodeX',
        contentType: 'application/zip',
      })
      .expect(400)

    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.message).toContain('ZIP archive')
  })
})
