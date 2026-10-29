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
 * management-properties.test.ts — Action Property value editing from the console.
 *
 *   PUT /management/v1/environments/:oid/properties — environment-level set
 *       (the `props` argument state code reads and set_property() writes;
 *        routed through InstanceManager.setPropertyValues so console saves
 *        serialize with runtime writes and publish the REST-12 SSE event)
 *   PUT /management/v1/actions/:oid/properties      — one action's own set
 *       (the read-only `action_props` argument; plain repository update)
 *
 * Both take `{ edits: [{ property, entry, value }] }`, change ONLY the value of
 * existing entries, preserve every other field on the spec, and reject the
 * whole batch (writing nothing) when anything is unknown.
 *
 * Uses a real PGlite database; poolSize 0 because no action code runs here.
 */

import { describe, it, expect } from 'vitest'
import express from 'express'
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
import { SseManager, type SseEvent } from '../sse-manager.js'
import { createManagementRouter } from '../routes/management.js'
import { errorHandler } from '../middleware/error-handler.js'

// ============================================================
// Test app factory
// ============================================================

interface TestApp {
  app: express.Express
  manager: InstanceManager
  db: TestDb
  environmentRepo: EnvironmentRepository
  actionRepo: ActionRepository
  sseManager: SseManager
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
    scriptPath: 'unused-no-code-runs-in-this-suite',
    poolSize: 0,
    sseManager,
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

  return { app, manager, db, environmentRepo, actionRepo, sseManager }
}

async function teardown(t: TestApp): Promise<void> {
  await t.manager.shutdown()
  t.sseManager.shutdown()
  await t.db.close()
}

// ============================================================
// Seeding
// ============================================================

const ENV_SPECS = [
  {
    name: 'Config',
    oid: 'prop-config',
    description: 'Connection settings',
    entries: [
      { name: 'Host', value: 'localhost', oid: 'entry-host' },
      { name: 'Port', value: '8080', oid: 'entry-port' },
    ],
  },
  { name: 'Flags', entries: [{ name: 'Debug', value: 'false' }] },
]

const ACTION_SPECS = [
  {
    name: 'Setting',
    oid: 'prop-setting',
    entries: [
      { name: 'Value', value: 'old', oid: 'entry-value' },
      { name: 'Unit', value: 'kg' },
    ],
  },
]

async function seed(t: TestApp): Promise<{ envOid: string; actionOid: string }> {
  const envOid = `env-${Date.now()}`
  const actionOid = `act-${Date.now()}`
  await t.environmentRepo.create({
    oid: envOid,
    local_id: 'PropsEnv',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    schema_version: '1',
    action_property_specifications: structuredClone(ENV_SPECS),
    value_property_specifications: [],
    resource_property_specifications: [],
    source_filename: 'props.json',
  })
  await t.actionRepo.create({
    oid: actionOid,
    environment_oid: envOid,
    local_id: 'PropsAction',
    version: '1.0',
    last_modified_date: new Date().toISOString(),
    action_visibility: 'observable',
    input_parameter_specifications: [],
    output_parameter_specifications: [],
    property_specifications: structuredClone(ACTION_SPECS),
  })
  return { envOid, actionOid }
}

// ============================================================
// Environment-level properties
// ============================================================

describe('PUT /management/v1/environments/:oid/properties', () => {
  it('changes only the named values, preserves other fields, and returns the result', async () => {
    const t = await createTestApp()
    try {
      const { envOid } = await seed(t)
      const res = await request(t.app)
        .put(`/management/v1/environments/${envOid}/properties`)
        .send({
          edits: [
            { property: 'Config', entry: 'Host', value: '10.0.0.5' },
            { property: 'Flags', entry: 'Debug', value: 'true' },
          ],
        })

      expect(res.status).toBe(200)
      const expected = [
        {
          name: 'Config',
          oid: 'prop-config',
          description: 'Connection settings',
          entries: [
            { name: 'Host', value: '10.0.0.5', oid: 'entry-host' },
            { name: 'Port', value: '8080', oid: 'entry-port' },
          ],
        },
        { name: 'Flags', entries: [{ name: 'Debug', value: 'true' }] },
      ]
      expect(res.body.data).toEqual({
        oid: envOid,
        action_property_specifications: expected,
      })

      const stored = (await t.environmentRepo.findByOid(envOid))!
      expect(stored.action_property_specifications).toEqual(expected)
    } finally {
      await teardown(t)
    }
  })

  it('publishes a REST-12 property event with source "console"', async () => {
    const t = await createTestApp()
    try {
      const { envOid } = await seed(t)
      const received: SseEvent[] = []
      const unsub = t.sseManager.subscribeProperty(envOid, 'Config', (ev) => received.push(ev))

      const res = await request(t.app)
        .put(`/management/v1/environments/${envOid}/properties`)
        .send({ edits: [{ property: 'Config', entry: 'Port', value: '9090' }] })
      expect(res.status).toBe(200)

      expect(received).toHaveLength(1)
      expect(received[0]!.type).toBe('property')
      expect(received[0]!.data).toMatchObject({
        environment_oid: envOid,
        property_name: 'Config',
        changed_entries: ['Port'],
        source: 'console',
      })
      unsub()
    } finally {
      await teardown(t)
    }
  })

  it('returns 404 NOT_FOUND for an unknown environment', async () => {
    const t = await createTestApp()
    try {
      const res = await request(t.app)
        .put('/management/v1/environments/nope/properties')
        .send({ edits: [{ property: 'Config', entry: 'Host', value: 'x' }] })
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await teardown(t)
    }
  })

  it('returns 404 PROPERTY_NOT_FOUND and writes nothing for an unknown property', async () => {
    const t = await createTestApp()
    try {
      const { envOid } = await seed(t)
      const res = await request(t.app)
        .put(`/management/v1/environments/${envOid}/properties`)
        .send({
          edits: [
            { property: 'Config', entry: 'Host', value: 'changed' },
            { property: 'Missing', entry: 'X', value: '1' },
          ],
        })
      expect(res.status).toBe(404)
      expect(res.body.error).toMatchObject({
        code: 'PROPERTY_NOT_FOUND',
        details: { property: 'Missing' },
      })

      const stored = (await t.environmentRepo.findByOid(envOid))!
      expect(stored.action_property_specifications).toEqual(ENV_SPECS)
    } finally {
      await teardown(t)
    }
  })

  it('returns 400 ENTRY_NOT_FOUND and writes nothing for an unknown entry', async () => {
    const t = await createTestApp()
    try {
      const { envOid } = await seed(t)
      const res = await request(t.app)
        .put(`/management/v1/environments/${envOid}/properties`)
        .send({ edits: [{ property: 'Config', entry: 'Nope', value: '1' }] })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatchObject({
        code: 'ENTRY_NOT_FOUND',
        details: { property: 'Config', entry: 'Nope' },
      })

      const stored = (await t.environmentRepo.findByOid(envOid))!
      expect(stored.action_property_specifications).toEqual(ENV_SPECS)
    } finally {
      await teardown(t)
    }
  })

  it('returns 400 VALIDATION_ERROR for a malformed body', async () => {
    const t = await createTestApp()
    try {
      const { envOid } = await seed(t)
      const url = `/management/v1/environments/${envOid}/properties`
      const bad = [
        {}, // missing edits
        { edits: [] }, // nothing to do
        { edits: 'x' }, // not an array
        { edits: [{ property: 'Config', entry: 'Host', value: 5 }] }, // non-string value
        { edits: [{ property: 'Config', entry: 'Host' }] }, // missing value
        { edits: [{ property: 'Config', entry: 'Host', value: 'x' }], extra: 1 }, // unknown field
      ]
      for (const body of bad) {
        const res = await request(t.app).put(url).send(body)
        expect(res.status, JSON.stringify(body)).toBe(400)
        expect(res.body.error.code, JSON.stringify(body)).toBe('VALIDATION_ERROR')
      }
      const stored = (await t.environmentRepo.findByOid(envOid))!
      expect(stored.action_property_specifications).toEqual(ENV_SPECS)
    } finally {
      await teardown(t)
    }
  })
})

// ============================================================
// Per-action properties
// ============================================================

describe('PUT /management/v1/actions/:oid/properties', () => {
  it('changes only the named values, preserves other fields, and returns the result', async () => {
    const t = await createTestApp()
    try {
      const { actionOid } = await seed(t)
      const res = await request(t.app)
        .put(`/management/v1/actions/${actionOid}/properties`)
        .send({ edits: [{ property: 'Setting', entry: 'Value', value: 'new' }] })

      expect(res.status).toBe(200)
      const expected = [
        {
          name: 'Setting',
          oid: 'prop-setting',
          entries: [
            { name: 'Value', value: 'new', oid: 'entry-value' },
            { name: 'Unit', value: 'kg' },
          ],
        },
      ]
      expect(res.body.data).toEqual({ oid: actionOid, property_specifications: expected })

      const stored = (await t.actionRepo.findByOid(actionOid))!
      expect(stored.property_specifications).toEqual(expected)
    } finally {
      await teardown(t)
    }
  })

  it('returns 404 NOT_FOUND for an unknown action', async () => {
    const t = await createTestApp()
    try {
      const res = await request(t.app)
        .put('/management/v1/actions/nope/properties')
        .send({ edits: [{ property: 'Setting', entry: 'Value', value: 'x' }] })
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    } finally {
      await teardown(t)
    }
  })

  it('returns 404 PROPERTY_NOT_FOUND and writes nothing for an unknown property', async () => {
    const t = await createTestApp()
    try {
      const { actionOid } = await seed(t)
      const res = await request(t.app)
        .put(`/management/v1/actions/${actionOid}/properties`)
        .send({
          edits: [
            { property: 'Setting', entry: 'Value', value: 'changed' },
            { property: 'Missing', entry: 'X', value: '1' },
          ],
        })
      expect(res.status).toBe(404)
      expect(res.body.error).toMatchObject({
        code: 'PROPERTY_NOT_FOUND',
        details: { property: 'Missing' },
      })
      const stored = (await t.actionRepo.findByOid(actionOid))!
      expect(stored.property_specifications).toEqual(ACTION_SPECS)
    } finally {
      await teardown(t)
    }
  })

  it('returns 400 ENTRY_NOT_FOUND and writes nothing for an unknown entry', async () => {
    const t = await createTestApp()
    try {
      const { actionOid } = await seed(t)
      const res = await request(t.app)
        .put(`/management/v1/actions/${actionOid}/properties`)
        .send({ edits: [{ property: 'Setting', entry: 'Nope', value: '1' }] })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatchObject({
        code: 'ENTRY_NOT_FOUND',
        details: { property: 'Setting', entry: 'Nope' },
      })
      const stored = (await t.actionRepo.findByOid(actionOid))!
      expect(stored.property_specifications).toEqual(ACTION_SPECS)
    } finally {
      await teardown(t)
    }
  })

  it('returns 400 VALIDATION_ERROR for a malformed body', async () => {
    const t = await createTestApp()
    try {
      const { actionOid } = await seed(t)
      const res = await request(t.app)
        .put(`/management/v1/actions/${actionOid}/properties`)
        .send({ edits: [{ property: 'Setting', entry: 'Value', value: 5 }] })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    } finally {
      await teardown(t)
    }
  })
})
