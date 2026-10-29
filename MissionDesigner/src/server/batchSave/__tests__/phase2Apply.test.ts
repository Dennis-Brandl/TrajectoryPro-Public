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
  await rawQuery(
    `INSERT INTO specification
       (id, "libraryId", name, version, state, data,
        "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    ['rootA', 'lib1', 'RootA', '1.0.0', 'Draft', '{"nodes":[]}', 'rootA', null, 3, NOW, NOW],
  )
  await rawQuery('INSERT INTO "user_team" ("userId", "teamId") VALUES ($1, $2)', ['u1', 'team1'])
  await rawQuery('INSERT INTO "user_team_role" ("userId", "teamId", "roleId") VALUES ($1, $2, $3)', [
    'u1',
    'team1',
    'role-author',
  ])
})

const EMPTY = { specs: [], proxyRefs: [], specEnvs: [], imageDeletes: [], imageRefs: [] }

describe('phase2Apply', () => {
  it('creates a new root spec', async () => {
    await phase2Apply(
      {
        ...EMPTY,
        specs: [
          {
            op: 'create',
            id: 'rootB',
            parentSpecificationId: null,
            rootSpecificationId: 'rootB',
            libraryId: 'lib1',
            name: 'RootB',
            data: '{"nodes":[]}',
            dataSchemaVersion: 3,
            version: '1.0.0',
            state: 'Draft',
          },
        ],
      } as never,
      { createOrder: ['rootB'], touchedLibraryIds: new Set(['lib1']) },
      CTX,
    )
    const rows = await rawQuery<{ name: string }>('SELECT name FROM specification WHERE id = $1', ['rootB'])
    expect(rows[0].name).toBe('RootB')
  })

  it('applies an update to an existing spec', async () => {
    await phase2Apply(
      {
        ...EMPTY,
        specs: [{ op: 'update', id: 'rootA', name: 'Renamed' }],
      } as never,
      { createOrder: [], touchedLibraryIds: new Set(['lib1']) },
      CTX,
    )
    const rows = await rawQuery<{ name: string }>('SELECT name FROM specification WHERE id = $1', ['rootA'])
    expect(rows[0].name).toBe('Renamed')
  })

  it('stores typeName on create, clears it with null, and keeps it when the key is absent', async () => {
    const run = (spec: Record<string, unknown>, createOrder: string[]) =>
      phase2Apply({ ...EMPTY, specs: [spec] } as never, { createOrder, touchedLibraryIds: new Set(['lib1']) }, CTX)
    const typeOf = async () =>
      (await rawQuery<{ typeName: string | null }>('SELECT "typeName" FROM specification WHERE id = $1', ['rootT']))[0]
        .typeName
    await run(
      {
        op: 'create',
        id: 'rootT',
        parentSpecificationId: null,
        rootSpecificationId: 'rootT',
        libraryId: 'lib1',
        name: 'RootT',
        data: '{"nodes":[]}',
        dataSchemaVersion: 3,
        version: '1.0.0',
        state: 'Draft',
        typeName: 'Phase',
      },
      ['rootT'],
    )
    expect(await typeOf()).toBe('Phase')
    await run({ op: 'update', id: 'rootT', name: 'Renamed' }, [])
    expect(await typeOf()).toBe('Phase')
    await run({ op: 'update', id: 'rootT', typeName: 'Operation' }, [])
    expect(await typeOf()).toBe('Operation')
    await run({ op: 'update', id: 'rootT', typeName: null }, [])
    expect(await typeOf()).toBeNull()
  })

  it('rolls back the whole batch when a later op violates a unique constraint', async () => {
    // beforeEach already seeded 'rootA' with name='RootA', version='1.0.0', libraryId='lib1'.
    // The batch:
    //   op1 — create 'newSpec1' with a unique name (would succeed in isolation)
    //   op2 — create 'rootA-dup' with name='RootA' version='1.0.0' in lib1
    //          → violates specification_root_name_unique (23505)
    // Expected: Phase2Error 409 + 'newSpec1' NOT in DB (full rollback).
    const { Phase2Error: Phase2ErrorClass } = await import('../phase2Apply')
    await expect(
      phase2Apply(
        {
          ...EMPTY,
          specs: [
            {
              op: 'create',
              id: 'newSpec1',
              parentSpecificationId: null,
              rootSpecificationId: 'newSpec1',
              libraryId: 'lib1',
              name: 'ShouldBeRolledBack',
              data: '{}',
              dataSchemaVersion: 3,
              version: '2.0.0',
              state: 'Draft',
            },
            {
              op: 'create',
              id: 'rootA-dup',
              parentSpecificationId: null,
              rootSpecificationId: 'rootA-dup',
              libraryId: 'lib1',
              name: 'RootA', // duplicate of the seeded rootA → 23505
              data: '{}',
              dataSchemaVersion: 3,
              version: '1.0.0',
              state: 'Draft',
            },
          ],
        } as never,
        { createOrder: ['newSpec1', 'rootA-dup'], touchedLibraryIds: new Set(['lib1']) },
        CTX,
      ),
    ).rejects.toBeInstanceOf(Phase2ErrorClass)

    // Verify atomicity: the first op's row must not exist (rolled back)
    const rows = await rawQuery<{ id: string }>('SELECT id FROM specification WHERE id = $1', ['newSpec1'])
    expect(rows).toHaveLength(0)
  })
})
