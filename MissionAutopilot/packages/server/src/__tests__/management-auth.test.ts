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
import { createTestDb } from '@mission/autopilot-storage/testing'
import { InstanceManager } from '@mission/autopilot-engine'
import { SseManager } from '../sse-manager.js'
import { createManagementRouter } from '../routes/management.js'
import { createApiKeyAuth } from '../middleware/auth.js'
import { errorHandler } from '../middleware/error-handler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.resolve(__dirname, '../../../../python-sidecar/sandbox_runner.py')

// Mirrors the production wiring in index.ts: createApiKeyAuth in front of the
// management router. The key is always required (it comes from ACTIONS_API_KEY).
const KEY = 'test-key-0123456789abcdef0123456789abcdef'

async function createAuthedApp() {
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
  app.use(cors({ origin: '*' }))
  app.use(express.json())
  app.use('/management/v1', createApiKeyAuth(KEY))
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
  return { app, manager }
}

describe('/management/v1 authentication', () => {
  it('rejects a management request without the key (401)', async () => {
    const { app, manager } = await createAuthedApp()
    try {
      const res = await request(app).get('/management/v1/dashboard')
      expect(res.status).toBe(401)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('rejects the code/test arbitrary-code-execution endpoint without the key (401)', async () => {
    const { app, manager } = await createAuthedApp()
    try {
      const res = await request(app)
        .post('/management/v1/code/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/EXECUTING/test')
        .send({ source_code: "import os; os.system('id')" })
      expect(res.status).toBe(401)
    } finally {
      await manager.shutdown()
    }
  }, 30000)

  it('allows a management request with the correct key (200)', async () => {
    const { app, manager } = await createAuthedApp()
    try {
      const res = await request(app).get('/management/v1/dashboard').set('X-API-Key', KEY)
      expect(res.status).toBe(200)
    } finally {
      await manager.shutdown()
    }
  }, 30000)
})
