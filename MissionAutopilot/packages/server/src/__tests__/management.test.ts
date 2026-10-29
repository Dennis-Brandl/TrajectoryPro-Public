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
 * management.test.ts — Integration tests for all /management/v1/ endpoints.
 *
 * Uses supertest to exercise the actual Express routes with a real :memory: SQLite
 * database and real InstanceManager. Tests cover dashboard, upload (create/update/
 * orphan deletion/all-or-nothing/validation), environment list/detail/delete,
 * and action detail endpoints.
 *
 * Note: Tests that create InstanceManager instances use 30s timeout because
 * the Python worker pool spawns subprocesses. Managers are shut down in finally blocks.
 */

import { describe, it, expect, vi } from 'vitest'
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

// ============================================================
// Path helpers
// ============================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

// ============================================================
// Test app factory
// ============================================================

interface TestApp {
  app: express.Express
  manager: InstanceManager
  db: TestDb
  sseManager: SseManager
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
    sseManager,
    environmentRepo,
    actionRepo,
    codeVersionRepo,
    instanceRepo,
    logRepo,
    settingsRepo,
  }
}

// ============================================================
// Seed helpers
// ============================================================

async function seedEnvironment(
  db: TestDb,
  opts?: {
    oid?: string
    local_id?: string
    version?: string
    schema_version?: string
  }
): Promise<string> {
  const envRepo = new EnvironmentRepository(db)
  const oid = opts?.oid ?? 'env-mgmt-001'
  if (!(await envRepo.findByOid(oid))) {
    await envRepo.create({
      oid,
      local_id: opts?.local_id ?? `Env-${oid}`,
      version: opts?.version ?? '1.0',
      last_modified_date: new Date().toISOString(),
      schema_version: opts?.schema_version ?? '4.0',
      action_property_specifications: [],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: `${oid}.WFenvir`,
    })
  }
  return oid
}

async function seedAction(
  db: TestDb,
  envOid: string,
  opts?: {
    oid?: string
    local_id?: string
    visibility?: 'observable' | 'opaque'
  }
): Promise<string> {
  const actionRepo = new ActionRepository(db)
  const oid = opts?.oid ?? `action-mgmt-${envOid}-001`
  if (!(await actionRepo.findByOid(oid))) {
    await actionRepo.create({
      oid,
      environment_oid: envOid,
      local_id: opts?.local_id ?? `Action-${oid}`,
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      action_visibility: opts?.visibility ?? 'observable',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
    })
  }
  return oid
}

// ============================================================
// 0. Server info (MGMT-00) — the URL the console top-bar shows
// ============================================================

describe('GET /management/v1/server-info', () => {
  it("returns this server's REST base URL + protocol path + port", async () => {
    // Pin PORT for the duration of this test so we can assert the URL the
    // route synthesizes. The route reads process.env.PORT at request time.
    const prevPort = process.env.PORT
    const prevPublic = process.env.PUBLIC_BASE_URL
    process.env.PORT = '4242'
    delete process.env.PUBLIC_BASE_URL
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/server-info')
      expect(res.status).toBe(200)
      expect(res.body.data.rest_base_url).toBe('http://localhost:4242')
      expect(res.body.data.protocol_path).toBe('/trajectory/v1/')
      expect(res.body.data.port).toBe(4242)
    } finally {
      await manager.shutdown()
      // Restore previous env so we don't leak across tests.
      if (prevPort === undefined) delete process.env.PORT
      else process.env.PORT = prevPort
      if (prevPublic !== undefined) process.env.PUBLIC_BASE_URL = prevPublic
    }
  }, 30000)

  it('honors PUBLIC_BASE_URL override and strips trailing slashes', async () => {
    // Operators set PUBLIC_BASE_URL when the server is behind a reverse proxy
    // or reachable at a non-localhost hostname; we must not double-slash on
    // join with protocol_path.
    const prevPort = process.env.PORT
    const prevPublic = process.env.PUBLIC_BASE_URL
    process.env.PORT = '3002'
    process.env.PUBLIC_BASE_URL = 'https://action-server.example.com/'
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/server-info')
      expect(res.status).toBe(200)
      expect(res.body.data.rest_base_url).toBe('https://action-server.example.com')
      expect(res.body.data.protocol_path).toBe('/trajectory/v1/')
    } finally {
      await manager.shutdown()
      if (prevPort === undefined) delete process.env.PORT
      else process.env.PORT = prevPort
      if (prevPublic === undefined) delete process.env.PUBLIC_BASE_URL
      else process.env.PUBLIC_BASE_URL = prevPublic
    }
  }, 30000)

  it('reports fleet_base_url from FLEET_BASE_URL (trailing slash stripped) and null when unset', async () => {
    const prev = process.env.FLEET_BASE_URL
    process.env.FLEET_BASE_URL = 'http://mission-autopilot-server:3002/'
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/server-info')
      expect(res.body.data.fleet_base_url).toBe('http://mission-autopilot-server:3002')
      delete process.env.FLEET_BASE_URL
      const res2 = await request(app).get('/management/v1/server-info')
      expect(res2.body.data.fleet_base_url).toBeNull()
    } finally {
      await manager.shutdown()
      if (prev === undefined) delete process.env.FLEET_BASE_URL
      else process.env.FLEET_BASE_URL = prev
    }
  }, 30000)
})

// ============================================================
// 1. Dashboard (MGMT-01)
// ============================================================

describe('GET /management/v1/dashboard', () => {
  it('returns 200 with all top-level sections', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/dashboard')
      expect(res.status).toBe(200)
      expect(res.body.data).toBeDefined()
      expect(res.body.data.container).toBeDefined()
      expect(res.body.data.python_pool).toBeDefined()
      expect(res.body.data.environments).toBeDefined()
      expect(res.body.data.instances).toBeDefined()
      expect(res.body.data.log).toBeDefined()
      expect(Array.isArray(res.body.data.recent_log_entries)).toBe(true)
      expect(res.body.meta).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('container info includes node_version, uptime_seconds, started_at, memory_rss_bytes', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/dashboard')
      expect(res.status).toBe(200)
      const container = res.body.data.container as Record<string, unknown>
      expect(typeof container['node_version']).toBe('string')
      expect(container['node_version']).toMatch(/^v\d+/)
      expect(typeof container['uptime_seconds']).toBe('number')
      expect(container['uptime_seconds']).toBeGreaterThanOrEqual(0)
      expect(typeof container['started_at']).toBe('string')
      expect(typeof container['memory_rss_bytes']).toBe('number')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('pool status reflects actual pool state', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/dashboard')
      expect(res.status).toBe(200)
      const pool = res.body.data.python_pool as Record<string, unknown>
      expect(typeof pool['size']).toBe('number')
      expect(typeof pool['idle']).toBe('number')
      expect(typeof pool['busy']).toBe('number')
      expect(typeof pool['queued']).toBe('number')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('environment and action counts reflect seeded data', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const env1 = await seedEnvironment(db, { oid: 'env-dash-001' })
      const env2 = await seedEnvironment(db, { oid: 'env-dash-002' })
      await seedAction(db, env1, { oid: 'act-dash-001' })
      await seedAction(db, env1, { oid: 'act-dash-002' })
      await seedAction(db, env2, { oid: 'act-dash-003' })

      const res = await request(app).get('/management/v1/dashboard')
      expect(res.status).toBe(200)
      const environments = res.body.data.environments as Record<string, number>
      expect(environments['total_count']).toBe(2)
      expect(environments['total_actions']).toBe(3)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('uses { data, meta } envelope', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/dashboard')
      expect(res.body).toHaveProperty('data')
      expect(res.body).toHaveProperty('meta')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 2. Upload (MGMT-02)
// ============================================================

function makeEnvJson(
  oid: string,
  localId: string,
  version: string,
  actions: Array<{ oid: string; local_id: string; version?: string }>
): string {
  const now = new Date().toISOString()
  return JSON.stringify({
    local_id: `${localId} library`,
    oid: `${oid}_lib`,
    version: '1.0.0',
    last_modified_date: now,
    schemaVersion: '4.0',
    environment_specifications: [
      {
        oid,
        local_id: localId,
        version,
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
          input_parameter_specifications: [],
          output_parameter_specifications: [],
          property_specifications: [],
        })),
      },
    ],
  })
}

interface EnvSpec {
  oid: string
  localId: string
  version: string
  actions: Array<{ oid: string; local_id: string; version?: string }>
}

function envSpec(spec: EnvSpec) {
  const now = new Date().toISOString()
  return {
    oid: spec.oid,
    local_id: spec.localId,
    version: spec.version,
    last_modified_date: now,
    action_property_specifications: [],
    value_property_specifications: [],
    resource_property_specifications: [],
    included_actions: spec.actions.map((a) => ({
      oid: a.oid,
      local_id: a.local_id,
      version: a.version ?? '1.0',
      last_modified_date: now,
      action_visibility: 'observable',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
    })),
  }
}

function libraryJson(opts: {
  libraryName: string
  schemaVersion?: '3.0' | '4.0'
  envs: EnvSpec[]
}): string {
  const { libraryName, schemaVersion = '4.0', envs } = opts
  return JSON.stringify({
    local_id: libraryName,
    oid: `lib-${libraryName}`,
    version: '1.0.0',
    last_modified_date: new Date().toISOString(),
    schemaVersion,
    environment_specifications: envs.map(envSpec),
  })
}

async function makeWFenvirX(opts: {
  libraryName: string
  innerExt?: 'WFenvir' | 'WFenvirX'
  schemaVersion?: '3.0' | '4.0'
  envs: EnvSpec[]
  extraEntries?: Record<string, string>
}): Promise<Buffer> {
  const { libraryName, innerExt = 'WFenvir', schemaVersion = '4.0', envs, extraEntries } = opts
  const zip = new JSZip()
  zip.file(`${libraryName}.${innerExt}`, libraryJson({ libraryName, schemaVersion, envs }))
  if (extraEntries) {
    for (const [name, content] of Object.entries(extraEntries)) {
      zip.file(name, content)
    }
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('POST /management/v1/upload', () => {
  it('upload a .WFenvir file returns 200 with imported summary', async () => {
    const { app, manager } = await createTestApp()
    try {
      const envJson = makeEnvJson('env-upload-001', 'UploadEnv', '1.0', [
        { oid: 'act-upload-001', local_id: 'ActionA' },
      ])
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from(envJson), 'test.WFenvir')
      expect(res.status).toBe(200)
      expect(res.body.data.imported).toHaveLength(1)
      expect(res.body.data.imported[0].oid).toBe('env-upload-001')
      expect(res.body.data.imported[0].type).toBe('environment')
      expect(res.body.data.imported[0].status).toBe('created')
      expect(res.body.data.imported[0].actions_count).toBe(1)
      expect(res.body.data.diff).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload creates environment and actions visible via GET /environments', async () => {
    const { app, manager } = await createTestApp()
    try {
      const envJson = makeEnvJson('env-upload-002', 'UploadEnv2', '1.0', [
        { oid: 'act-upload-002', local_id: 'ActionB' },
        { oid: 'act-upload-003', local_id: 'ActionC' },
      ])
      await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from(envJson), 'env2.WFenvir')

      const listRes = await request(app).get('/management/v1/environments')
      expect(listRes.status).toBe(200)
      const env = listRes.body.data.find((e: { oid: string }) => e.oid === 'env-upload-002')
      expect(env).toBeDefined()
      expect(env.action_count).toBe(2)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('re-upload same OID updates environment and returns status: updated', async () => {
    const { app, manager } = await createTestApp()
    try {
      const envJson1 = makeEnvJson('env-reupload-001', 'ReuploadEnv', '1.0', [
        { oid: 'act-reupload-001', local_id: 'Action1' },
      ])
      await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from(envJson1), 'reupload.WFenvir')

      const envJson2 = makeEnvJson('env-reupload-001', 'ReuploadEnvUpdated', '2.0', [
        { oid: 'act-reupload-001', local_id: 'Action1', version: '2.0' },
      ])
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from(envJson2), 'reupload.WFenvir')

      expect(res.status).toBe(200)
      expect(res.body.data.imported[0].status).toBe('updated')
      expect(res.body.data.imported[0].version).toBe('2.0')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('re-upload with fewer actions deletes orphaned actions', async () => {
    const { app, manager } = await createTestApp()
    try {
      // Upload with 3 actions
      const envJson1 = makeEnvJson('env-orphan-001', 'OrphanEnv', '1.0', [
        { oid: 'act-orphan-001', local_id: 'Act1' },
        { oid: 'act-orphan-002', local_id: 'Act2' },
        { oid: 'act-orphan-003', local_id: 'Act3' },
      ])
      await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from(envJson1), 'orphan.WFenvir')

      // Re-upload with only 1 action
      const envJson2 = makeEnvJson('env-orphan-001', 'OrphanEnv', '2.0', [
        { oid: 'act-orphan-001', local_id: 'Act1' },
      ])
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from(envJson2), 'orphan.WFenvir')

      expect(res.status).toBe(200)
      // Diff should show removed
      expect(res.body.data.diff.removed).toHaveLength(2)

      // Verify via GET /environments/:oid
      const detailRes = await request(app).get('/management/v1/environments/env-orphan-001')
      expect(detailRes.status).toBe(200)
      expect(detailRes.body.data.actions).toHaveLength(1)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload invalid JSON returns 400', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from('not-valid-json'), 'bad.WFenvir')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload file with wrong extension returns 400', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from('{}'), 'wrong.txt')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload with no files returns 400', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).post('/management/v1/upload')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('all-or-nothing: upload 2 files where second is invalid — neither committed', async () => {
    const { app, manager } = await createTestApp()
    try {
      const goodEnvJson = makeEnvJson('env-atomicity-001', 'AtomicEnv', '1.0', [])
      // Invalid: missing library-level required field 'oid'
      const badEnvJson = JSON.stringify({
        local_id: 'Bad Library',
        version: '1.0.0',
        last_modified_date: new Date().toISOString(),
        schemaVersion: '4.0',
        environment_specifications: [],
        // library-level 'oid' missing
      })

      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from(goodEnvJson), 'good.WFenvir')
        .attach('files', Buffer.from(badEnvJson), 'bad.WFenvir')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')

      // Neither environment should be committed
      const listRes = await request(app).get('/management/v1/environments')
      const found = listRes.body.data.find((e: { oid: string }) => e.oid === 'env-atomicity-001')
      expect(found).toBeUndefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload .WFenvirX (ZIP) with one env imports it', async () => {
    const { app, manager } = await createTestApp()
    try {
      const buf = await makeWFenvirX({
        libraryName: 'ZipLib',
        envs: [
          {
            oid: 'env-zip-001',
            localId: 'ZipEnv',
            version: '1.0',
            actions: [{ oid: 'act-zip-001', local_id: 'ZipAction' }],
          },
        ],
      })
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', buf, 'ZipLib.WFenvirX')

      expect(res.status).toBe(200)
      expect(res.body.data.imported).toHaveLength(1)
      expect(res.body.data.imported[0].oid).toBe('env-zip-001')
      expect(res.body.data.imported[0].actions_count).toBe(1)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload .WFenvirX with two envs imports both atomically', async () => {
    const { app, manager } = await createTestApp()
    try {
      const buf = await makeWFenvirX({
        libraryName: 'MultiLib',
        envs: [
          {
            oid: 'env-multi-001',
            localId: 'EnvA',
            version: '1.0',
            actions: [{ oid: 'act-multi-001', local_id: 'ActA' }],
          },
          {
            oid: 'env-multi-002',
            localId: 'EnvB',
            version: '1.0',
            actions: [
              { oid: 'act-multi-002', local_id: 'ActB1' },
              { oid: 'act-multi-003', local_id: 'ActB2' },
            ],
          },
        ],
      })
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', buf, 'MultiLib.WFenvirX')

      expect(res.status).toBe(200)
      expect(res.body.data.imported).toHaveLength(2)
      const oids = (res.body.data.imported as Array<{ oid: string }>).map((i) => i.oid)
      expect(oids).toContain('env-multi-001')
      expect(oids).toContain('env-multi-002')

      const listRes = await request(app).get('/management/v1/environments')
      const found = listRes.body.data as Array<{ oid: string; action_count: number }>
      const a = found.find((e) => e.oid === 'env-multi-001')
      const b = found.find((e) => e.oid === 'env-multi-002')
      expect(a?.action_count).toBe(1)
      expect(b?.action_count).toBe(2)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload .WFenvirX with no inner .WFenvir entry returns 400', async () => {
    const { app, manager } = await createTestApp()
    try {
      const zip = new JSZip()
      zip.file('manifest.json', JSON.stringify({ packageType: 'environment-library' }))
      zip.file('readme.txt', 'no .WFenvir here')
      const buf = await zip.generateAsync({ type: 'nodebuffer' })

      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', buf, 'empty.WFenvirX')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toMatch(/no .WFenvir entry/)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload .WFenvirX with legacy inner .WFenvirX extension still works', async () => {
    const { app, manager } = await createTestApp()
    try {
      // Pre-fix exporters used the X-suffix on the inner JSON entry too.
      const buf = await makeWFenvirX({
        libraryName: 'LegacyLib',
        innerExt: 'WFenvirX',
        envs: [
          {
            oid: 'env-legacy-001',
            localId: 'LegacyEnv',
            version: '1.0',
            actions: [],
          },
        ],
      })
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', buf, 'LegacyLib.WFenvirX')

      expect(res.status).toBe(200)
      expect(res.body.data.imported).toHaveLength(1)
      expect(res.body.data.imported[0].oid).toBe('env-legacy-001')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload with schemaVersion "2.0" returns 400', async () => {
    const { app, manager } = await createTestApp()
    try {
      const json = JSON.stringify({
        local_id: 'OldLib',
        oid: 'lib-old',
        version: '1.0.0',
        last_modified_date: new Date().toISOString(),
        schemaVersion: '2.0',
        environment_specifications: [],
      })
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from(json), 'old.WFenvir')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toMatch(/schemaVersion/)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload with missing schemaVersion succeeds (defaults to current)', async () => {
    // Real Designer env-library exports omit schemaVersion at the library root.
    // Treat absent as current; only reject explicit < 3.0.
    const { app, manager } = await createTestApp()
    try {
      const now = new Date().toISOString()
      const json = JSON.stringify({
        local_id: 'NoVersionLib',
        oid: 'lib-no-version',
        version: '1.0.0',
        last_modified_date: now,
        // schemaVersion missing
        environment_specifications: [
          {
            oid: 'env-no-version-001',
            local_id: 'NoVersionEnv',
            version: '1.0',
            last_modified_date: now,
            included_actions: [],
          },
        ],
      })
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from(json), 'noversion.WFenvir')

      expect(res.status).toBe(200)
      expect(res.body.data.imported).toHaveLength(1)
      expect(res.body.data.imported[0].oid).toBe('env-no-version-001')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload with non-numeric schemaVersion returns 400', async () => {
    const { app, manager } = await createTestApp()
    try {
      const json = JSON.stringify({
        local_id: 'BadVersionLib',
        oid: 'lib-bad-version',
        version: '1.0.0',
        last_modified_date: new Date().toISOString(),
        schemaVersion: 'not-a-version',
        environment_specifications: [],
      })
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from(json), 'badversion.WFenvir')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toMatch(/schemaVersion/)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('upload with missing environment_specifications returns 400', async () => {
    const { app, manager } = await createTestApp()
    try {
      const json = JSON.stringify({
        local_id: 'NoEnvsLib',
        oid: 'lib-no-envs',
        version: '1.0.0',
        last_modified_date: new Date().toISOString(),
        schemaVersion: '4.0',
        // environment_specifications missing
      })
      const res = await request(app)
        .post('/management/v1/upload')
        .attach('files', Buffer.from(json), 'noenvs.WFenvir')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toMatch(/environment_specifications/)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 3. Environment list (MGMT-03)
// ============================================================

describe('GET /management/v1/environments', () => {
  it('returns empty array when no environments seeded', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/environments')
      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
      expect(res.body.meta.total).toBe(0)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns environments with action_count per environment', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, { oid: 'env-list-001' })
      await seedAction(db, envOid, { oid: 'act-list-001' })
      await seedAction(db, envOid, { oid: 'act-list-002' })

      const res = await request(app).get('/management/v1/environments')
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].oid).toBe(envOid)
      expect(res.body.data[0].action_count).toBe(2)
      expect(res.body.meta.total).toBe(1)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 4. Environment detail (MGMT-04)
// ============================================================

describe('GET /management/v1/environments/:oid', () => {
  it('returns full environment detail with actions list', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, { oid: 'env-detail-001' })
      await seedAction(db, envOid, { oid: 'act-detail-001' })

      const res = await request(app).get(`/management/v1/environments/${envOid}`)
      expect(res.status).toBe(200)
      expect(res.body.data.oid).toBe(envOid)
      expect(Array.isArray(res.body.data.actions)).toBe(true)
      expect(res.body.data.actions).toHaveLength(1)
      expect(res.body.data.actions[0].oid).toBe('act-detail-001')
      expect(res.body.data.actions[0]).toHaveProperty('states_with_code')
      expect(res.body.meta).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown environment OID', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/environments/does-not-exist')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 5. Environment delete (MGMT-05)
// ============================================================

describe('DELETE /management/v1/environments/:oid', () => {
  it('returns 200 with deletion counts when no active instances', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, { oid: 'env-delete-001' })
      await seedAction(db, envOid, { oid: 'act-delete-001' })
      await seedAction(db, envOid, { oid: 'act-delete-002' })

      const res = await request(app).delete(`/management/v1/environments/${envOid}`)
      expect(res.status).toBe(200)
      expect(res.body.data.deleted).toBe(true)
      expect(res.body.data.environment_oid).toBe(envOid)
      expect(res.body.data.actions_removed).toBe(2)
      expect(typeof res.body.data.code_versions_removed).toBe('number')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown environment OID', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).delete('/management/v1/environments/does-not-exist')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('cleans up terminal-state instances and reports instances_removed', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, { oid: 'env-terminal-001' })
      const actionOid = await seedAction(db, envOid, {
        oid: 'act-terminal-001',
        visibility: 'opaque',
      })

      const instanceRepo = new InstanceRepository(db)
      const inst = await instanceRepo.create({
        runtime_action_instance_id: 'inst-terminal-001',
        action_oid: actionOid,
        environment_oid: envOid,
        workflow_instance_id: 'wf-terminal',
        step_instance_id: 'step-terminal',
        step_oid: 'step-oid-terminal',
        visibility: 'opaque',
        state: 'COMPLETE',
        input_parameters: [],
        output_parameters: [],
        state_history: [],
        pinned_code_versions: [],
        states_with_code_executed: [],
      })
      // Mark terminal: completed_at IS NOT NULL → not "active"
      await instanceRepo.updateState(inst.runtime_action_instance_id, 'COMPLETE', {
        completed_at: new Date().toISOString(),
      })

      const res = await request(app).delete(`/management/v1/environments/${envOid}`)
      expect(res.status).toBe(200)
      expect(res.body.data.deleted).toBe(true)
      expect(res.body.data.environment_oid).toBe(envOid)
      expect(res.body.data.actions_removed).toBe(1)
      expect(res.body.data.instances_removed).toBe(1)
      // Underlying records actually gone
      expect(await instanceRepo.findById(inst.runtime_action_instance_id)).toBeNull()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 409 CONFLICT when active instances exist', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, { oid: 'env-conflict-001' })
      const actionOid = await seedAction(db, envOid, {
        oid: 'act-conflict-001',
        visibility: 'opaque',
      })

      // Create an active instance (not completed)
      const instanceRepo = new InstanceRepository(db)
      await instanceRepo.create({
        runtime_action_instance_id: 'inst-conflict-001',
        action_oid: actionOid,
        environment_oid: envOid,
        workflow_instance_id: 'wf-conflict',
        step_instance_id: 'step-conflict',
        step_oid: 'step-oid-conflict',
        visibility: 'opaque',
        state: 'RUNNING',
        input_parameters: [],
        output_parameters: [],
        state_history: [],
        pinned_code_versions: [],
        states_with_code_executed: [],
      })

      const res = await request(app).delete(`/management/v1/environments/${envOid}`)
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('CONFLICT')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('delete answers 409 and deletes nothing when an instance is active at transaction time', async () => {
    const { app, manager, db, instanceRepo } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, { oid: 'env-race-001' })
      const actionOid = await seedAction(db, envOid, { oid: 'act-race-001', visibility: 'opaque' })
      await db.query(
        `INSERT INTO code_versions (id, action_oid, state, version_number, source_code, created_at)
         VALUES ('cv-race-001', $1, 'EXECUTING', 1, 'pass', '2026-01-01T00:00:00Z')`,
        [actionOid]
      )
      await instanceRepo.create({
        runtime_action_instance_id: 'inst-race-001',
        action_oid: actionOid,
        environment_oid: envOid,
        workflow_instance_id: 'wf-race',
        step_instance_id: 'step-race',
        step_oid: 'step-oid-race',
        visibility: 'opaque',
        state: 'EXECUTING',
        input_parameters: [],
        output_parameters: [],
        state_history: [],
        pinned_code_versions: [],
        states_with_code_executed: [],
      })
      // The fast-path check sees nothing (the instance "started after" it).
      vi.spyOn(instanceRepo, 'findByAction').mockResolvedValue([])

      const res = await request(app).delete(`/management/v1/environments/${envOid}`)
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('CONFLICT')

      const count = async (t: string) =>
        Number((await db.query(`SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n)
      expect(await count('environments')).toBe(1)
      expect(await count('actions')).toBe(1)
      expect(await count('code_versions')).toBe(1)
      expect(await count('instances')).toBe(1)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 5b. Property bus teardown on environment delete (Task 2.10)
// ============================================================

describe('DELETE /management/v1/environments/:oid — property bus teardown', () => {
  it('destroys property buses when environment is deleted', async () => {
    const { app, manager, sseManager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, { oid: 'env-bus-teardown-001' })

      // Subscribe to a property bus for the env
      const received: unknown[] = []
      sseManager.subscribeProperty(envOid, 'SIM_MODE', (ev) => received.push(ev))

      // Sanity check: publish reaches the listener before delete
      sseManager.publishProperty(envOid, 'SIM_MODE', {
        entries: [{ name: 'SIM_MODE', value: 'on' }],
        changed_entries: ['SIM_MODE'],
        source: 'action_code',
      })
      expect(received).toHaveLength(1)

      // Delete the environment via the route
      const res = await request(app).delete(`/management/v1/environments/${envOid}`)
      expect(res.status).toBe(200)

      // Clear the received array; re-publish must NOT fire the listener
      received.length = 0
      sseManager.publishProperty(envOid, 'SIM_MODE', {
        entries: [{ name: 'SIM_MODE', value: 'off' }],
        changed_entries: ['SIM_MODE'],
        source: 'action_code',
      })
      expect(received).toHaveLength(0)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('does NOT destroy property buses when delete returns 409 (active instances)', async () => {
    const { app, manager, sseManager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, { oid: 'env-bus-no-teardown-001' })
      const actionOid = await seedAction(db, envOid, {
        oid: 'act-bus-no-teardown-001',
        visibility: 'opaque',
      })

      // Subscribe before the attempted delete
      const received: unknown[] = []
      sseManager.subscribeProperty(envOid, 'SIM_MODE', (ev) => received.push(ev))

      // Seed an active instance so the delete returns 409
      const instanceRepo = new InstanceRepository(db)
      await instanceRepo.create({
        runtime_action_instance_id: 'inst-bus-active-001',
        action_oid: actionOid,
        environment_oid: envOid,
        workflow_instance_id: 'wf-bus-active',
        step_instance_id: 'step-bus-active',
        step_oid: 'step-oid-bus-active',
        visibility: 'opaque',
        state: 'RUNNING',
        input_parameters: [],
        output_parameters: [],
        state_history: [],
        pinned_code_versions: [],
        states_with_code_executed: [],
      })

      const res = await request(app).delete(`/management/v1/environments/${envOid}`)
      expect(res.status).toBe(409)

      // Bus must still be alive: publish should reach the listener
      sseManager.publishProperty(envOid, 'SIM_MODE', {
        entries: [{ name: 'SIM_MODE', value: 'on' }],
        changed_entries: ['SIM_MODE'],
        source: 'action_code',
      })
      expect(received).toHaveLength(1)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 6. Action detail (MGMT-06)
// ============================================================

describe('GET /management/v1/actions/:oid', () => {
  it('returns full action detail with environment_name and code_summary', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, {
        oid: 'env-action-detail-001',
        local_id: 'ActionEnv',
      })
      const actionOid = await seedAction(db, envOid, { oid: 'act-action-detail-001' })

      const res = await request(app).get(`/management/v1/actions/${actionOid}`)
      expect(res.status).toBe(200)
      expect(res.body.data.oid).toBe(actionOid)
      expect(res.body.data.environment_name).toBe('ActionEnv')
      expect(res.body.data.code_summary).toBeDefined()
      expect(Array.isArray(res.body.data.code_summary.states_with_code)).toBe(true)
      expect(typeof res.body.data.code_summary.total_versions).toBe('number')
      expect(res.body.meta).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown action OID', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/actions/does-not-exist')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})
