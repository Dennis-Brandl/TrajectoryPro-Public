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

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { createTestDb } from '@mission/autopilot-storage/testing'
import { InstanceManager } from '@mission/autopilot-engine'
import { SseManager } from '../sse-manager.js'
import { createManagementRouter } from '../routes/management.js'
import { errorHandler } from '../middleware/error-handler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

// Management router WITHOUT auth, so we exercise the settings handlers' own
// redaction logic in isolation.
async function createMgmtApp() {
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
  return { app, manager, settingsRepo }
}

describe('settings api_key redaction', () => {
  it('GET /settings reports api_key as blank and configured', async () => {
    const { app, manager, settingsRepo } = await createMgmtApp()
    try {
      await settingsRepo.update('api_key', 'topsecret')
      const res = await request(app).get('/management/v1/settings')
      expect(res.status).toBe(200)
      const item = (res.body.data as Array<Record<string, unknown>>).find(
        (s) => s.key === 'api_key'
      )
      expect(item).toBeDefined()
      expect(item!.value).toBe('')
      expect(item!.configured).toBe(true)
      expect(JSON.stringify(res.body)).not.toContain('topsecret')
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('reports configured=true even when the stored row is empty (the env key governs)', async () => {
    const { app, manager } = await createMgmtApp()
    try {
      const res = await request(app).get('/management/v1/settings')
      const item = (res.body.data as Array<Record<string, unknown>>).find(
        (s) => s.key === 'api_key'
      )
      expect(item!.value).toBe('')
      expect(item!.configured).toBe(true)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('PUT /settings/api_key is refused and leaves the stored row unchanged', async () => {
    const { app, manager, settingsRepo } = await createMgmtApp()
    try {
      await settingsRepo.update('api_key', 'row-before')
      const res = await request(app)
        .put('/management/v1/settings/api_key')
        .send({ value: 'brand-new-secret' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toBe(
        'The API key is set with ACTIONS_API_KEY in .env and cannot be changed here.'
      )
      expect(await settingsRepo.getValue('api_key')).toBe('row-before')
      expect(JSON.stringify(res.body)).not.toContain('brand-new-secret')
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})
