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
import { setupTestFixture, resetAndSeedFixture, mockSessionAs, v2Req, type TestFixture } from './testSeed'

let f: TestFixture
beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
})

describe('GET /api/v2/libraries (team visibility)', () => {
  it('a team member sees every library owned by their team', async () => {
    mockSessionAs(f.userIdRegular) // member of teamMain
    const res = await v2Req(f, 'GET', '/api/v2/libraries')
    expect(res.status).toBe(200)
    const ids = ((await res.json()) as { libraries: { id: string }[] }).libraries.map((l) => l.id)
    expect(ids).toContain(f.libSharedId)
    expect(ids).toContain(f.libPrivateId)
    expect(ids).toContain(f.libEnvSharedId)
  })

  it('a non-member sees none of the team libraries', async () => {
    mockSessionAs(f.userIdOther) // not a member of teamMain
    const res = await v2Req(f, 'GET', '/api/v2/libraries')
    expect(res.status).toBe(200)
    const ids = ((await res.json()) as { libraries: { id: string }[] }).libraries.map((l) => l.id)
    expect(ids).not.toContain(f.libSharedId)
    expect(ids).not.toContain(f.libPrivateId)
  })

  it('a non-member gets 404 fetching a team library tree', async () => {
    mockSessionAs(f.userIdOther)
    const res = await v2Req(f, 'GET', `/api/v2/specifications/${f.rootSpecId}/tree`)
    expect(res.status).toBe(404)
  })
})
