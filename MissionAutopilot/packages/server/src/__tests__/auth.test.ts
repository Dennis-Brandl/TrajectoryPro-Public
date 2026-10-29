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
import express from 'express'
import request from 'supertest'
import { createApiKeyAuth } from '../middleware/auth.js'

const KEY = 'test-key-0123456789abcdef0123456789abcdef'

function appWith(key: string) {
  const app = express()
  const v1 = express.Router()
  v1.get('/ping', (_req, res) => void res.json({ ok: true }))
  v1.get('/instances/:id/events', (_req, res) => void res.json({ ok: true }))
  v1.get('/properties/:id/events', (_req, res) => void res.json({ ok: true }))
  app.use('/trajectory/v1', createApiKeyAuth(key), v1)
  return app
}

describe('createApiKeyAuth', () => {
  const app = appWith(KEY)

  it('rejects when no credential is sent', async () => {
    const res = await request(app).get('/trajectory/v1/ping')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('rejects a wrong key', async () => {
    const res = await request(app).get('/trajectory/v1/ping').set('X-API-Key', 'nope')
    expect(res.status).toBe(401)
  })

  it('rejects a key of a different length without throwing', async () => {
    const res = await request(app)
      .get('/trajectory/v1/ping')
      .set('X-API-Key', KEY + 'x')
    expect(res.status).toBe(401)
  })

  it('accepts X-API-Key', async () => {
    const res = await request(app).get('/trajectory/v1/ping').set('X-API-Key', KEY)
    expect(res.status).toBe(200)
  })

  it('accepts Authorization: Bearer (any scheme case)', async () => {
    const a = await request(app).get('/trajectory/v1/ping').set('Authorization', `Bearer ${KEY}`)
    expect(a.status).toBe(200)
    const b = await request(app).get('/trajectory/v1/ping').set('authorization', `bearer ${KEY}`)
    expect(b.status).toBe(200)
  })

  it('does not accept ?token= on ordinary routes', async () => {
    const res = await request(app).get(`/trajectory/v1/ping?token=${KEY}`)
    expect(res.status).toBe(401)
  })

  it('accepts ?token= on both event-stream routes', async () => {
    const a = await request(app).get(`/trajectory/v1/instances/abc/events?token=${KEY}`)
    expect(a.status).toBe(200)
    const b = await request(app).get(`/trajectory/v1/properties/abc/events?token=${KEY}`)
    expect(b.status).toBe(200)
  })
})
