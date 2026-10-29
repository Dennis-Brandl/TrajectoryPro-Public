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
 * properties.test.ts — Integration tests for GET /trajectory/v1/properties
 * and GET /trajectory/v1/properties/:id endpoints.
 *
 * Uses supertest with a real :memory: SQLite database. Seeds two environments
 * each carrying a SIM_MODE action_property_specification so the AMBIGUOUS_PROPERTY
 * 409 path can be exercised.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
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

const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

// ============================================================
// Test app factory
// ============================================================

interface TestHarness {
  app: express.Express
  manager: InstanceManager
  environmentRepo: EnvironmentRepository
  sseManager: SseManager
  db: TestDb
}

async function createHarness(): Promise<TestHarness> {
  const db = await createTestDb()
  const actionRepo = new ActionRepository(db)
  const instanceRepo = new InstanceRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const environmentRepo = new EnvironmentRepository(db)
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

  return { app, manager, environmentRepo, sseManager, db }
}

// ============================================================
// Seed helpers
// ============================================================

/**
 * Seeds two environments:
 *   env-1: has SIM_MODE + SPEED property specs
 *   env-2: has SIM_MODE property spec (same name → triggers AMBIGUOUS_PROPERTY)
 */
async function seedTwoEnvs(environmentRepo: EnvironmentRepository): Promise<void> {
  await environmentRepo.create({
    oid: 'env-1',
    local_id: 'Env1',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    schema_version: '4.0',
    action_property_specifications: [
      {
        name: 'SIM_MODE',
        oid: 'prop-sim-env1',
        description: 'Simulation mode toggle',
        entries: [{ name: 'Value', value: 'false' }],
      },
      {
        name: 'SPEED',
        oid: 'prop-speed-env1',
        description: 'Speed setting',
        entries: [{ name: 'Value', value: '100' }],
      },
    ],
    value_property_specifications: [],
    resource_property_specifications: [],
    source_filename: 'env1.WFenvir',
  })

  await environmentRepo.create({
    oid: 'env-2',
    local_id: 'Env2',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    schema_version: '4.0',
    action_property_specifications: [
      {
        name: 'SIM_MODE',
        oid: 'prop-sim-env2',
        description: 'Simulation mode toggle (env2)',
        entries: [{ name: 'Value', value: 'true' }],
      },
    ],
    value_property_specifications: [],
    resource_property_specifications: [],
    source_filename: 'env2.WFenvir',
  })
}

// ============================================================
// Tests
// ============================================================

describe('GET /trajectory/v1/properties and /trajectory/v1/properties/:id', () => {
  let harness: TestHarness

  beforeEach(async () => {
    harness = await createHarness()
    await seedTwoEnvs(harness.environmentRepo)
  })

  afterEach(async () => {
    await harness.manager.shutdown()
    await harness.db.close()
  })

  it('returns properties grouped by environment', async () => {
    const res = await request(harness.app).get('/trajectory/v1/properties')
    expect(res.status).toBe(200)
    expect(res.body.data.environments).toHaveLength(2)

    const env1 = res.body.data.environments.find(
      (e: { environment_oid: string }) => e.environment_oid === 'env-1'
    )
    expect(env1).toBeDefined()
    expect(env1.environment_name).toBe('Env1')
    expect(env1.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'SIM_MODE', entries: expect.any(Array) }),
        expect.objectContaining({ name: 'SPEED', entries: expect.any(Array) }),
      ])
    )

    const env2 = res.body.data.environments.find(
      (e: { environment_oid: string }) => e.environment_oid === 'env-2'
    )
    expect(env2).toBeDefined()
    expect(env2.environment_name).toBe('Env2')
    expect(env2.properties).toHaveLength(1)
    expect(env2.properties[0].name).toBe('SIM_MODE')

    // meta: split into total_environments and total_properties (2 + 1 = 3 properties across 2 envs)
    expect(res.body.meta.total_environments).toBe(2)
    expect(res.body.meta.total_properties).toBe(3)
  }, 30000)

  it('returns a single property by outer name with ?environment_oid filter', async () => {
    const res = await request(harness.app).get(
      '/trajectory/v1/properties/SIM_MODE?environment_oid=env-1'
    )
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      environment_oid: 'env-1',
      environment_name: 'Env1',
      name: 'SIM_MODE',
      entries: expect.any(Array),
    })
    expect(res.body.meta).toBeDefined()
  }, 30000)

  it('returns 404 PROPERTY_NOT_FOUND when :id does not match any env', async () => {
    const res = await request(harness.app).get('/trajectory/v1/properties/NOT_REAL')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('PROPERTY_NOT_FOUND')
    expect(res.body.error).toHaveProperty('message')
    expect(res.body.error).toHaveProperty('details')
  }, 30000)

  it('returns 409 AMBIGUOUS_PROPERTY when :id matches more than one env', async () => {
    // SIM_MODE exists in both env-1 and env-2 — no filter → ambiguous
    const res = await request(harness.app).get('/trajectory/v1/properties/SIM_MODE')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('AMBIGUOUS_PROPERTY')
    expect(res.body.error.details.environment_oids).toEqual(
      expect.arrayContaining(['env-1', 'env-2'])
    )
  }, 30000)

  it('streams property events via SSE', async () => {
    const { app, sseManager } = harness

    // supertest doesn't support streaming — spin up a real server
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const addr = server.address() as { port: number }

    try {
      const text = await new Promise<string>((resolve, reject) => {
        const req = http.get(
          `http://localhost:${addr.port}/trajectory/v1/properties/SIM_MODE/events?environment_oid=env-1`,
          { headers: { Accept: 'text/event-stream' } },
          (res) => {
            let buf = ''
            res.on('data', (chunk: Buffer) => {
              buf += chunk.toString()
              if (buf.includes('event: property')) {
                res.destroy()
                resolve(buf)
              }
            })
            res.on('error', reject)
            // Once we have a live connection, publish a property event
            setTimeout(() => {
              sseManager.publishProperty('env-1', 'SIM_MODE', {
                entries: [{ name: 'Mode', value: 'fast' }],
                changed_entries: ['Mode'],
                source: 'action_code',
              })
            }, 50)
          }
        )
        req.on('error', reject)
        setTimeout(() => reject(new Error('SSE test timed out')), 5000)
      })

      expect(text).toContain('event: property')
      expect(text).toContain('"property_name":"SIM_MODE"')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 30000)

  it("destroying an environment's property buses ends an open stream", async () => {
    const { app, sseManager } = harness
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const addr = server.address() as { port: number }
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          `http://localhost:${addr.port}/trajectory/v1/properties/SIM_MODE/events?environment_oid=env-1`,
          { headers: { Accept: 'text/event-stream' } },
          (res) => {
            res.on('data', () => undefined)
            res.on('end', () => resolve())
            res.on('error', reject)
            setTimeout(() => sseManager.destroyPropertyBuses('env-1'), 50)
          }
        )
        req.on('error', reject)
        setTimeout(() => reject(new Error('stream was not ended by teardown')), 5000)
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 30000)
})
