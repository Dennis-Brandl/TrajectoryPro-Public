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

import { describe, it, expect, beforeAll } from 'vitest'
import { Hono } from 'hono'

let v2Routes: Hono

beforeAll(async () => {
  ;({ v2Routes } = await import('../index'))
})

describe('v2 sub-router', () => {
  it('GET /health returns { ok: true, phase: "2a" }', async () => {
    const app = new Hono()
    app.route('/api/v2', v2Routes)
    const res = await app.request('/api/v2/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; phase: string }
    expect(body.ok).toBe(true)
    expect(body.phase).toBe('2a')
  })
})
