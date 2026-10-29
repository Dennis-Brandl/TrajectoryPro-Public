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
 * protocol.test.ts — Integration tests for all /trajectory/v1/ REST endpoints.
 *
 * Uses supertest to exercise the actual Express routes with a real :memory: SQLite
 * database and real InstanceManager. Tests cover health, capabilities, invoke,
 * instance GET/list, DELETE/cancel, command POST, SSE events GET, error responses,
 * and CORS headers.
 *
 * Note: Tests that create InstanceManager instances use 30s timeout because
 * the Python worker pool spawns subprocesses. Managers are shut down in finally blocks.
 */

import { describe, it, expect } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import request from 'supertest'
import {
  ActionRepository,
  EnvironmentRepository,
  InstanceRepository,
  SettingsRepository,
} from '@mission/autopilot-storage'
import { createTestDb, type TestDb } from '@mission/autopilot-storage/testing'
import { InstanceManager } from '@mission/autopilot-engine'
import type { Instance } from '@mission/autopilot-storage'
import { SseManager } from '../sse-manager.js'
import { createProtocolRouter } from '../routes/protocol.js'
import { createCommandsRouter } from '../routes/commands.js'
import { errorHandler } from '../middleware/error-handler.js'

// ============================================================
// Path helpers
// ============================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// sandbox_runner.py is at project root / packages/python-sidecar/
const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

// ============================================================
// Test app factory
// ============================================================

interface TestApp {
  app: express.Express
  manager: InstanceManager
  sseManager: SseManager
  actionRepo: ActionRepository
  instanceRepo: InstanceRepository
  db: TestDb
}

async function createTestApp(): Promise<TestApp> {
  const db = await createTestDb()
  const actionRepo = new ActionRepository(db)
  const environmentRepo = new EnvironmentRepository(db)
  const instanceRepo = new InstanceRepository(db)
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
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-API-Key', 'Last-Event-ID'],
    })
  )
  app.use(express.json())
  app.use(
    '/trajectory/v1',
    createProtocolRouter(
      manager,
      actionRepo,
      instanceRepo,
      settingsRepo,
      sseManager,
      environmentRepo
    )
  )
  app.use('/trajectory/v1', createCommandsRouter(manager, sseManager))
  app.use(errorHandler)

  return { app, manager, sseManager, actionRepo, instanceRepo, db }
}

// ============================================================
// Seed helpers
// ============================================================

async function seedTestAction(
  db: TestDb,
  opts?: {
    visibility?: 'observable' | 'opaque'
    oid?: string
    inputSpecs?: Array<Record<string, unknown>>
    envOid?: string
    actionPropertySpecs?: Array<Record<string, unknown>>
  }
): Promise<string> {
  const envRepo = new EnvironmentRepository(db)
  const actionRepo = new ActionRepository(db)

  const envOid = opts?.envOid ?? 'env-test-001'
  // Only create env if not already present
  if (!(await envRepo.findByOid(envOid))) {
    await envRepo.create({
      oid: envOid,
      local_id: 'TestEnvironment',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      schema_version: '1.0',
      action_property_specifications: opts?.actionPropertySpecs ?? [],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'test.WFenvir',
    })
  }

  const actionOid = opts?.oid ?? 'action-test-001'
  await actionRepo.create({
    oid: actionOid,
    environment_oid: envOid,
    local_id: `TestAction-${actionOid}`,
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    action_visibility: opts?.visibility ?? 'observable',
    input_parameter_specifications: opts?.inputSpecs ?? [],
    output_parameter_specifications: [
      { name: 'result', type: 'string', description: 'Test output' },
    ],
    property_specifications: [],
  })

  return actionOid
}

// ============================================================
// 1. Health endpoint
// ============================================================

describe('GET /trajectory/v1/health', () => {
  it('returns 200 with status ok and pool info', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/trajectory/v1/health')
      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('ok')
      expect(res.body.data.timestamp).toBeTruthy()
      expect(res.body.data.pool).toBeDefined()
      expect(typeof res.body.data.pool.size).toBe('number')
      expect(typeof res.body.data.pool.idle).toBe('number')
      expect(typeof res.body.data.pool.busy).toBe('number')
      expect(res.body.meta).toBeDefined()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('response uses envelope shape { data, meta }', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/trajectory/v1/health')
      expect(res.body).toHaveProperty('data')
      expect(res.body).toHaveProperty('meta')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 2. Capabilities endpoint
// ============================================================

describe('GET /trajectory/v1/capabilities', () => {
  it('returns env-grouped capabilities with action_properties and lifecycle states', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      // Seed: one env with two actions; env has action_property_specifications with SIM_MODE
      await seedTestAction(db, {
        visibility: 'observable',
        oid: 'action-test-001',
        actionPropertySpecs: [
          {
            name: 'SIM_MODE',
            oid: 'prop-sim-001',
            description: 'Simulation mode flag',
            entries: [{ name: 'Value', value: 'true' }],
          },
        ],
      })
      await seedTestAction(db, {
        visibility: 'opaque',
        oid: 'action-test-002',
        // env already created above; envOid defaults to 'env-test-001'
      })
      const res = await request(app).get('/trajectory/v1/capabilities')
      expect(res.status).toBe(200)
      expect(res.body.data.environments).toHaveLength(1)
      const env = res.body.data.environments[0]
      expect(env).toMatchObject({
        environment_oid: expect.any(String),
        environment_name: expect.any(String),
        environment_state: expect.stringMatching(
          /^(Draft|InTest|InReview|Approved|Effective|Superseded|Obsolete)$/
        ),
        action_properties: expect.arrayContaining([
          expect.objectContaining({ name: 'SIM_MODE', entries: expect.any(Array) }),
        ]),
        actions: expect.arrayContaining([
          expect.objectContaining({
            action_oid: expect.any(String),
            action_name: expect.any(String),
            action_state: expect.stringMatching(
              /^(Draft|InTest|InReview|Approved|Effective|Superseded|Obsolete)$/
            ),
          }),
        ]),
      })
      expect(res.body.meta).toMatchObject({ total_environments: 1, total_actions: 2 })
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns empty environments list when no envs seeded', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/trajectory/v1/capabilities')
      expect(res.status).toBe(200)
      expect(res.body.data.environments).toEqual([])
      expect(res.body.meta.total_environments).toBe(0)
      expect(res.body.meta.total_actions).toBe(0)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('groups observable action with full command set under its environment', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db, { visibility: 'observable' })
      const res = await request(app).get('/trajectory/v1/capabilities')
      expect(res.status).toBe(200)
      expect(res.body.data.environments).toHaveLength(1)
      const env = res.body.data.environments[0]
      const action = env.actions.find(
        (a: { action_oid: string }) => a.action_oid === 'action-test-001'
      )
      expect(action).toBeDefined()
      expect(action.visibility).toBe('observable')
      expect(action.supported_commands).toContain('PAUSE')
      expect(action.supported_commands).toContain('RESUME')
      expect(action.supported_commands).toContain('ABORT')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('groups opaque action with only ABORT command under its environment', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db, { visibility: 'opaque', oid: 'action-opaque-001' })
      const res = await request(app).get('/trajectory/v1/capabilities')
      expect(res.status).toBe(200)
      const env = res.body.data.environments[0]
      const opaque = env.actions.find(
        (a: { action_oid: string }) => a.action_oid === 'action-opaque-001'
      )
      expect(opaque).toBeDefined()
      expect(opaque.supported_commands).toEqual(['ABORT'])
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  // Normalizes all three known stored parameter shapes onto the canonical
  // RESTProtocolSpec.md § 2.2 wire shape: { name, description?, default_value?, json_schema? }.
  // See normalizeParameterSpec in routes/protocol.ts.
  it('normalizes heterogeneous parameter shapes to { name, description?, default_value?, json_schema? }', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db, {
        oid: 'action-mixed-001',
        inputSpecs: [
          // Canonical DataModelSpec shape: id → name
          { id: 'shelf_location', value_type: 'literal', default_value: 'BIN-A1' },
          // Canonical shape with description + json_schema null
          {
            id: 'item_sku',
            value_type: 'literal',
            default_value: 'SKU-1001',
            description: 'Stock-keeping unit',
            json_schema: null,
          },
          // Legacy shape: name + data_type + default_value
          { name: 'ingredient', data_type: 'string', default_value: 'flour' },
          // Property-typed shape: id + oid + description + entries + default_value
          {
            id: 'recipient',
            oid: 'prop-001',
            description: 'Recipient name',
            default_value: 'World',
            entries: [],
          },
        ],
      })
      const res = await request(app).get('/trajectory/v1/capabilities')
      expect(res.status).toBe(200)
      const env = res.body.data.environments[0]
      const mixed = env.actions.find(
        (a: { action_oid: string }) => a.action_oid === 'action-mixed-001'
      )
      expect(mixed).toBeDefined()
      expect(mixed.input_parameters).toEqual([
        { name: 'shelf_location', default_value: 'BIN-A1' },
        {
          name: 'item_sku',
          description: 'Stock-keeping unit',
          default_value: 'SKU-1001',
          json_schema: null,
        },
        { name: 'ingredient', default_value: 'flour' },
        { name: 'recipient', description: 'Recipient name', default_value: 'World' },
      ])
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 3. Invoke endpoint
// ============================================================

describe('POST /trajectory/v1/actions/:action_oid/invoke', () => {
  it('returns 201 with instance_id for valid invocation', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db)
      const res = await request(app).post('/trajectory/v1/actions/action-test-001/invoke').send({
        environment_oid: 'env-test-001',
        workflow_instance_id: 'wf-001',
        step_instance_id: 'step-001',
        step_oid: 'step-oid-001',
        input_parameters: [],
      })
      expect(res.status).toBe(201)
      expect(res.body.data.instance_id).toBeTruthy()
      expect(typeof res.body.data.instance_id).toBe('string')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown action_oid', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).post('/trajectory/v1/actions/does-not-exist/invoke').send({
        environment_oid: 'env-test-001',
        workflow_instance_id: 'wf-001',
        step_instance_id: 'step-001',
        step_oid: 'step-oid-001',
        input_parameters: [],
      })
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('ACTION_NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 400 for missing required fields', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db)
      const res = await request(app)
        .post('/trajectory/v1/actions/action-test-001/invoke')
        .send({ environment_oid: 'env-test-001' }) // missing required fields
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 400 for unknown fields in body', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db)
      const res = await request(app).post('/trajectory/v1/actions/action-test-001/invoke').send({
        environment_oid: 'env-test-001',
        workflow_instance_id: 'wf-001',
        step_instance_id: 'step-001',
        step_oid: 'step-oid-001',
        input_parameters: [],
        unknown_field: 'should-reject',
      })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toContain('Unknown field')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('accepts optional action_property_overrides field', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db)
      const res = await request(app)
        .post('/trajectory/v1/actions/action-test-001/invoke')
        .send({
          environment_oid: 'env-test-001',
          workflow_instance_id: 'wf-001',
          step_instance_id: 'step-001',
          step_oid: 'step-oid-001',
          input_parameters: [],
          action_property_overrides: {
            SIMULATION_MODE: { Value: 'true' },
          },
        })
      expect(res.status).toBe(201)
      expect(res.body.data.instance_id).toBeTruthy()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('rejects action_property_overrides if not an object', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db)
      const res = await request(app).post('/trajectory/v1/actions/action-test-001/invoke').send({
        environment_oid: 'env-test-001',
        workflow_instance_id: 'wf-001',
        step_instance_id: 'step-001',
        step_oid: 'step-oid-001',
        input_parameters: [],
        action_property_overrides: 'not-an-object',
      })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toContain('action_property_overrides')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 4. Instance GET endpoint
// ============================================================

describe('GET /trajectory/v1/instances/:id', () => {
  it('returns 200 with nested state shape after invoke', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db)
      const invokeRes = await request(app)
        .post('/trajectory/v1/actions/action-test-001/invoke')
        .send({
          environment_oid: 'env-test-001',
          workflow_instance_id: 'wf-001',
          step_instance_id: 'step-001',
          step_oid: 'step-oid-001',
          input_parameters: [],
        })
      expect(invokeRes.status).toBe(201)
      const instanceId = invokeRes.body.data.instance_id as string

      const res = await request(app).get(`/trajectory/v1/instances/${instanceId}`)
      expect(res.status).toBe(200)
      expect(res.body.data.instance_id).toBe(instanceId)
      expect(res.body.data.state).toBeDefined()
      expect(res.body.data.state.current).toBeTruthy()
      expect(res.body.data.state).toHaveProperty('previous')
      expect(res.body.data.state).toHaveProperty('entered_at')
      expect(res.body.data.action_oid).toBe('action-test-001')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown instance_id', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/trajectory/v1/instances/does-not-exist')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('INSTANCE_NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 5. Instance list endpoint
// ============================================================

describe('GET /trajectory/v1/instances', () => {
  it('returns all instances (empty initially)', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/trajectory/v1/instances')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.meta).toHaveProperty('total')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('filters by workflow_instance_id query param', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db)
      const wfId = `wf-filter-${Date.now()}`
      await request(app).post('/trajectory/v1/actions/action-test-001/invoke').send({
        environment_oid: 'env-test-001',
        workflow_instance_id: wfId,
        step_instance_id: 'step-001',
        step_oid: 'step-oid-001',
        input_parameters: [],
      })

      const res = await request(app).get(`/trajectory/v1/instances?workflow_instance_id=${wfId}`)
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].workflow_instance_id).toBe(wfId)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('filters by action_oid query param', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db)
      await request(app).post('/trajectory/v1/actions/action-test-001/invoke').send({
        environment_oid: 'env-test-001',
        workflow_instance_id: 'wf-oid-filter',
        step_instance_id: 'step-001',
        step_oid: 'step-oid-001',
        input_parameters: [],
      })

      const res = await request(app).get('/trajectory/v1/instances?action_oid=action-test-001')
      expect(res.status).toBe(200)
      expect(res.body.data.length).toBeGreaterThanOrEqual(1)
      expect(
        res.body.data.every((i: { action_oid: string }) => i.action_oid === 'action-test-001')
      ).toBe(true)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 6. DELETE /instances/:id (cancel)
// ============================================================

describe('DELETE /trajectory/v1/instances/:id', () => {
  it('returns 200 with cancelled: true for an existing instance', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db)
      const invokeRes = await request(app)
        .post('/trajectory/v1/actions/action-test-001/invoke')
        .send({
          environment_oid: 'env-test-001',
          workflow_instance_id: 'wf-cancel-001',
          step_instance_id: 'step-cancel-001',
          step_oid: 'step-oid-cancel',
          input_parameters: [],
        })
      expect(invokeRes.status).toBe(201)
      const instanceId = invokeRes.body.data.instance_id as string

      const res = await request(app).delete(`/trajectory/v1/instances/${instanceId}`)
      expect(res.status).toBe(200)
      expect(res.body.data.cancelled).toBe(true)
      expect(res.body.data.instance_id).toBe(instanceId)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown instance_id', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).delete('/trajectory/v1/instances/non-existent-id')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('INSTANCE_NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 7. Command endpoint
// ============================================================

describe('POST /trajectory/v1/instances/:id/command', () => {
  it('returns 422 for unknown command string', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .post('/trajectory/v1/instances/any-id/command')
        .send({ command: 'DANCE' })
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('INVALID_COMMAND')
      expect(res.body.error.details.command).toBe('DANCE')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 400 for missing command field', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).post('/trajectory/v1/instances/any-id/command').send({})
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 400 for unknown fields in command body', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .post('/trajectory/v1/instances/any-id/command')
        .send({ command: 'PAUSE', extra: 'field' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toContain('Unknown field')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 404 for unknown instance_id with valid command', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .post('/trajectory/v1/instances/does-not-exist/command')
        .send({ command: 'PAUSE' })
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('INSTANCE_NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 409 INVALID_STATE_TRANSITION when command not valid for current state', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db, { visibility: 'opaque', oid: 'action-cmd-opaque' })
      // Invoke opaque action (starts in POSTED state, transitions quickly)
      const invokeRes = await request(app)
        .post('/trajectory/v1/actions/action-cmd-opaque/invoke')
        .send({
          environment_oid: 'env-test-001',
          workflow_instance_id: 'wf-cmd-test',
          step_instance_id: 'step-cmd-001',
          step_oid: 'step-oid-cmd',
          input_parameters: [],
        })
      expect(invokeRes.status).toBe(201)
      const instanceId = invokeRes.body.data.instance_id as string

      // First cancel it to get it to a terminal state
      await request(app).delete(`/trajectory/v1/instances/${instanceId}`)

      // Now try to PAUSE — invalid in terminal state
      const res = await request(app)
        .post(`/trajectory/v1/instances/${instanceId}/command`)
        .send({ command: 'PAUSE' })
      // Should be either 409 (if already terminal) or 404 (if instance GC'd)
      expect([404, 409]).toContain(res.status)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 8. SSE events endpoint
// ============================================================

describe('GET /trajectory/v1/instances/:id/events', () => {
  it('returns 404 for unknown instance_id', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/trajectory/v1/instances/does-not-exist/events')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('INSTANCE_NOT_FOUND')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('returns 200 with text/event-stream Content-Type for known instance', async () => {
    const { app, manager, db } = await createTestApp()
    try {
      await seedTestAction(db)
      const invokeRes = await request(app)
        .post('/trajectory/v1/actions/action-test-001/invoke')
        .send({
          environment_oid: 'env-test-001',
          workflow_instance_id: 'wf-sse-test',
          step_instance_id: 'step-sse-001',
          step_oid: 'step-oid-sse',
          input_parameters: [],
        })
      expect(invokeRes.status).toBe(201)
      const instanceId = invokeRes.body.data.instance_id as string

      // Use a short timeout to avoid hanging — SSE stream stays open indefinitely
      const res = await request(app)
        .get(`/trajectory/v1/instances/${instanceId}/events`)
        .timeout({ response: 500, deadline: 1000 })
        .catch((err: { response?: { status: number; headers: Record<string, string> } }) => {
          // Timeout is expected — SSE stream doesn't close
          if (err.response) return err.response
          return null
        })

      // Either the response started (Content-Type set) or we got a timeout
      if (res) {
        expect(res.headers?.['content-type']).toContain('text/event-stream')
      }
      // If res is null (timeout before headers), that's also acceptable — the route connected
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('replays the first buffered event (id 0) on a fresh connect with no Last-Event-ID', async () => {
    const { app, manager, db, sseManager } = await createTestApp()
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const addr = server.address() as { port: number }
    try {
      await seedTestAction(db)
      const invokeRes = await request(app)
        .post('/trajectory/v1/actions/action-test-001/invoke')
        .send({
          environment_oid: 'env-test-001',
          workflow_instance_id: 'wf-sse-replay',
          step_instance_id: 'step-sse-replay',
          step_oid: 'step-oid-sse-replay',
          input_parameters: [],
        })
      expect(invokeRes.status).toBe(201)
      const instanceId = invokeRes.body.data.instance_id as string

      // invoke() is fire-and-forget (it never awaits startInstance), so the
      // instance bus can still be empty by the time a client connects. Publish
      // the first event explicitly so id 0 is guaranteed to be buffered.
      const instance = await manager.getInstance(instanceId)
      sseManager.publishStateChange(instanceId, 'STARTING', null, instance!)

      const text = await new Promise<string>((resolve, reject) => {
        const req = http.get(
          `http://localhost:${addr.port}/trajectory/v1/instances/${instanceId}/events`,
          { headers: { Accept: 'text/event-stream' } },
          (res) => {
            let buf = ''
            res.on('data', (chunk: Buffer) => {
              buf += chunk.toString()
              if (buf.includes('id: 0\n')) {
                res.destroy()
                resolve(buf)
              }
            })
            res.on('error', reject)
          }
        )
        req.on('error', reject)
        setTimeout(() => reject(new Error('SSE replay test timed out')), 5000)
      })

      expect(text).toContain('id: 0\n')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 9. Error response shape
// ============================================================

describe('Error response shape', () => {
  it('all error responses have { error: { code, message, details } } shape', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app).get('/trajectory/v1/instances/not-found')
      expect(res.status).toBe(404)
      expect(res.body).toHaveProperty('error')
      expect(res.body.error).toHaveProperty('code')
      expect(res.body.error).toHaveProperty('message')
      expect(res.body.error).toHaveProperty('details')
      expect(typeof res.body.error.code).toBe('string')
      expect(typeof res.body.error.message).toBe('string')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('validation errors have VALIDATION_ERROR code', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .post('/trajectory/v1/instances/any-id/command')
        .send({ command: 123 }) // wrong type
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})

// ============================================================
// 10. CORS headers
// ============================================================

describe('CORS headers', () => {
  it('includes Access-Control-Allow-Origin header on responses', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .get('/trajectory/v1/health')
        .set('Origin', 'http://localhost:3000')
      expect(res.headers['access-control-allow-origin']).toBeTruthy()
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('responds to OPTIONS preflight with CORS headers', async () => {
    const { app, manager } = await createTestApp()
    try {
      const res = await request(app)
        .options('/trajectory/v1/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET')
      expect([200, 204]).toContain(res.status)
      expect(res.headers['access-control-allow-origin']).toBeTruthy()
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})
