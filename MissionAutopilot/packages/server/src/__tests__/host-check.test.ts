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
import { createHostCheck } from '../middleware/host-check.js'
import { allowedHosts, isOriginAllowed } from '../config.js'

function appWithCheck() {
  const app = express()
  app.use(createHostCheck(allowedHosts({}), (o) => isOriginAllowed(o, undefined)))
  app.get('/ping', (_req, res) => {
    res.json({ ok: true })
  })
  return app
}

describe('createHostCheck', () => {
  it.each(['localhost:3002', '127.0.0.1:3002', '[::1]:3002', 'mission-autopilot-server:3002'])(
    'allows Host %s',
    async (host) => {
      const res = await request(appWithCheck()).get('/ping').set('Host', host)
      expect(res.status).toBe(200)
    }
  )

  it('rejects an unknown Host with FORBIDDEN_HOST', async () => {
    const res = await request(appWithCheck()).get('/ping').set('Host', 'evil.example:3002')
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN_HOST')
  })

  it('rejects a disallowed Origin with FORBIDDEN_ORIGIN', async () => {
    const res = await request(appWithCheck())
      .get('/ping')
      .set('Host', 'localhost:3002')
      .set('Origin', 'http://evil.example')
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN')
  })

  it('allows a loopback Origin', async () => {
    const res = await request(appWithCheck())
      .get('/ping')
      .set('Host', 'localhost:3002')
      .set('Origin', 'http://localhost:3003')
    expect(res.status).toBe(200)
  })
})
