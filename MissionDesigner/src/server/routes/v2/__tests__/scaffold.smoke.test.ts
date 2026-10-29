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

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestFixture, resetAndSeedFixture, v2Req, rawQuery, type TestFixture } from './testSeed'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
})

describe('testSeed: scaffold smoke', () => {
  it('health endpoint responds', async () => {
    const res = await v2Req(f, 'GET', '/api/v2/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('seeds 3 users + 3 libraries + 2 specs', async () => {
    const [users] = await rawQuery<{ c: string }>('SELECT count(*) AS c FROM "user"')
    const [libs] = await rawQuery<{ c: string }>('SELECT count(*) AS c FROM library')
    const [specs] = await rawQuery<{ c: string }>('SELECT count(*) AS c FROM specification')
    expect(Number(users.c)).toBe(3)
    expect(Number(libs.c)).toBe(3)
    expect(Number(specs.c)).toBe(2)
  })
})
