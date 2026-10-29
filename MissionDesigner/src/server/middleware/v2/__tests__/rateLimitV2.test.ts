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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { rateLimitV2, resetRateLimitBucketsForTests } from '../rateLimitV2'
import { RATE_LIMIT_MUTATING_PER_MIN, RATE_LIMIT_READS_PER_MIN } from '../../../limits'

function makeApp(userId = 'u-test') {
  const app = new Hono()
  app.use('*', async (c, next) => {
    ;(c.set as (key: string, value: unknown) => void)('v2Session', { userId, isAdministrator: false })
    await next()
  })
  app.use('*', rateLimitV2)
  app.get('/read', (c) => c.json({ ok: true }))
  app.post('/mutate', (c) => c.json({ ok: true }))
  // Mounted under /api/v2 in production; the limiter must recognise it by suffix.
  app.post('/api/v2/specifications/bulk-fetch', (c) => c.json({ ok: true }))
  return app
}

async function hit(app: Hono, method: 'GET' | 'POST', path: string): Promise<number> {
  const res = await app.request(path, { method })
  return res.status
}

beforeEach(() => {
  resetRateLimitBucketsForTests()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-08T00:00:00Z'))
})

describe('rateLimitV2: token bucket (§2.2)', () => {
  it(`allows RATE_LIMIT_READS_PER_MIN (${RATE_LIMIT_READS_PER_MIN}) reads per minute then 429`, async () => {
    const app = makeApp()
    for (let i = 0; i < RATE_LIMIT_READS_PER_MIN; i++) {
      expect(await hit(app, 'GET', '/read')).toBe(200)
    }
    expect(await hit(app, 'GET', '/read')).toBe(429)
  })

  it(`allows RATE_LIMIT_MUTATING_PER_MIN (${RATE_LIMIT_MUTATING_PER_MIN}) mutating per minute then 429`, async () => {
    const app = makeApp()
    for (let i = 0; i < RATE_LIMIT_MUTATING_PER_MIN; i++) {
      expect(await hit(app, 'POST', '/mutate')).toBe(200)
    }
    expect(await hit(app, 'POST', '/mutate')).toBe(429)
  })

  it('POST bulk-fetch is a read: it draws from the reads bucket and leaves the mutating budget intact', async () => {
    // bulk-fetch is the one POST that scales with the number of libraries a
    // user has (one per library on workflow open). Counting it as a mutation
    // would let a few dozen libraries exhaust the 120/min write budget.
    const app = makeApp()
    for (let i = 0; i < RATE_LIMIT_MUTATING_PER_MIN + 10; i++) {
      expect(await hit(app, 'POST', '/api/v2/specifications/bulk-fetch')).toBe(200)
    }
    for (let i = 0; i < RATE_LIMIT_MUTATING_PER_MIN; i++) {
      expect(await hit(app, 'POST', '/mutate')).toBe(200)
    }
    expect(await hit(app, 'POST', '/mutate')).toBe(429)
  })

  it('refills the mutating bucket after 60 s', async () => {
    const app = makeApp()
    for (let i = 0; i < RATE_LIMIT_MUTATING_PER_MIN; i++) await hit(app, 'POST', '/mutate')
    expect(await hit(app, 'POST', '/mutate')).toBe(429)
    vi.advanceTimersByTime(61_000)
    expect(await hit(app, 'POST', '/mutate')).toBe(200)
  })

  it('tracks buckets per user', async () => {
    const app1 = makeApp('user-A')
    for (let i = 0; i < RATE_LIMIT_MUTATING_PER_MIN; i++) await hit(app1, 'POST', '/mutate')
    const app2 = makeApp('user-B')
    expect(await hit(app2, 'POST', '/mutate')).toBe(200)
  })
})
