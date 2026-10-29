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

// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { mountAuthRateLimit, AUTH_RATE_LIMIT_MAX } from '../authRateLimit'

// Each test passes a distinct keyFn because the rate-limit store is
// module-global (keyed by IP in production) — distinct keys isolate buckets.
describe('mountAuthRateLimit', () => {
  it('NEVER rate-limits sign-out — logout must always succeed', async () => {
    const app = new Hono()
    mountAuthRateLimit(app, () => 'k-signout')
    app.post('/api/auth/sign-out', (c) => c.json({ success: true }))
    // Far beyond the limit. A single 429 here means the session never clears
    // and the user is stuck logged in — the bug this guards against.
    for (let i = 0; i < AUTH_RATE_LIMIT_MAX + 5; i++) {
      expect((await app.request('/api/auth/sign-out', { method: 'POST' })).status).toBe(200)
    }
  })

  it('NEVER rate-limits GET get-session polling', async () => {
    const app = new Hono()
    mountAuthRateLimit(app, () => 'k-getsession')
    app.get('/api/auth/get-session', (c) => c.text('s'))
    for (let i = 0; i < AUTH_RATE_LIMIT_MAX + 5; i++) {
      expect((await app.request('/api/auth/get-session')).status).toBe(200)
    }
  })

  it('rate-limits sign-in POSTs after AUTH_RATE_LIMIT_MAX', async () => {
    const app = new Hono()
    mountAuthRateLimit(app, () => 'k-signin')
    app.post('/api/auth/sign-in/email', (c) => c.text('ok'))
    for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
      expect((await app.request('/api/auth/sign-in/email', { method: 'POST' })).status).toBe(200)
    }
    expect((await app.request('/api/auth/sign-in/email', { method: 'POST' })).status).toBe(429)
  })

  it('counts sign-in and sign-up against one shared per-IP budget', async () => {
    const app = new Hono()
    mountAuthRateLimit(app, () => 'k-shared')
    app.post('/api/auth/sign-in/email', (c) => c.text('in'))
    app.post('/api/auth/sign-up/email', (c) => c.text('up'))
    for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
      const path = i % 2 ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email'
      expect((await app.request(path, { method: 'POST' })).status).toBe(200)
    }
    // Budget exhausted across both endpoints combined.
    expect((await app.request('/api/auth/sign-up/email', { method: 'POST' })).status).toBe(429)
  })
})
