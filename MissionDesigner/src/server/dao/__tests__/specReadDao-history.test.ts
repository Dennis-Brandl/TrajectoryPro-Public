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

let rawQuery: typeof import('../../lib/db').rawQuery
let bootstrapDatabase: typeof import('../../lib/db').bootstrapDatabase
let seedRoles: typeof import('../../lib/rbacSeed').seedRoles
let specReadDao: typeof import('../specReadDao').specReadDao
let ctx: import('../specReadDao').ReadContext

beforeAll(async () => {
  ;({ rawQuery, bootstrapDatabase } = await import('../../lib/db'))
  ;({ seedRoles } = await import('../../lib/rbacSeed'))
  await bootstrapDatabase()
  await seedRoles()
  ;({ specReadDao } = await import('../specReadDao'))
  ctx = { sessionUserId: 'u1' }
})

beforeEach(async () => {
  const NOW = Date.now()
  // FK-safe teardown — do not delete role/role_right/app_setting (seeded once in beforeAll).
  await rawQuery('DELETE FROM "user_team_role"')
  await rawQuery('DELETE FROM "user_team"')
  await rawQuery('DELETE FROM "specification_environment"')
  await rawQuery('DELETE FROM "library_environment"')
  await rawQuery('DELETE FROM "specification"')
  await rawQuery('DELETE FROM "library"')
  await rawQuery('DELETE FROM "user"')
  await rawQuery('DELETE FROM "team"')

  await rawQuery(
    `INSERT INTO "user" ("id", "email", "emailVerified", "createdAt", "updatedAt") VALUES ('u1', 'u1@x.com', false, $1, $2)`,
    [NOW, NOW],
  )
  // lib1 belongs to team t1; u1 is a member, preserving u1's read access to it.
  await rawQuery(
    `INSERT INTO "team" ("id", "name", "description", "createdAt", "updatedAt") VALUES ('t1','T1','',$1,$2)`,
    [NOW, NOW],
  )
  await rawQuery(`INSERT INTO "user_team" ("userId", "teamId") VALUES ('u1','t1')`)
  await rawQuery(`INSERT INTO "user_team_role" ("userId", "teamId", "roleId") VALUES ('u1','t1','role-author')`)
  await rawQuery(
    `INSERT INTO "library" ("id", "teamId", "name", "entityType", "version", "createdAt", "updatedAt")
     VALUES ('lib1','t1','Test Lib','workflow','1.0.0',$1,$2)`,
    [NOW, NOW],
  )
})

async function insertSpec(id: string, history: string | undefined): Promise<void> {
  const NOW = Date.now()
  if (history !== undefined) {
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "history", "createdAt", "updatedAt")
       VALUES ($1, 'lib1', 'Test Spec', '1.0.0', 'Draft', '{"nodes":[]}', $2, NULL, 3, $3, $4, $5)`,
      [id, id, history, NOW, NOW],
    )
  } else {
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ($1, 'lib1', 'Test Spec', '1.0.0', 'Draft', '{"nodes":[]}', $2, NULL, 3, $3, $4)`,
      [id, id, NOW, NOW],
    )
  }
}

describe('specReadDao history field', () => {
  it('returns empty array when history column is empty default', async () => {
    // Insert without specifying history — DB default '[]' applies
    await insertSpec('spec-default', undefined)
    const result = await specReadDao.getSpec(ctx, 'spec-default')
    expect(result?.history).toEqual([])
  })

  it('parses non-empty history correctly', async () => {
    const entry = { type: 'created', at: '2026-05-01T00:00:00Z', account: 'a@b.com', version: '1.0.0' }
    await insertSpec('spec-with-history', JSON.stringify([entry]))
    const result = await specReadDao.getSpec(ctx, 'spec-with-history')
    expect(result?.history).toEqual([entry])
  })

  it('returns [] for malformed history JSON instead of throwing', async () => {
    await insertSpec('spec-bad-history', 'not-valid-json')
    const result = await specReadDao.getSpec(ctx, 'spec-bad-history')
    expect(result?.history).toEqual([])
  })

  it('parses history on getTree spec rows', async () => {
    const entry = { type: 'created', at: '2026-05-01T00:00:00Z', account: 'a@b.com', version: '1.0.0' }
    await insertSpec('spec-tree-test', JSON.stringify([entry]))
    const tree = await specReadDao.getTree(ctx, 'spec-tree-test')
    const rootInTree = tree?.specs?.find((s: { id: string }) => s.id === 'spec-tree-test')
    expect(rootInTree?.history).toEqual([entry])
  })

  it('parses history on getSpecs bulk fetch', async () => {
    const entry = { type: 'created', at: '2026-05-01T00:00:00Z', account: 'a@b.com', version: '1.0.0' }
    await insertSpec('spec-bulk-test', JSON.stringify([entry]))
    const result = await specReadDao.getSpecs(ctx, ['spec-bulk-test'])
    const fetched = result?.specs?.get?.('spec-bulk-test')
    expect(fetched?.history).toEqual([entry])
  })
})
