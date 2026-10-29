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
 * management-code.test.ts — Integration tests for code management endpoints.
 *
 * Tests all 7 code endpoints (MGMT-07 through MGMT-12 + MGMT-CLEAR):
 *   MGMT-07:    GET    /code/:action_oid/:state                       — list versions (metadata only)
 *   MGMT-08:    GET    /code/:action_oid/:state/active                — active version with source
 *   MGMT-08:    GET    /code/:action_oid/:state/:version_id           — specific version with source
 *   MGMT-09:    POST   /code/:action_oid/:state                       — save new version
 *   MGMT-10:    POST   /code/:action_oid/:state/:version_id/activate  — rollback
 *   MGMT-11:    DELETE /code/:action_oid/:state/:version_id           — delete with guards
 *   MGMT-12:    POST   /code/:action_oid/:state/test                  — dry-run execution
 *   MGMT-CLEAR: DELETE /code/:action_oid/:state                       — wipe all versions for a state
 *
 * Uses createTestApp() factory (fresh :memory: DB + InstanceManager per test).
 * Real Python pool (poolSize: 1). Managers shut down in finally blocks. 30s timeout.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import request from 'supertest'
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

const SCRIPT_PATH = path.resolve(__dirname, '../../../python-sidecar/sandbox_runner.py')

// ============================================================
// Test app factory
// ============================================================

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

// ============================================================
// Seed helpers
// ============================================================

async function seedEnvironment(db: TestDb, oid: string): Promise<string> {
  const envRepo = new EnvironmentRepository(db)
  if (!(await envRepo.findByOid(oid))) {
    await envRepo.create({
      oid,
      local_id: `Env-${oid}`,
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      schema_version: '4.0',
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
  actionOid: string,
  visibility: 'observable' | 'opaque' = 'observable'
): Promise<string> {
  const actionRepo = new ActionRepository(db)
  if (!(await actionRepo.findByOid(actionOid))) {
    await actionRepo.create({
      oid: actionOid,
      environment_oid: envOid,
      local_id: `Action-${actionOid}`,
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      action_visibility: visibility,
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
    })
  }
  return actionOid
}

// Simple valid Python code for dry-run tests
const VALID_PYTHON = `def execute(inputs, outputs, props, action_props):
    outputs['result'] = 'hello'
    return True`

const SYNTAX_ERROR_PYTHON = `def execute(inputs, outputs, props, action_props):
    outputs['result'] = 'hello'
    return True
    invalid syntax %%%`

// ============================================================
// 1. Code version list (MGMT-07)
// ============================================================

describe('GET /management/v1/code/:action_oid/:state (MGMT-07)', () => {
  it('returns empty versions array when no code exists', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-code-list-001')
      const actionOid = await seedAction(db, envOid, 'act-code-list-001')

      const res = await request(app).get(`/management/v1/code/${actionOid}/EXECUTING`)
      expect(res.status).toBe(200)
      expect(res.body.data.action_oid).toBe(actionOid)
      expect(res.body.data.state).toBe('EXECUTING')
      expect(res.body.data.versions).toEqual([])
      expect(res.body.meta).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('after saving 2 versions, list returns both with metadata (no source_code field)', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-code-list-002')
      const actionOid = await seedAction(db, envOid, 'act-code-list-002')
      const codeVersionRepo = new CodeVersionRepository(db)

      // Save two versions
      await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: 'def execute(inputs, outputs, props, action_props): return True',
        description: 'Version 1',
      })
      await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: 'def execute(inputs, outputs, props, action_props): return False',
        description: 'Version 2',
      })

      const res = await request(app).get(`/management/v1/code/${actionOid}/EXECUTING`)
      expect(res.status).toBe(200)
      expect(res.body.data.versions).toHaveLength(2)

      // Verify metadata fields present
      const v = res.body.data.versions[0] as Record<string, unknown>
      expect(v).toHaveProperty('id')
      expect(v).toHaveProperty('version_number')
      expect(v).toHaveProperty('is_active')
      expect(v).toHaveProperty('created_at')
      expect(v).toHaveProperty('code_size')

      // Verify source_code is NOT included
      expect(v).not.toHaveProperty('source_code')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown action_oid', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/code/does-not-exist/EXECUTING')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 2. Active / specific version retrieval (MGMT-08)
// ============================================================

describe('GET /management/v1/code/:action_oid/:state/active (MGMT-08 active)', () => {
  it('returns 404 when no active version exists', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-active-001')
      const actionOid = await seedAction(db, envOid, 'act-active-001')

      const res = await request(app).get(`/management/v1/code/${actionOid}/EXECUTING/active`)
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('after saving a version, /active returns it with full source_code', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-active-002')
      const actionOid = await seedAction(db, envOid, 'act-active-002')
      const codeVersionRepo = new CodeVersionRepository(db)

      const saved = await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: VALID_PYTHON,
      })

      const res = await request(app).get(`/management/v1/code/${actionOid}/EXECUTING/active`)
      expect(res.status).toBe(200)
      expect(res.body.data.id).toBe(saved.id)
      expect(res.body.data.is_active).toBe(true)
      expect(res.body.data.source_code).toBe(VALID_PYTHON)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

describe('GET /management/v1/code/:action_oid/:state/:version_id (MGMT-08 specific)', () => {
  it('returns specific version with full source_code', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-specific-001')
      const actionOid = await seedAction(db, envOid, 'act-specific-001')
      const codeVersionRepo = new CodeVersionRepository(db)

      const saved = await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: VALID_PYTHON,
      })

      const res = await request(app).get(`/management/v1/code/${actionOid}/EXECUTING/${saved.id}`)
      expect(res.status).toBe(200)
      expect(res.body.data.id).toBe(saved.id)
      expect(res.body.data.source_code).toBe(VALID_PYTHON)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown version_id', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-specific-002')
      const actionOid = await seedAction(db, envOid, 'act-specific-002')

      const res = await request(app).get(
        `/management/v1/code/${actionOid}/EXECUTING/does-not-exist`
      )
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 when version_id belongs to different action_oid', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-specific-003')
      const actionOid1 = await seedAction(db, envOid, 'act-specific-003a')
      const actionOid2 = await seedAction(db, envOid, 'act-specific-003b')
      const codeVersionRepo = new CodeVersionRepository(db)

      const saved = await codeVersionRepo.saveAndActivate({
        action_oid: actionOid1,
        state: 'EXECUTING',
        source_code: VALID_PYTHON,
      })

      // Request version under wrong action_oid
      const res = await request(app).get(`/management/v1/code/${actionOid2}/EXECUTING/${saved.id}`)
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 3. Save code (MGMT-09)
// ============================================================

describe('POST /management/v1/code/:action_oid/:state (MGMT-09)', () => {
  it('returns 201 with version details', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-save-001')
      const actionOid = await seedAction(db, envOid, 'act-save-001')

      const res = await request(app)
        .post(`/management/v1/code/${actionOid}/EXECUTING`)
        .send({ source_code: VALID_PYTHON, description: 'First version', created_by: 'test' })

      expect(res.status).toBe(201)
      expect(res.body.data.id).toBeDefined()
      expect(res.body.data.version_number).toBe(1)
      expect(res.body.data.is_active).toBe(true)
      expect(res.body.data.created_at).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('new save deactivates previous active version', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-save-002')
      const actionOid = await seedAction(db, envOid, 'act-save-002')

      // Save first version
      await request(app)
        .post(`/management/v1/code/${actionOid}/EXECUTING`)
        .send({ source_code: 'def execute(inputs, outputs, props, action_props): return True' })

      // Save second version
      const res2 = await request(app)
        .post(`/management/v1/code/${actionOid}/EXECUTING`)
        .send({ source_code: VALID_PYTHON })

      expect(res2.status).toBe(201)
      expect(res2.body.data.version_number).toBe(2)

      // Active version should be the second one
      const activeRes = await request(app).get(`/management/v1/code/${actionOid}/EXECUTING/active`)
      expect(activeRes.status).toBe(200)
      expect(activeRes.body.data.version_number).toBe(2)
      expect(activeRes.body.data.source_code).toBe(VALID_PYTHON)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 400 for missing source_code', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-save-003')
      const actionOid = await seedAction(db, envOid, 'act-save-003')

      const res = await request(app)
        .post(`/management/v1/code/${actionOid}/EXECUTING`)
        .send({ description: 'No source' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown action_oid', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .post('/management/v1/code/does-not-exist/EXECUTING')
        .send({ source_code: VALID_PYTHON })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('rejects EXECUTING on an opaque action with 400 VALIDATION_ERROR', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-save-vis-001')
      const actionOid = await seedAction(db, envOid, 'act-save-vis-001', 'opaque')

      const res = await request(app)
        .post(`/management/v1/code/${actionOid}/EXECUTING`)
        .send({ source_code: VALID_PYTHON })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toContain('EXECUTING')
      expect(res.body.error.message).toContain('opaque')
      expect(res.body.error.details.action_visibility).toBe('opaque')
      // Opaque valid states include the 4 named states plus ABORTING/STOPPING
      // (reachable via ABORT/STOP commands per OPAQUE_TRANSITION_TABLE).
      expect(res.body.error.details.valid_states).toEqual(
        expect.arrayContaining(['POSTED', 'RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'ABORTING'])
      )
      expect(res.body.error.details.valid_states).not.toContain('EXECUTING')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('accepts ABORTING on an opaque action (reachable via ABORT command)', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-save-vis-aborting')
      const actionOid = await seedAction(db, envOid, 'act-save-vis-aborting', 'opaque')

      const res = await request(app)
        .post(`/management/v1/code/${actionOid}/ABORTING`)
        .send({ source_code: VALID_PYTHON })

      expect(res.status).toBe(201)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('rejects POSTED on an observable action with 400 VALIDATION_ERROR', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-save-vis-002')
      const actionOid = await seedAction(db, envOid, 'act-save-vis-002', 'observable')

      const res = await request(app)
        .post(`/management/v1/code/${actionOid}/POSTED`)
        .send({ source_code: VALID_PYTHON })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toContain('POSTED')
      expect(res.body.error.message).toContain('observable')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('accepts IN_PROGRESS on an opaque action (201)', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-save-vis-003')
      const actionOid = await seedAction(db, envOid, 'act-save-vis-003', 'opaque')

      const res = await request(app)
        .post(`/management/v1/code/${actionOid}/IN_PROGRESS`)
        .send({ source_code: VALID_PYTHON })

      expect(res.status).toBe(201)
      expect(res.body.data.version_number).toBe(1)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('rejects an unknown state with 400 listing valid states', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-save-vis-004')
      const actionOid = await seedAction(db, envOid, 'act-save-vis-004', 'observable')

      const res = await request(app)
        .post(`/management/v1/code/${actionOid}/FROBNICATING`)
        .send({ source_code: VALID_PYTHON })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toContain('FROBNICATING')
      expect(res.body.error.details.valid_states).toEqual(
        expect.arrayContaining(['EXECUTING', 'COMPLETED'])
      )
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 4. Rollback / activate (MGMT-10)
// ============================================================

describe('POST /management/v1/code/:action_oid/:state/:version_id/activate (MGMT-10)', () => {
  it('returns 200 and makes old version active again', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-rollback-001')
      const actionOid = await seedAction(db, envOid, 'act-rollback-001')
      const codeVersionRepo = new CodeVersionRepository(db)

      // Save version 1
      const v1 = await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: 'def execute(inputs, outputs, props, action_props): return True',
      })

      // Save version 2 (now active)
      await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: VALID_PYTHON,
      })

      // Rollback to v1
      const res = await request(app).post(
        `/management/v1/code/${actionOid}/EXECUTING/${v1.id}/activate`
      )
      expect(res.status).toBe(200)
      expect(res.body.data.id).toBe(v1.id)
      expect(res.body.data.is_active).toBe(true)
      expect(res.body.data.activated_at).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('after rollback, GET /active returns the rolled-back version', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-rollback-002')
      const actionOid = await seedAction(db, envOid, 'act-rollback-002')
      const codeVersionRepo = new CodeVersionRepository(db)

      const v1 = await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: 'def execute(inputs, outputs, props, action_props): return True',
      })
      await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: VALID_PYTHON,
      })

      // Rollback to v1
      await request(app).post(`/management/v1/code/${actionOid}/EXECUTING/${v1.id}/activate`)

      // Active should now be v1
      const activeRes = await request(app).get(`/management/v1/code/${actionOid}/EXECUTING/active`)
      expect(activeRes.status).toBe(200)
      expect(activeRes.body.data.id).toBe(v1.id)
      expect(activeRes.body.data.version_number).toBe(1)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown version_id', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-rollback-003')
      const actionOid = await seedAction(db, envOid, 'act-rollback-003')

      const res = await request(app).post(
        `/management/v1/code/${actionOid}/EXECUTING/does-not-exist/activate`
      )
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 5. Delete (MGMT-11)
// ============================================================

describe('DELETE /management/v1/code/:action_oid/:state/:version_id (MGMT-11)', () => {
  it('returns 200 for inactive version', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-delete-code-001')
      const actionOid = await seedAction(db, envOid, 'act-delete-code-001')
      const codeVersionRepo = new CodeVersionRepository(db)

      // Save v1 (will become inactive after v2 is saved)
      const v1 = await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: 'def execute(inputs, outputs, props, action_props): return True',
      })

      // Save v2 (now active, v1 is inactive)
      await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: VALID_PYTHON,
      })

      const res = await request(app).delete(`/management/v1/code/${actionOid}/EXECUTING/${v1.id}`)
      expect(res.status).toBe(200)
      expect(res.body.data.deleted).toBe(true)
      expect(res.body.data.id).toBe(v1.id)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 409 when trying to delete active version', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-delete-code-002')
      const actionOid = await seedAction(db, envOid, 'act-delete-code-002')
      const codeVersionRepo = new CodeVersionRepository(db)

      const active = await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: VALID_PYTHON,
      })

      const res = await request(app).delete(
        `/management/v1/code/${actionOid}/EXECUTING/${active.id}`
      )
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('CONFLICT')
      expect(res.body.error.message).toContain('active')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 409 when trying to delete version pinned by running instance', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-delete-code-003')
      const actionOid = await seedAction(db, envOid, 'act-delete-code-003')
      const codeVersionRepo = new CodeVersionRepository(db)
      const instanceRepo = new InstanceRepository(db)

      // Save v1 (inactive) and v2 (active)
      const v1 = await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: 'def execute(inputs, outputs, props, action_props): return True',
      })
      await codeVersionRepo.saveAndActivate({
        action_oid: actionOid,
        state: 'EXECUTING',
        source_code: VALID_PYTHON,
      })

      // Create a running instance that has v1 pinned
      await instanceRepo.create({
        runtime_action_instance_id: 'inst-pinned-001',
        action_oid: actionOid,
        environment_oid: envOid,
        workflow_instance_id: 'wf-pinned',
        step_instance_id: 'step-pinned',
        step_oid: 'step-oid-pinned',
        visibility: 'observable',
        state: 'EXECUTING',
        input_parameters: [],
        output_parameters: [],
        state_history: [],
        pinned_code_versions: [{ state: 'EXECUTING', code_version_id: v1.id }],
        states_with_code_executed: [],
      })

      const res = await request(app).delete(`/management/v1/code/${actionOid}/EXECUTING/${v1.id}`)
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('CONFLICT')
      expect(res.body.error.message).toContain('pinned')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown version_id', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-delete-code-004')
      const actionOid = await seedAction(db, envOid, 'act-delete-code-004')

      const res = await request(app).delete(
        `/management/v1/code/${actionOid}/EXECUTING/does-not-exist`
      )
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 5b. Clear Code (MGMT-CLEAR)
// ============================================================

describe('MGMT-CLEAR: DELETE /code/:action_oid/:state — Clear Code', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await createTestApp()
  })

  afterAll(async () => {
    await testApp.manager.shutdown()
    await testApp.db.close()
  })

  it('deletes all versions for a state and returns deleted_version_count', async () => {
    const envOid = await seedEnvironment(testApp.db, 'env-clear-1')
    const actionOid = await seedAction(testApp.db, envOid, 'act-clear-1')
    await testApp.codeVersionRepo.save({
      action_oid: actionOid,
      state: 'STARTING',
      source_code: 'a',
    })
    await testApp.codeVersionRepo.save({
      action_oid: actionOid,
      state: 'STARTING',
      source_code: 'b',
    })
    await testApp.codeVersionRepo.saveAndActivate({
      action_oid: actionOid,
      state: 'STARTING',
      source_code: 'c',
    })

    const res = await request(testApp.app)
      .delete(`/management/v1/code/${actionOid}/STARTING`)
      .expect(200)

    expect(res.body.data.deleted_version_count).toBe(3)
    expect(await testApp.codeVersionRepo.getVersionHistory(actionOid, 'STARTING')).toEqual([])
  })

  it('is idempotent on a state with no code (returns 0)', async () => {
    const envOid = await seedEnvironment(testApp.db, 'env-clear-2')
    const actionOid = await seedAction(testApp.db, envOid, 'act-clear-2')

    const res = await request(testApp.app)
      .delete(`/management/v1/code/${actionOid}/EXECUTING`)
      .expect(200)

    expect(res.body.data.deleted_version_count).toBe(0)
  })

  it('does not affect other states of the same action', async () => {
    const envOid = await seedEnvironment(testApp.db, 'env-clear-3')
    const actionOid = await seedAction(testApp.db, envOid, 'act-clear-3')
    await testApp.codeVersionRepo.saveAndActivate({
      action_oid: actionOid,
      state: 'STARTING',
      source_code: 's',
    })
    await testApp.codeVersionRepo.saveAndActivate({
      action_oid: actionOid,
      state: 'EXECUTING',
      source_code: 'e',
    })

    await request(testApp.app).delete(`/management/v1/code/${actionOid}/STARTING`).expect(200)

    expect(await testApp.codeVersionRepo.getActive(actionOid, 'STARTING')).toBeNull()
    expect((await testApp.codeVersionRepo.getActive(actionOid, 'EXECUTING'))?.source_code).toBe('e')
  })

  it('does not affect the same state on other actions', async () => {
    const envOid = await seedEnvironment(testApp.db, 'env-clear-4')
    const a1 = await seedAction(testApp.db, envOid, 'a1')
    const a2 = await seedAction(testApp.db, envOid, 'a2')
    await testApp.codeVersionRepo.saveAndActivate({
      action_oid: a1,
      state: 'STARTING',
      source_code: '1',
    })
    await testApp.codeVersionRepo.saveAndActivate({
      action_oid: a2,
      state: 'STARTING',
      source_code: '2',
    })

    await request(testApp.app).delete(`/management/v1/code/${a1}/STARTING`).expect(200)

    expect(await testApp.codeVersionRepo.getActive(a1, 'STARTING')).toBeNull()
    expect((await testApp.codeVersionRepo.getActive(a2, 'STARTING'))?.source_code).toBe('2')
  })

  it('returns 404 when action_oid does not exist', async () => {
    const res = await request(testApp.app)
      .delete('/management/v1/code/00000000-0000-0000-0000-000000000000/STARTING')
      .expect(404)

    expect(res.body.error.code).toBe('ACTION_NOT_FOUND')
  })

  it('returns 409 when a running instance has a pinned version for this state', async () => {
    const envOid = await seedEnvironment(testApp.db, 'env-clear-6')
    const actionOid = await seedAction(testApp.db, envOid, 'act-clear-6')

    // Save a code version for STARTING and activate it
    const version = await testApp.codeVersionRepo.saveAndActivate({
      action_oid: actionOid,
      state: 'STARTING',
      source_code: 'def execute(inputs, outputs, props, action_props): return True',
    })

    // Create an active instance with this version pinned
    await testApp.instanceRepo.create({
      runtime_action_instance_id: 'inst-clear-pinned-001',
      action_oid: actionOid,
      environment_oid: envOid,
      workflow_instance_id: 'wf-clear-pinned',
      step_instance_id: 'step-clear-pinned',
      step_oid: 'step-oid-clear-pinned',
      visibility: 'observable',
      state: 'STARTING',
      input_parameters: [],
      output_parameters: [],
      state_history: [],
      pinned_code_versions: [{ state: 'STARTING', code_version_id: version.id }],
      states_with_code_executed: [],
    })

    // DELETE should be blocked by the pinned-instance guard
    const res = await request(testApp.app)
      .delete(`/management/v1/code/${actionOid}/STARTING`)
      .expect(409)

    expect(res.body.error.code).toBe('CONFLICT')

    // Verify the version was NOT deleted
    const remaining = await testApp.codeVersionRepo.getVersionHistory(actionOid, 'STARTING')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).toBe(version.id)
  })
})

// ============================================================
// 6. Test / dry-run (MGMT-12)
//
// Uses a shared manager/app for all dry-run tests to avoid spawning
// many Python processes sequentially (matches instance-manager.test.ts pattern).
// ============================================================

describe('POST /management/v1/code/:action_oid/:state/test (MGMT-12)', () => {
  let sharedApp: express.Express
  let sharedManager: InstanceManager
  let sharedDb: TestDb

  beforeAll(async () => {
    const testApp = await createTestApp()
    sharedApp = testApp.app
    sharedManager = testApp.manager
    sharedDb = testApp.db
  }, 30000)

  afterAll(async () => {
    await sharedManager.shutdown()
  }, 30000)

  it('with valid Python source_code returns success: true and execution_time_ms', async () => {
    const envOid = await seedEnvironment(sharedDb, 'env-test-001')
    const actionOid = await seedAction(sharedDb, envOid, 'act-test-001')

    const res = await request(sharedApp)
      .post(`/management/v1/code/${actionOid}/EXECUTING/test`)
      .send({ source_code: VALID_PYTHON })

    expect(res.status).toBe(200)
    expect(res.body.data.success).toBe(true)
    expect(typeof res.body.data.execution_time_ms).toBe('number')
    expect(res.body.data.execution_time_ms).toBeGreaterThanOrEqual(0)
  }, 30000)

  it('with syntax error Python source returns success: false with error info', async () => {
    const envOid = await seedEnvironment(sharedDb, 'env-test-002')
    const actionOid = await seedAction(sharedDb, envOid, 'act-test-002')

    const res = await request(sharedApp)
      .post(`/management/v1/code/${actionOid}/EXECUTING/test`)
      .send({ source_code: SYNTAX_ERROR_PYTHON })

    expect(res.status).toBe(200)
    expect(res.body.data.success).toBe(false)
    expect(res.body.data.error).toBeDefined()
    expect(typeof res.body.data.execution_time_ms).toBe('number')
  }, 30000)

  it('with no source_code in body, tests active version code', async () => {
    const envOid = await seedEnvironment(sharedDb, 'env-test-003')
    const actionOid = await seedAction(sharedDb, envOid, 'act-test-003')
    const codeVersionRepo = new CodeVersionRepository(sharedDb)

    // Save an active version
    await codeVersionRepo.saveAndActivate({
      action_oid: actionOid,
      state: 'EXECUTING',
      source_code: VALID_PYTHON,
    })

    // POST with empty body — should run active version's code
    const res = await request(sharedApp)
      .post(`/management/v1/code/${actionOid}/EXECUTING/test`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.data.success).toBe(true)
    expect(typeof res.body.data.execution_time_ms).toBe('number')
  }, 30000)

  it('returns 404 when no body and no active version exists', async () => {
    const envOid = await seedEnvironment(sharedDb, 'env-test-004')
    const actionOid = await seedAction(sharedDb, envOid, 'act-test-004')

    const res = await request(sharedApp)
      .post(`/management/v1/code/${actionOid}/EXECUTING/test`)
      .send({})

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  }, 30000)

  it('with test_inputs included, passes them to Python execution', async () => {
    const envOid = await seedEnvironment(sharedDb, 'env-test-005')
    const actionOid = await seedAction(sharedDb, envOid, 'act-test-005')

    const codeWithInputs = `def execute(inputs, outputs, props, action_props):
    outputs['result'] = inputs.get('name', 'world')
    return True`

    const res = await request(sharedApp)
      .post(`/management/v1/code/${actionOid}/EXECUTING/test`)
      .send({ source_code: codeWithInputs, test_inputs: { name: 'Trajectory' } })

    expect(res.status).toBe(200)
    expect(res.body.data.success).toBe(true)
    expect(res.body.data.outputs?.result).toBe('Trajectory')
  }, 30000)
})
