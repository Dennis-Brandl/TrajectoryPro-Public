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
import { bootstrapDatabase, rawQuery } from '../../lib/db'
import { seedRoles } from '../../lib/rbacSeed'
import { parseHistory } from '@/types/specification-history'
import type { phase2Apply as phase2ApplyT } from '../phase2Apply'

let phase2Apply: typeof phase2ApplyT
const CTX = { sessionUserId: 'u1' }

beforeAll(async () => {
  await bootstrapDatabase()
  await seedRoles()
  ;({ phase2Apply } = await import('../phase2Apply'))
})

beforeEach(async () => {
  await rawQuery(
    `TRUNCATE "user_team_role", "user_team",
      "image_reference", "image", "image_blob",
      "proxy_reference", "specification_environment", "library_environment",
      "specification", "library", "user", "team" CASCADE`,
  )
  const NOW = Date.now()
  await rawQuery(
    'INSERT INTO "user" (id, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, false, $3, $4)',
    ['u1', 'u@x.com', new Date(NOW).toISOString(), new Date(NOW).toISOString()],
  )
  await rawQuery('INSERT INTO "team" (id, name, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5)', [
    'team1',
    'T',
    '',
    NOW,
    NOW,
  ])
  await rawQuery(
    `INSERT INTO library (id, "teamId", name, "entityType", version, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['lib1', 'team1', 'L', 'workflow', '1.0.0', NOW, NOW],
  )
  await rawQuery('INSERT INTO "user_team" ("userId", "teamId") VALUES ($1, $2)', ['u1', 'team1'])
  await rawQuery('INSERT INTO "user_team_role" ("userId", "teamId", "roleId") VALUES ($1, $2, $3)', [
    'u1',
    'team1',
    'role-author',
  ])
})

const EMPTY = { specs: [], proxyRefs: [], specEnvs: [], imageDeletes: [], imageRefs: [] }

async function getSpecHistory(id: string) {
  const rows = await rawQuery<{ history: string | null }>('SELECT history FROM specification WHERE id = $1', [id])
  return parseHistory(rows[0]?.history)
}

describe('phase2Apply: created history entry on new specs', () => {
  it('writes a created entry for a brand-new root spec', async () => {
    await phase2Apply(
      {
        ...EMPTY,
        specs: [
          {
            op: 'create',
            id: 'new-spec-1',
            parentSpecificationId: null,
            rootSpecificationId: 'new-spec-1',
            libraryId: 'lib1',
            name: 'NewSpec',
            data: '{}',
            dataSchemaVersion: 3,
            version: '1.0.0',
            state: 'Draft',
          },
        ],
      } as never,
      { createOrder: ['new-spec-1'], touchedLibraryIds: new Set(['lib1']) },
      CTX,
    )
    const history = await getSpecHistory('new-spec-1')
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ type: 'created', version: '1.0.0', account: 'u1' })
  })

  it('does NOT add a created entry on update of an existing spec', async () => {
    const NOW = Date.now()
    // Insert an existing spec directly
    await rawQuery(
      `INSERT INTO specification
         (id, "libraryId", name, version, state, data,
          "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      ['s1', 'lib1', 'X', '1.0.0', 'Draft', '{}', 's1', null, 3, NOW, NOW],
    )

    const before = await getSpecHistory('s1')

    await phase2Apply(
      {
        ...EMPTY,
        specs: [{ op: 'update', id: 's1', data: '{"changed":true}' }],
      } as never,
      { createOrder: [], touchedLibraryIds: new Set(['lib1']) },
      CTX,
    )

    const after = await getSpecHistory('s1')
    expect(after).toEqual(before)
  })
})
