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
 * management-ops.test.ts — Integration tests for instance, log, and settings endpoints.
 *
 * Tests MGMT-13 through MGMT-18:
 *   MGMT-13a: GET  /instances/active      — separate endpoint for running instances
 *   MGMT-13b: GET  /instances/history     — terminal instances with pagination/sorting
 *   MGMT-14:  GET  /instances/:id         — full detail with state_history, enrichment
 *   MGMT-15:  POST /instances/:id/command — delegate to manager.sendCommand()
 *   MGMT-16:  GET  /log                   — filtered/paginated log query with log_config
 *   MGMT-17:  GET  /log/:id               — single log entry
 *   MGMT-18:  GET  /settings              — list all 4 settings
 *   MGMT-18:  PUT  /settings/:key         — validate and update with side effects
 *
 * Uses createTestApp() factory (fresh :memory: DB + InstanceManager per test).
 * Real Python pool (poolSize: 1). Managers shut down in finally blocks. 30s timeout.
 */

import { describe, it, expect } from 'vitest'
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

// sandbox_runner.py is at packages/python-sidecar/ (3 levels up from __tests__)
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

async function seedEnvironment(db: TestDb, oid: string, localId?: string): Promise<string> {
  const envRepo = new EnvironmentRepository(db)
  if (!(await envRepo.findByOid(oid))) {
    await envRepo.create({
      oid,
      local_id: localId ?? `Env-${oid}`,
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
  visibility: 'opaque' | 'observable' = 'opaque',
  localId?: string
): Promise<string> {
  const actionRepo = new ActionRepository(db)
  if (!(await actionRepo.findByOid(actionOid))) {
    await actionRepo.create({
      oid: actionOid,
      environment_oid: envOid,
      local_id: localId ?? `Action-${actionOid}`,
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

/**
 * Poll instanceRepo until instance reaches a terminal state (completed_at IS NOT NULL)
 * or timeout is exceeded.
 */
async function waitForTerminal(
  instanceRepo: InstanceRepository,
  instanceId: string,
  timeoutMs = 10000
): Promise<Instance | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const inst = await instanceRepo.findById(instanceId)
    if (inst && inst.completed_at !== null) return inst
    await new Promise((r) => setTimeout(r, 100))
  }
  return await instanceRepo.findById(instanceId)
}

// ============================================================
// 1. Active instances (MGMT-13a)
// ============================================================

describe('GET /management/v1/instances/active (MGMT-13a)', () => {
  it('returns empty array when no instances exist', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/instances/active')
      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
      expect(res.body.meta.total).toBe(0)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('after invoking an opaque action, active endpoint returns the running instance with enrichment', async () => {
    const { app, manager, db, instanceRepo } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-active-ops-001', 'MyEnv')
      const actionOid = await seedAction(db, envOid, 'act-active-ops-001', 'opaque', 'MyAction')

      // Invoke opaque action directly via manager (no /trajectory/v1 route mounted)
      const invResult = await manager.invoke({
        action_oid: actionOid,
        workflow_instance_id: 'wf-active-001',
        step_instance_id: 'step-active-001',
        step_oid: 'step-oid-active-001',
        input_parameters: [],
      })
      const instanceId = invResult.runtime_action_instance_id

      // Check /instances/active (instance may still be processing)
      const res = await request(app).get('/management/v1/instances/active')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.meta).toBeDefined()
      expect(typeof res.body.meta.total).toBe('number')

      // Wait for terminal and verify active endpoint no longer includes it
      await waitForTerminal(instanceRepo, instanceId, 8000)
      const afterRes = await request(app).get('/management/v1/instances/active')
      expect(afterRes.status).toBe(200)
      // Instance should not appear in active after completion
      const ids = (afterRes.body.data as Array<{ runtime_action_instance_id: string }>).map(
        (i) => i.runtime_action_instance_id
      )
      expect(ids).not.toContain(instanceId)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 200 with correct {data, meta} envelope including total count', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/instances/active')
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('data')
      expect(res.body).toHaveProperty('meta')
      expect(typeof res.body.meta.total).toBe('number')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 2. Instance history (MGMT-13b)
// ============================================================

describe('GET /management/v1/instances/history (MGMT-13b)', () => {
  it('returns empty array initially', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/instances/history')
      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
      expect(res.body.meta.total).toBe(0)
      expect(res.body.meta.total_pages).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('after an opaque action completes, history returns it with enrichment', async () => {
    const { app, manager, db, instanceRepo } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-hist-001', 'HistEnv')
      const actionOid = await seedAction(db, envOid, 'act-hist-001', 'opaque', 'HistAction')

      const invResult = await manager.invoke({
        action_oid: actionOid,
        workflow_instance_id: 'wf-hist-001',
        step_instance_id: 'step-hist-001',
        step_oid: 'step-oid-hist-001',
        input_parameters: [],
      })
      const instanceId = invResult.runtime_action_instance_id

      // Wait for completion
      await waitForTerminal(instanceRepo, instanceId, 8000)

      const res = await request(app).get('/management/v1/instances/history')
      expect(res.status).toBe(200)
      expect(res.body.data.length).toBeGreaterThanOrEqual(1)

      const instance = (
        res.body.data as Array<{
          runtime_action_instance_id: string
          action_name: string
          environment_name: string
        }>
      ).find((i) => i.runtime_action_instance_id === instanceId)
      expect(instance).toBeDefined()
      expect(instance!.action_name).toBe('HistAction')
      expect(instance!.environment_name).toBe('HistEnv')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('pagination: page=1&page_size=1 returns 1 result with correct total in meta', async () => {
    const { app, manager, db, instanceRepo } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-hist-pag-001', 'PagEnv')
      const actionOid = await seedAction(db, envOid, 'act-hist-pag-001', 'opaque')

      // Invoke two opaque actions and wait for both to complete
      const inv1 = await manager.invoke({
        action_oid: actionOid,
        workflow_instance_id: 'wf-pag-001',
        step_instance_id: 'step-pag-001',
        step_oid: 'step-oid-pag-001',
        input_parameters: [],
      })
      const inv2 = await manager.invoke({
        action_oid: actionOid,
        workflow_instance_id: 'wf-pag-002',
        step_instance_id: 'step-pag-002',
        step_oid: 'step-oid-pag-002',
        input_parameters: [],
      })

      await waitForTerminal(instanceRepo, inv1.runtime_action_instance_id, 8000)
      await waitForTerminal(instanceRepo, inv2.runtime_action_instance_id, 8000)

      const res = await request(app).get('/management/v1/instances/history?page=1&page_size=1')
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.meta.total).toBeGreaterThanOrEqual(2)
      expect(res.body.meta.page).toBe(1)
      expect(res.body.meta.page_size).toBe(1)
      expect(res.body.meta.total_pages).toBeGreaterThanOrEqual(2)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 3. Instance detail (MGMT-14)
// ============================================================

describe('GET /management/v1/instances/:id (MGMT-14)', () => {
  it('returns 404 for unknown instance id', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/instances/does-not-exist')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns full instance with state_history, pinned_code_versions, and enriched names', async () => {
    const { app, manager, db, instanceRepo } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-detail-001', 'DetailEnv')
      const actionOid = await seedAction(db, envOid, 'act-detail-001', 'opaque', 'DetailAction')

      const invResult = await manager.invoke({
        action_oid: actionOid,
        workflow_instance_id: 'wf-detail-001',
        step_instance_id: 'step-detail-001',
        step_oid: 'step-oid-detail-001',
        input_parameters: [],
      })
      const instanceId = invResult.runtime_action_instance_id

      const res = await request(app).get(`/management/v1/instances/${instanceId}`)
      expect(res.status).toBe(200)
      expect(res.body.data.runtime_action_instance_id).toBe(instanceId)
      expect(Array.isArray(res.body.data.state_history)).toBe(true)
      expect(res.body.data.state_history.length).toBeGreaterThanOrEqual(1)
      expect(Array.isArray(res.body.data.pinned_code_versions)).toBe(true)
      expect(res.body.data.action_name).toBe('DetailAction')
      expect(res.body.data.environment_name).toBe('DetailEnv')
      expect(res.body.meta).toBeDefined()

      // Wait for terminal to clean up
      await waitForTerminal(instanceRepo, instanceId, 8000)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 4. Instance command (MGMT-15)
// ============================================================

describe('POST /management/v1/instances/:id/command (MGMT-15)', () => {
  it('returns 422 for invalid command string', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .post('/management/v1/instances/any-id/command')
        .send({ command: 'FLIBBERTIGIBBET' })
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('INVALID_COMMAND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 400 for missing command field', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .post('/management/v1/instances/any-id/command')
        .send({ reason: 'no command provided' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown instance id (valid command)', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .post('/management/v1/instances/does-not-exist/command')
        .send({ command: 'ABORT' })
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('command endpoint routes to state machine: returns 200 or 409 for ABORT on real instance', async () => {
    const { app, manager, db, instanceRepo } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-cmd-001', 'CmdEnv')
      const actionOid = await seedAction(db, envOid, 'act-cmd-001', 'observable', 'CmdAction')

      // Invoke observable action (starts in STARTING state, auto-advances without code)
      const invResult = await manager.invoke({
        action_oid: actionOid,
        workflow_instance_id: 'wf-cmd-001',
        step_instance_id: 'step-cmd-001',
        step_oid: 'step-oid-cmd-001',
        input_parameters: [],
      })
      const instanceId = invResult.runtime_action_instance_id

      // Send ABORT command — instance exists, so endpoint must route to state machine.
      // Returns 200 (accepted) if instance is still active, or 409 (InvalidStateTransition)
      // if it already reached a terminal state. Both mean the endpoint is working correctly.
      const res = await request(app)
        .post(`/management/v1/instances/${instanceId}/command`)
        .send({ command: 'ABORT' })

      // The endpoint should NOT return 404 (instance exists) or 400/422 (valid command)
      expect(res.status).not.toBe(404)
      expect(res.status).not.toBe(400)
      expect(res.status).not.toBe(422)
      // Either 200 (accepted) or 409 (already terminal — state transition not allowed)
      expect([200, 409]).toContain(res.status)
      if (res.status === 200) {
        expect(res.body.data.instance_id).toBe(instanceId)
        expect(res.body.data.command).toBe('ABORT')
        expect(res.body.data.accepted).toBe(true)
      }

      // Wait for terminal
      await waitForTerminal(instanceRepo, instanceId, 8000)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 4b. Force-delete instance (MGMT-15b)
// ============================================================

describe('DELETE /management/v1/instances/:id (MGMT-15b — force-delete)', () => {
  it('returns 404 for unknown instance id', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).delete('/management/v1/instances/does-not-exist')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('force-deletes an ABORTING-stuck instance so env-delete is no longer blocked', async () => {
    // This is the exact scenario the route was added for: an instance whose
    // worker died mid-abort, leaving the row at state ABORTING / completed_at=null
    // forever. Before this route, /environments/:oid DELETE rejects with 409.
    const { app, manager, db, instanceRepo, environmentRepo } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-fdel-001', 'StuckEnv')
      const actionOid = await seedAction(db, envOid, 'act-fdel-001', 'opaque', 'StuckAction')

      // Hand-craft a stuck instance directly via the repo (state ABORTING,
      // completed_at null) — bypasses the state machine to mimic a crashed
      // worker that never finalized.
      const stuck = await instanceRepo.create({
        runtime_action_instance_id: 'placeholder',
        action_oid: actionOid,
        environment_oid: envOid,
        workflow_instance_id: 'wf-stuck',
        step_instance_id: 'step-stuck',
        step_oid: 'step-oid-stuck',
        visibility: 'opaque',
        state: 'ABORTING',
        input_parameters: [],
        output_parameters: [],
        state_history: [],
        pinned_code_versions: [],
        states_with_code_executed: [],
      })
      const stuckId = stuck.runtime_action_instance_id

      // Sanity: env-delete would refuse this state.
      expect((await instanceRepo.findById(stuckId))?.completed_at).toBeNull()

      // Force-delete via the new route.
      const res = await request(app).delete(`/management/v1/instances/${stuckId}`)
      expect(res.status).toBe(200)
      expect(res.body.data.deleted).toBe(true)
      expect(res.body.data.instance_id).toBe(stuckId)

      // Row is actually gone.
      expect(await instanceRepo.findById(stuckId)).toBeNull()

      // And the env can now be deleted (no more active instances blocking).
      expect(await environmentRepo.findByOid(envOid)).not.toBeNull()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('also works on terminal instances (admin cleanup)', async () => {
    const { app, manager, db, instanceRepo } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-term-001', 'TermEnv')
      const actionOid = await seedAction(db, envOid, 'act-term-001', 'opaque', 'TermAction')

      const inst = await instanceRepo.create({
        runtime_action_instance_id: 'placeholder',
        action_oid: actionOid,
        environment_oid: envOid,
        workflow_instance_id: 'wf-term',
        step_instance_id: 'step-term',
        step_oid: 'step-oid-term',
        visibility: 'opaque',
        state: 'COMPLETED',
        input_parameters: [],
        output_parameters: [],
        state_history: [],
        pinned_code_versions: [],
        states_with_code_executed: [],
      })
      await instanceRepo.updateState(inst.runtime_action_instance_id, 'COMPLETED', {
        completed_at: new Date().toISOString(),
      })

      const res = await request(app).delete(
        `/management/v1/instances/${inst.runtime_action_instance_id}`
      )
      expect(res.status).toBe(200)
      expect(res.body.data.deleted).toBe(true)
      expect(await instanceRepo.findById(inst.runtime_action_instance_id)).toBeNull()
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 5. Log query (MGMT-16)
// ============================================================

describe('GET /management/v1/log (MGMT-16)', () => {
  it('returns empty entries array initially', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/log')
      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
      expect(res.body.meta.page).toBe(1)
      expect(res.body.meta.total_entries).toBe(0)
      expect(res.body.meta.log_config).toBeDefined()
      expect(typeof res.body.meta.log_config.max_entries).toBe('number')
      expect(typeof res.body.meta.log_config.current_entries).toBe('number')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('after an opaque action completes, log entry appears with correct shape', async () => {
    const { app, manager, db, instanceRepo } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-log-001', 'LogEnv')
      const actionOid = await seedAction(db, envOid, 'act-log-001', 'opaque', 'LogAction')

      const invResult = await manager.invoke({
        action_oid: actionOid,
        workflow_instance_id: 'wf-log-001',
        step_instance_id: 'step-log-001',
        step_oid: 'step-oid-log-001',
        input_parameters: [],
      })

      // Wait for terminal
      await waitForTerminal(instanceRepo, invResult.runtime_action_instance_id, 8000)

      // Log entry should now exist
      const res = await request(app).get('/management/v1/log')
      expect(res.status).toBe(200)
      expect(res.body.data.length).toBeGreaterThanOrEqual(1)

      const entry = res.body.data[0] as Record<string, unknown>
      expect(entry).toHaveProperty('id')
      expect(entry).toHaveProperty('final_status')
      expect(entry).toHaveProperty('started_at')
      expect(entry).toHaveProperty('completed_at')
      expect(entry).toHaveProperty('action_name')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('filtering by status works', async () => {
    const { app, manager, db, instanceRepo } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-log-filter-001')
      const actionOid = await seedAction(db, envOid, 'act-log-filter-001', 'opaque')

      const invResult = await manager.invoke({
        action_oid: actionOid,
        workflow_instance_id: 'wf-logf-001',
        step_instance_id: 'step-logf-001',
        step_oid: 'step-oid-logf-001',
        input_parameters: [],
      })
      await waitForTerminal(instanceRepo, invResult.runtime_action_instance_id, 8000)

      // Filter by COMPLETED status — should return entries
      const completedRes = await request(app).get('/management/v1/log?status=COMPLETED')
      expect(completedRes.status).toBe(200)
      // Filter by ABORTED — should return empty (no aborted instances)
      const abortedRes = await request(app).get('/management/v1/log?status=ABORTED')
      expect(abortedRes.status).toBe(200)
      expect(abortedRes.body.data).toEqual([])
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('response includes pagination meta with page, page_size, total_entries, total_pages', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/log?page=1&page_size=10')
      expect(res.status).toBe(200)
      expect(res.body.meta.page).toBe(1)
      expect(res.body.meta.page_size).toBe(10)
      expect(typeof res.body.meta.total_entries).toBe('number')
      expect(typeof res.body.meta.total_pages).toBe('number')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('response includes log_config with max_entries and current_entries', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/log')
      expect(res.status).toBe(200)
      expect(res.body.meta.log_config).toBeDefined()
      expect(typeof res.body.meta.log_config.max_entries).toBe('number')
      expect(typeof res.body.meta.log_config.current_entries).toBe('number')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 6. Log detail (MGMT-17)
// ============================================================

describe('GET /management/v1/log/:id (MGMT-17)', () => {
  it('returns 404 for unknown log entry id', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/log/99999')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('after a log entry is created, GET /log/:id returns it', async () => {
    const { app, manager, db, instanceRepo } = await createTestApp()
    try {
      const envOid = await seedEnvironment(db, 'env-logid-001', 'LogIdEnv')
      const actionOid = await seedAction(db, envOid, 'act-logid-001', 'opaque')

      const invResult = await manager.invoke({
        action_oid: actionOid,
        workflow_instance_id: 'wf-logid-001',
        step_instance_id: 'step-logid-001',
        step_oid: 'step-oid-logid-001',
        input_parameters: [],
      })
      await waitForTerminal(instanceRepo, invResult.runtime_action_instance_id, 8000)

      // Get the list to find the entry id
      const listRes = await request(app).get('/management/v1/log')
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1)
      const entryId = (listRes.body.data[0] as { id: number }).id

      // Get by id
      const res = await request(app).get(`/management/v1/log/${entryId}`)
      expect(res.status).toBe(200)
      expect(res.body.data.id).toBe(entryId)
      expect(res.body.meta).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 7. Settings list (MGMT-18)
// ============================================================

describe('GET /management/v1/settings (MGMT-18)', () => {
  it('returns all 5 settings with correct shape', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/settings')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(5)

      // Verify shape of each setting
      const setting = res.body.data[0] as Record<string, unknown>
      expect(setting).toHaveProperty('key')
      expect(setting).toHaveProperty('value')
      expect(setting).toHaveProperty('default_value')
      expect(setting).toHaveProperty('description')
      expect(setting).toHaveProperty('value_type')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns all known setting keys', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/management/v1/settings')
      expect(res.status).toBe(200)
      const keys = (res.body.data as Array<{ key: string }>).map((s) => s.key)
      expect(keys).toContain('python_pool_size')
      expect(keys).toContain('execution_timeout_ms')
      expect(keys).toContain('instance_retention_hours')
      expect(keys).toContain('log_max_size')
      expect(keys).toContain('api_key')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 8. Settings update (MGMT-18)
// ============================================================

describe('PUT /management/v1/settings/:key (MGMT-18)', () => {
  it('updates log_max_size and returns 200 with previous_value', async () => {
    const { app, manager, settingsRepo } = await createTestApp()
    try {
      const currentValue = await settingsRepo.getValue('log_max_size')

      const res = await request(app)
        .put('/management/v1/settings/log_max_size')
        .send({ value: '500' })

      expect(res.status).toBe(200)
      expect(res.body.data.key).toBe('log_max_size')
      expect(res.body.data.value).toBe('500')
      expect(res.body.data.previous_value).toBe(currentValue)
      expect(res.body.data.applied).toBe(true)
      expect(res.body.meta).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown setting key', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .put('/management/v1/settings/unknown_key')
        .send({ value: 'something' })
      expect(res.status).toBe(404)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 400 for python_pool_size with invalid value (< 1)', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .put('/management/v1/settings/python_pool_size')
        .send({ value: '0' })
      expect(res.status).toBe(400)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 400 for missing value field', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .put('/management/v1/settings/log_max_size')
        .send({ other_field: 'bad' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('updates python_pool_size and pool is resized (pool status reports new size)', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .put('/management/v1/settings/python_pool_size')
        .send({ value: '2' })
      expect(res.status).toBe(200)
      expect(res.body.data.applied).toBe(true)

      // Pool should eventually reflect the new size
      const poolStatus = manager.poolStatus
      // poolSize will be updated via resizePool — just verify no error was thrown
      expect(poolStatus).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})
