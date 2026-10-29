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
import { rateLimit } from '../rate-limit'

describe('rateLimit', () => {
  it('counts every request when no `methods` filter is set', async () => {
    const app = new Hono()
    app.use('*', rateLimit({ windowMs: 60_000, maxRequests: 2, keyFn: () => 'k-all' }))
    app.get('/x', (c) => c.text('ok'))
    expect((await app.request('/x')).status).toBe(200)
    expect((await app.request('/x')).status).toBe(200)
    expect((await app.request('/x')).status).toBe(429) // 3rd > max 2
  })

  it('with methods:["POST"], GET polls pass through unlimited while POSTs stay limited', async () => {
    const app = new Hono()
    app.use(
      '/api/auth/*',
      rateLimit({ windowMs: 60_000, maxRequests: 2, methods: ['POST'], keyFn: () => 'k-post-only' }),
    )
    app.get('/api/auth/get-session', (c) => c.text('session'))
    app.post('/api/auth/sign-in/email', (c) => c.text('signed-in'))

    // The better-auth client polls get-session constantly — far past maxRequests —
    // and those benign GET reads must NEVER be rate-limited.
    for (let i = 0; i < 6; i++) {
      expect((await app.request('/api/auth/get-session')).status).toBe(200)
    }

    // POST sign-in (the brute-force surface) is still throttled after maxRequests.
    expect((await app.request('/api/auth/sign-in/email', { method: 'POST' })).status).toBe(200)
    expect((await app.request('/api/auth/sign-in/email', { method: 'POST' })).status).toBe(200)
    expect((await app.request('/api/auth/sign-in/email', { method: 'POST' })).status).toBe(429) // 3rd POST > max 2
  })

  it('a 429 carries code "rate_limited" and a Retry-After header, like the v2 limiter', async () => {
    // The client renders `${status} ${code}` — without a code a throttled user
    // saw "429 unknown" and had no idea what happened.
    const app = new Hono()
    app.use('*', rateLimit({ windowMs: 60_000, maxRequests: 1, keyFn: () => 'k-body' }))
    app.get('/x', (c) => c.text('ok'))
    expect((await app.request('/x')).status).toBe(200)
    const res = await app.request('/x')
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Too many requests', code: 'rate_limited' })
    const retryAfter = Number(res.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })
})
