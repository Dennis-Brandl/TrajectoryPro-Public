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
import { mountSignupGate } from '../signupGate'

describe('mountSignupGate', () => {
  it('passes sign-up through while setup is incomplete', async () => {
    const app = new Hono()
    mountSignupGate(app, () => false)
    app.post('/api/auth/sign-up/email', (c) => c.text('ok'))
    const res = await app.request('/api/auth/sign-up/email', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })

  it('returns 403 (signup_closed) on sign-up once setup is complete', async () => {
    const app = new Hono()
    mountSignupGate(app, () => true)
    app.post('/api/auth/sign-up/email', (c) => c.text('ok'))
    const res = await app.request('/api/auth/sign-up/email', { method: 'POST' })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('signup_closed')
  })

  it('never gates non-sign-up auth routes (e.g. sign-in) even when complete', async () => {
    const app = new Hono()
    mountSignupGate(app, () => true)
    app.post('/api/auth/sign-in/email', (c) => c.text('in'))
    const res = await app.request('/api/auth/sign-in/email', { method: 'POST' })
    expect(res.status).toBe(200)
  })
})
