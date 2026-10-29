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
 * export-import.test.ts — Integration tests for action code and snapshot
 * export/import endpoints.
 */

import { describe, it, expect } from 'vitest'
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
import { createApiKeyAuth } from '../middleware/auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

interface TestApp {
  app: express.Express
  manager: InstanceManager
  db: TestDb
  environmentRepo: EnvironmentRepository
  actionRepo: ActionRepository
  codeVersionRepo: CodeVersionRepository
  instanceRepo: InstanceRepository
  logRepo: LogRepository
  settingsRepo: SettingsRepository
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
      allowedHeaders: ['Content-Type', 'X-API-Key', 'Last-Event-ID'],
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

  return {
    app,
    manager,
    db,
    environmentRepo,
    actionRepo,
    codeVersionRepo,
    instanceRepo,
    logRepo,
    settingsRepo,
  }
}

/** Seed an environment + action + active code for testing */
async function seedActionWithCode(t: TestApp): Promise<void> {
  await t.environmentRepo.upsert({
    oid: 'env-test-001',
    local_id: 'TestEnv',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00Z',
    schema_version: '4.0',
    action_property_specifications: [],
    value_property_specifications: [],
    resource_property_specifications: [],
    source_filename: 'test.WFenvir',
  })

  await t.actionRepo.upsert({
    oid: 'act-test-001',
    environment_oid: 'env-test-001',
    local_id: 'TestAction',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00Z',
    action_visibility: 'observable',
    input_parameter_specifications: [{ name: 'item_id', data_type: 'string' }],
    output_parameter_specifications: [{ name: 'result', data_type: 'string' }],
    property_specifications: [],
  })

  // Create and activate code for EXECUTING state
  const cv1 = await t.codeVersionRepo.save({
    action_oid: 'act-test-001',
    state: 'EXECUTING',
    source_code: 'print("executing")',
    description: 'Main logic',
  })
  await t.codeVersionRepo.activate(cv1.id)

  // Create and activate code for ABORTING state
  const cv2 = await t.codeVersionRepo.save({
    action_oid: 'act-test-001',
    state: 'ABORTING',
    source_code: 'print("aborting")',
    description: 'Cleanup',
  })
  await t.codeVersionRepo.activate(cv2.id)
}

// ============================================================
// Action Code Export
// ============================================================

describe('Action Code Export — GET /management/v1/actions/:oid/export', () => {
  it('returns a valid .WFactionCode ZIP with manifest and .py files', async () => {
    const t = await createTestApp()
    try {
      await seedActionWithCode(t)

      const res = await request(t.app)
        .get('/management/v1/actions/act-test-001/export')
        .responseType('arraybuffer')
        .expect(200)

      expect(res.headers['content-type']).toContain('application/zip')
      expect(res.headers['content-disposition']).toContain('TestAction.WFactionCode')

      const zip = await JSZip.loadAsync(res.body)
      const fileNames = Object.keys(zip.files).sort()
      expect(fileNames).toEqual(['ABORTING.py', 'EXECUTING.py', 'manifest.json'])

      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
      expect(manifest.format_version).toBe('1.0')
      expect(manifest.action.oid).toBe('act-test-001')
      expect(manifest.action.local_id).toBe('TestAction')
      expect(manifest.action.action_visibility).toBe('observable')
      expect(manifest.code_files).toHaveLength(2)

      const executing = await zip.file('EXECUTING.py')!.async('string')
      expect(executing).toBe('print("executing")')
      const aborting = await zip.file('ABORTING.py')!.async('string')
      expect(aborting).toBe('print("aborting")')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('returns 404 for unknown action', async () => {
    const t = await createTestApp()
    try {
      const res = await request(t.app)
        .get('/management/v1/actions/act-nonexistent/export')
        .expect(404)

      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('returns ZIP with only manifest when action has no code', async () => {
    const t = await createTestApp()
    try {
      await seedActionWithCode(t)
      await t.codeVersionRepo.deleteByAction('act-test-001')

      const res = await request(t.app)
        .get('/management/v1/actions/act-test-001/export')
        .responseType('arraybuffer')
        .expect(200)

      const zip = await JSZip.loadAsync(res.body)
      const fileNames = Object.keys(zip.files)
      expect(fileNames).toEqual(['manifest.json'])

      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
      expect(manifest.code_files).toHaveLength(0)
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)
})

// ============================================================
// Action Code Import
// ============================================================

describe('Action Code Import — POST /management/v1/actions/:oid/import', () => {
  /** Helper: build a .WFactionCode ZIP buffer */
  async function buildActionCodeZip(
    manifest: object,
    codeFiles: Record<string, string>
  ): Promise<Buffer> {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))
    for (const [name, code] of Object.entries(codeFiles)) {
      zip.file(name, code)
    }
    return zip.generateAsync({ type: 'nodebuffer' })
  }

  it('imports code files as new active versions', async () => {
    const t = await createTestApp()
    try {
      await seedActionWithCode(t)

      const manifest = {
        format_version: '1.0',
        exported_at: '2026-01-01T00:00:00Z',
        action: { oid: 'act-test-001', local_id: 'TestAction' },
        code_files: [
          { state: 'EXECUTING', filename: 'EXECUTING.py', description: 'Updated logic' },
        ],
      }
      const zipBuf = await buildActionCodeZip(manifest, {
        'EXECUTING.py': 'print("updated executing")',
      })

      const res = await request(t.app)
        .post('/management/v1/actions/act-test-001/import')
        .attach('file', zipBuf, 'TestAction.WFactionCode')
        .expect(200)

      expect(res.body.data.imported_states).toEqual(['EXECUTING'])
      expect(res.body.data.skipped_states).toEqual([])

      // Verify the new version is active
      const active = await t.codeVersionRepo.getActive('act-test-001', 'EXECUTING')
      expect(active).not.toBeNull()
      expect(active!.source_code).toBe('print("updated executing")')

      // Verify ABORTING was not touched
      const abortActive = await t.codeVersionRepo.getActive('act-test-001', 'ABORTING')
      expect(abortActive!.source_code).toBe('print("aborting")')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('rejects import when manifest action OID does not match URL', async () => {
    const t = await createTestApp()
    try {
      await seedActionWithCode(t)

      const manifest = {
        format_version: '1.0',
        action: { oid: 'act-WRONG-oid', local_id: 'TestAction' },
        code_files: [],
      }
      const zipBuf = await buildActionCodeZip(manifest, {})

      const res = await request(t.app)
        .post('/management/v1/actions/act-test-001/import')
        .attach('file', zipBuf, 'TestAction.WFactionCode')
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toContain('does not match')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('returns 404 for unknown action', async () => {
    const t = await createTestApp()
    try {
      const manifest = {
        format_version: '1.0',
        action: { oid: 'act-nonexistent', local_id: 'X' },
        code_files: [],
      }
      const zipBuf = await buildActionCodeZip(manifest, {})

      await request(t.app)
        .post('/management/v1/actions/act-nonexistent/import')
        .attach('file', zipBuf, 'X.WFactionCode')
        .expect(404)
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('rejects upload with no file', async () => {
    const t = await createTestApp()
    try {
      await seedActionWithCode(t)

      await request(t.app).post('/management/v1/actions/act-test-001/import').expect(400)
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)
})

// ============================================================
// Snapshot Export
// ============================================================

describe('Snapshot Export — GET /management/v1/snapshot/export', () => {
  it('returns a valid .WFsnapshot ZIP with environments, code, and settings', async () => {
    const t = await createTestApp()
    try {
      await seedActionWithCode(t)

      const res = await request(t.app)
        .get('/management/v1/snapshot/export')
        .responseType('arraybuffer')
        .expect(200)

      expect(res.headers['content-type']).toContain('application/zip')
      expect(res.headers['content-disposition']).toContain('.WFsnapshot')

      const zip = await JSZip.loadAsync(res.body)
      const fileNames = Object.keys(zip.files).sort()

      expect(fileNames).toContain('manifest.json')
      expect(fileNames).toContain('settings.json')
      expect(fileNames).toContain('environments/env-test-001.json')
      expect(fileNames).toContain('code/act-test-001/EXECUTING.py')
      expect(fileNames).toContain('code/act-test-001/ABORTING.py')

      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
      expect(manifest.format_version).toBe('1.0')
      expect(manifest.environment_count).toBe(1)
      expect(manifest.action_count).toBe(1)
      expect(manifest.code_file_count).toBe(2)

      const envJson = JSON.parse(await zip.file('environments/env-test-001.json')!.async('string'))
      expect(envJson.oid).toBe('env-test-001')
      expect(envJson.included_actions).toHaveLength(1)
      expect(envJson.included_actions[0].oid).toBe('act-test-001')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('returns a valid ZIP even with empty database', async () => {
    const t = await createTestApp()
    try {
      const res = await request(t.app)
        .get('/management/v1/snapshot/export')
        .responseType('arraybuffer')
        .expect(200)

      const zip = await JSZip.loadAsync(res.body)
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
      expect(manifest.environment_count).toBe(0)
      expect(manifest.action_count).toBe(0)
      expect(manifest.code_file_count).toBe(0)
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)
})

// ============================================================
// Snapshot Import
// ============================================================

describe('Snapshot api_key handling', () => {
  it('exported settings.json has no api_key entry', async () => {
    const t = await createTestApp()
    try {
      const res = await request(t.app)
        .get('/management/v1/snapshot/export')
        .responseType('arraybuffer')
        .expect(200)
      const zip = await JSZip.loadAsync(res.body)
      const settings = JSON.parse(await zip.file('settings.json')!.async('string')) as Array<{
        key: string
      }>
      expect(settings.length).toBeGreaterThan(0)
      expect(settings.some((x) => x.key === 'api_key')).toBe(false)
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('importing an old snapshot carrying api_key leaves the api_key row and auth unchanged', async () => {
    const t = await createTestApp()
    try {
      await t.settingsRepo.update('api_key', 'row-value-unchanged')
      const res = await request(t.app)
        .get('/management/v1/snapshot/export')
        .responseType('arraybuffer')
        .expect(200)
      const zip = await JSZip.loadAsync(res.body)
      const settings = JSON.parse(await zip.file('settings.json')!.async('string')) as Array<
        Record<string, unknown>
      >
      settings.push({ key: 'api_key', value: '' })
      zip.file('settings.json', JSON.stringify(settings))
      const buf = await zip.generateAsync({ type: 'nodebuffer' })

      await request(t.app)
        .post('/management/v1/snapshot/import?confirm=true')
        .attach('file', buf, 'snapshot.WFsnapshot')
        .expect(200)

      expect(await t.settingsRepo.getValue('api_key')).toBe('row-value-unchanged')

      // Auth comes from the env key, which an import cannot touch.
      const guarded = express()
      guarded.use(createApiKeyAuth('test-key-0123456789abcdef0123456789abcdef'))
      guarded.get('/x', (_req, r) => void r.json({}))
      await request(guarded).get('/x').expect(401)
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)
})

describe('Snapshot Import — POST /management/v1/snapshot/import', () => {
  /** Helper: export a snapshot from a seeded app */
  async function exportSnapshot(t: TestApp): Promise<Buffer> {
    const res = await request(t.app)
      .get('/management/v1/snapshot/export')
      .responseType('arraybuffer')
      .expect(200)
    return res.body as Buffer
  }

  it('requires ?confirm=true query parameter', async () => {
    const t = await createTestApp()
    try {
      await seedActionWithCode(t)
      const snapBuf = await exportSnapshot(t)

      const res = await request(t.app)
        .post('/management/v1/snapshot/import')
        .attach('file', snapBuf, 'snapshot.WFsnapshot')
        .expect(400)

      expect(res.body.error.message).toContain('confirm=true')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('fully replaces container state from snapshot', async () => {
    const t = await createTestApp()
    try {
      await seedActionWithCode(t)
      const snapBuf = await exportSnapshot(t)

      // Add a second environment that should be wiped on import
      await t.environmentRepo.upsert({
        oid: 'env-extra-999',
        local_id: 'ExtraEnv',
        version: '1.0.0',
        last_modified_date: '2026-01-01T00:00:00Z',
        schema_version: '4.0',
        action_property_specifications: [],
        value_property_specifications: [],
        resource_property_specifications: [],
        source_filename: 'extra.WFenvir',
      })

      // Import snapshot (should restore to just the original env)
      const res = await request(t.app)
        .post('/management/v1/snapshot/import?confirm=true')
        .attach('file', snapBuf, 'snapshot.WFsnapshot')
        .expect(200)

      expect(res.body.data.environments_imported).toBe(1)
      expect(res.body.data.actions_imported).toBe(1)
      expect(res.body.data.code_files_imported).toBe(2)

      // Verify extra environment was deleted
      const allEnvs = await t.environmentRepo.findAll()
      expect(allEnvs).toHaveLength(1)
      expect(allEnvs[0].oid).toBe('env-test-001')

      // Verify code was restored
      const active = await t.codeVersionRepo.getActive('act-test-001', 'EXECUTING')
      expect(active).not.toBeNull()
      expect(active!.source_code).toBe('print("executing")')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('returns 400 for invalid ZIP', async () => {
    const t = await createTestApp()
    try {
      const res = await request(t.app)
        .post('/management/v1/snapshot/import?confirm=true')
        .attach('file', Buffer.from('not a zip'), 'bad.WFsnapshot')
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)
})

// ============================================================
// Export-envir-x: new single-env .WFenvirX shape
// ============================================================

describe('export-envir-x — GET /management/v1/environments/:oid/export-envir-x', () => {
  it('returns a zip with manifest.json, root *.WFenvir, and actions/*.WFaction', async () => {
    const t = await createTestApp()
    try {
      await seedActionWithCode(t)

      const res = await request(t.app)
        .get('/management/v1/environments/env-test-001/export-envir-x')
        .responseType('arraybuffer')
        .expect(200)

      expect(res.headers['content-type']).toContain('application/zip')
      expect(res.headers['content-disposition']).toContain('TestEnv.WFenvirX')

      const zip = await JSZip.loadAsync(res.body)
      const fileNames = Object.keys(zip.files).sort()

      // Must have exactly three entry types: root .WFenvir, actions/*.WFaction, manifest.json
      expect(fileNames).toContain('manifest.json')
      expect(fileNames).toContain('TestEnv.WFenvir')
      expect(fileNames).toContain('actions/TestAction.WFaction')

      // manifest.json must identify as environment-package
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
      expect(manifest.packageType).toBe('environment-package')
      expect(manifest.formatVersion).toBe(1)
      expect(manifest.environmentName).toBe('TestEnv')
      expect(manifest.actionCount).toBe(1)

      // Root .WFenvir must be a single-env object (NOT library-wrapped)
      const envJson = JSON.parse(await zip.file('TestEnv.WFenvir')!.async('string'))
      expect(envJson.oid).toBe('env-test-001')
      expect(envJson.local_id).toBe('TestEnv')
      // Must NOT have environment_specifications (that is the library shape)
      expect(envJson.environment_specifications).toBeUndefined()

      // actions/*.WFaction must contain standalone action object
      const actionJson = JSON.parse(await zip.file('actions/TestAction.WFaction')!.async('string'))
      expect(actionJson.oid).toBe('act-test-001')
      expect(actionJson.local_id).toBe('TestAction')
      expect(actionJson.action_visibility).toBe('observable')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('returns 404 for unknown environment', async () => {
    const t = await createTestApp()
    try {
      const res = await request(t.app)
        .get('/management/v1/environments/env-nonexistent/export-envir-x')
        .expect(404)

      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)

  it('export-envir-x round-trip: export → re-upload as wfenvirx-single-env → env+actions restored', async () => {
    const t = await createTestApp()
    try {
      await seedActionWithCode(t)

      // 1. Export the env as new single-env .WFenvirX
      const exportRes = await request(t.app)
        .get('/management/v1/environments/env-test-001/export-envir-x')
        .responseType('arraybuffer')
        .expect(200)

      const zipBuf = exportRes.body as Buffer

      // 2. Mutate the env in-place (change description) so we can detect the re-import
      await t.environmentRepo.upsert({
        oid: 'env-test-001',
        local_id: 'TestEnv',
        version: '1.0.0',
        last_modified_date: '2026-01-01T00:00:00Z',
        schema_version: '4.0',
        description: 'CHANGED',
        action_property_specifications: [],
        value_property_specifications: [],
        resource_property_specifications: [],
        source_filename: 'test.WFenvir',
      })

      // 3. Re-upload the exported ZIP via POST /management/v1/upload
      const uploadRes = await request(t.app)
        .post('/management/v1/upload')
        .attach('files', zipBuf, 'TestEnv.WFenvirX')
        .expect(200)

      expect(uploadRes.body.data.imported).toHaveLength(1)
      expect(uploadRes.body.data.imported[0].oid).toBe('env-test-001')
      expect(uploadRes.body.data.imported[0].local_id).toBe('TestEnv')

      // 4. Assert the round-tripped env matches the original (description restored to null)
      const envAfter = await t.environmentRepo.findByOid('env-test-001')
      expect(envAfter).not.toBeNull()
      expect(envAfter!.local_id).toBe('TestEnv')
      expect(envAfter!.description).toBeNull()

      // 5. Assert action was round-tripped correctly
      const actionsAfter = await t.actionRepo.findByEnvironment('env-test-001')
      expect(actionsAfter).toHaveLength(1)
      expect(actionsAfter[0].oid).toBe('act-test-001')
      expect(actionsAfter[0].local_id).toBe('TestAction')
      expect(actionsAfter[0].action_visibility).toBe('observable')
    } finally {
      await t.manager.shutdown()
    }
  }, 30_000)
})
