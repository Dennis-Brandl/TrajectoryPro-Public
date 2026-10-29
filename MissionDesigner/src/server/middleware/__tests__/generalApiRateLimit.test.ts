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
import { mountGeneralApiRateLimit } from '../generalApiRateLimit'
import { RATE_LIMIT_READS_PER_MIN } from '../../limits'

// Each test passes a distinct keyFn because the rate-limit store is
// module-global (keyed by user then IP in production) — distinct keys isolate buckets.
function makeApp(key: string) {
  const app = new Hono()
  mountGeneralApiRateLimit(app, () => key)
  app.get('/api/health', (c) => c.text('ok'))
  app.get('/api/v2/libraries', (c) => c.json({ libraries: [] }))
  app.post('/api/v2/specifications/bulk-fetch', (c) => c.json({ specs: [] }))
  app.get('/api/auth/get-session', (c) => c.text('s'))
  return app
}

describe('mountGeneralApiRateLimit', () => {
  it('limits legacy /api/* routes at RATE_LIMIT_READS_PER_MIN per minute, then 429 with code rate_limited', async () => {
    const app = makeApp('k-legacy')
    for (let i = 0; i < RATE_LIMIT_READS_PER_MIN; i++) {
      expect((await app.request('/api/health')).status).toBe(200)
    }
    const res = await app.request('/api/health')
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Too many requests', code: 'rate_limited' })
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('never counts /api/v2/* — rateLimitV2 owns those with its own read/mutation budgets', async () => {
    const app = makeApp('k-v2')
    for (let i = 0; i < RATE_LIMIT_READS_PER_MIN + 5; i++) {
      expect((await app.request('/api/v2/libraries')).status).toBe(200)
    }
    for (let i = 0; i < 200; i++) {
      expect((await app.request('/api/v2/specifications/bulk-fetch', { method: 'POST' })).status).toBe(200)
    }
    // …and that traffic did not eat the legacy budget either.
    expect((await app.request('/api/health')).status).toBe(200)
  })

  it('never counts /api/auth/* — the auth limiter owns those', async () => {
    const app = makeApp('k-auth')
    for (let i = 0; i < RATE_LIMIT_READS_PER_MIN + 5; i++) {
      expect((await app.request('/api/auth/get-session')).status).toBe(200)
    }
  })

  it('keeps separate budgets per key', async () => {
    const appA = makeApp('k-user-A')
    for (let i = 0; i < RATE_LIMIT_READS_PER_MIN; i++) await appA.request('/api/health')
    expect((await appA.request('/api/health')).status).toBe(429)
    const appB = makeApp('k-user-B')
    expect((await appB.request('/api/health')).status).toBe(200)
  })
})
