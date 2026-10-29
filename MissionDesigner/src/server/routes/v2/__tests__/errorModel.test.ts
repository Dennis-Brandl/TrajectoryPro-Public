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
  mockSessionAs(f.userIdGlobal)
})

const LEAK_PATTERNS = [
  /SQLITE_/,
  /SQL error:/,
  /RAISE\(/,
  /proxy reference crosses trees/,
  /parent library must belong to same team/,
]

async function bodyText(res: Response): Promise<string> {
  try {
    return JSON.stringify(await res.json())
  } catch {
    return await res.text()
  }
}

describe('error model: no SQLite/RAISE leaks in v2 responses', () => {
  const cases: Array<{ name: string; fire: () => Promise<Response> }> = [
    {
      name: 'cross-tree proxyRef',
      fire: () =>
        v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
          json: {
            specs: [{ op: 'update', id: f.rootSpecId, name: 'x' }],
            proxyRefs: [
              { op: 'create', parentSpecificationId: f.rootSpecId, nodeId: 'n1', targetSpecificationId: 'nonexistent' },
            ],
            specEnvs: [],
            imageDeletes: [],
            imageRefs: [],
          },
        }),
    },
    {
      name: 'unknown field',
      fire: () =>
        v2Req(f, 'POST', '/api/v2/specifications/batch-save', {
          json: {
            specs: [],
            proxyRefs: [],
            specEnvs: [],
            imageDeletes: [],
            imageRefs: [],
            gotcha: true,
          },
        }),
    },
  ]

  it.each(cases)('$name does not leak raw text', async ({ fire }) => {
    const res = await fire()
    const text = await bodyText(res)
    for (const p of LEAK_PATTERNS) {
      expect(text).not.toMatch(p)
    }
  })
})
