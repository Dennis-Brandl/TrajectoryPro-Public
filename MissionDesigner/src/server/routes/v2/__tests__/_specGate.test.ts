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
import { bootstrapDatabase, rawQuery } from '../../../lib/db'
import type { assertCanReadLibrary as assertCanReadLibraryT } from '../_specGate'

let assertCanReadLibrary: typeof assertCanReadLibraryT

beforeAll(async () => {
  await bootstrapDatabase()
  ;({ assertCanReadLibrary } = await import('../_specGate'))
})

beforeEach(async () => {
  // FK-safe delete order: child tables first.
  await rawQuery('DELETE FROM "user_team_role"')
  await rawQuery('DELETE FROM "user_team"')
  await rawQuery('DELETE FROM "library"')
  await rawQuery('DELETE FROM "user"')

  const NOW = Date.now()
  const NOW_DATE = new Date(NOW)
  await rawQuery(`INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5)`, [
    'u1',
    'u@x.com',
    false,
    NOW_DATE,
    NOW_DATE,
  ])
  await rawQuery(`INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5)`, [
    'u2',
    'u2@x.com',
    false,
    NOW_DATE,
    NOW_DATE,
  ])
  await rawQuery(
    `INSERT INTO "team" ("id","name","description","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    ['teamGate', 'Gate Team', '', NOW, NOW],
  )
  await rawQuery(
    `INSERT INTO "library" ("id","teamId","name","entityType","version","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    ['libA', 'teamGate', 'Owned', 'workflow', '1.0.0', NOW, NOW],
  )
  await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2)`, ['u1', 'teamGate'])
})

describe('assertCanReadLibrary', () => {
  it('returns the library for a team member', async () => {
    const session = { userId: 'u1', isAdministrator: false }
    const lib = await assertCanReadLibrary(session, 'libA')
    expect(lib?.id).toBe('libA')
  })
  it('returns null for a non-member of the library team', async () => {
    const session = { userId: 'u2', isAdministrator: false }
    expect(await assertCanReadLibrary(session, 'libA')).toBeNull()
  })
})
