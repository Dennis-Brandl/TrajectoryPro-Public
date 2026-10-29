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
import type { phase1Validate as phase1ValidateT } from '../phase1Validate'

let phase1Validate: typeof phase1ValidateT

beforeAll(async () => {
  await bootstrapDatabase()
  await seedRoles()
  ;({ phase1Validate } = await import('../phase1Validate'))
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
const CTX = { sessionUserId: 'u1' }

describe('phase1Validate', () => {
  it('accepts an empty payload', async () => {
    await phase1Validate(EMPTY, CTX)
  })

  it('rejects duplicate spec create ids', async () => {
    await expect(
      phase1Validate(
        {
          ...EMPTY,
          specs: [
            {
              op: 'create',
              id: 'd',
              rootSpecificationId: 'd',
              libraryId: 'lib1',
              name: 'X',
              data: '{"nodes":[]}',
              dataSchemaVersion: 3,
              version: '1.0.0',
              state: 'Draft',
            },
            {
              op: 'create',
              id: 'd',
              rootSpecificationId: 'd',
              libraryId: 'lib1',
              name: 'Y',
              data: '{"nodes":[]}',
              dataSchemaVersion: 3,
              version: '1.0.0',
              state: 'Draft',
            },
          ],
        } as never,
        CTX,
      ),
    ).rejects.toThrow(/duplicate_id_in_batch/)
  })

  it('rejects data blob whose nodes field is not an array', async () => {
    await expect(
      phase1Validate(
        {
          ...EMPTY,
          specs: [
            {
              op: 'create',
              id: 'x',
              rootSpecificationId: 'x',
              libraryId: 'lib1',
              name: 'X',
              data: '{"nodes":"oops"}',
              dataSchemaVersion: 3,
              version: '1.0.0',
              state: 'Draft',
            },
          ],
        } as never,
        CTX,
      ),
    ).rejects.toThrow(/data_blob_invalid/)
  })

  it('accepts data blob without a nodes field (non-canvas entities like actions/environments)', async () => {
    await phase1Validate(
      {
        ...EMPTY,
        specs: [
          {
            op: 'create',
            id: 'x',
            rootSpecificationId: 'x',
            libraryId: 'lib1',
            name: 'X',
            data: '{"inputs":[],"outputs":[]}',
            dataSchemaVersion: 3,
            version: '1.0.0',
            state: 'Draft',
          },
        ],
      } as never,
      CTX,
    )
  })

  it('rejects data blob containing imageBase64 anywhere', async () => {
    const data = JSON.stringify({ nodes: [{ id: 'n1', imageBase64: 'abc' }] })
    await expect(
      phase1Validate(
        {
          ...EMPTY,
          specs: [
            {
              op: 'create',
              id: 'x',
              rootSpecificationId: 'x',
              libraryId: 'lib1',
              name: 'X',
              data,
              dataSchemaVersion: 3,
              version: '1.0.0',
              state: 'Draft',
            },
          ],
        } as never,
        CTX,
      ),
    ).rejects.toThrow(/data_blob_invalid/)
  })

  it('rejects a cycle in parentSpecificationId', async () => {
    await expect(
      phase1Validate(
        {
          ...EMPTY,
          specs: [
            {
              op: 'create',
              id: 'a',
              parentSpecificationId: 'b',
              rootSpecificationId: 'rootA',
              name: 'A',
              data: '{"nodes":[]}',
              dataSchemaVersion: 3,
            },
            {
              op: 'create',
              id: 'b',
              parentSpecificationId: 'a',
              rootSpecificationId: 'rootA',
              name: 'B',
              data: '{"nodes":[]}',
              dataSchemaVersion: 3,
            },
          ],
        } as never,
        CTX,
      ),
    ).rejects.toThrow(/cycle_detected/)
  })

  it('rejects parent_not_found for unknown parent reference', async () => {
    await expect(
      phase1Validate(
        {
          ...EMPTY,
          specs: [
            {
              op: 'create',
              id: 'x',
              parentSpecificationId: 'nope',
              rootSpecificationId: 'rootA',
              name: 'X',
              data: '{"nodes":[]}',
              dataSchemaVersion: 3,
            },
          ],
        } as never,
        CTX,
      ),
    ).rejects.toThrow(/parent_not_found/)
  })

  it('rejects image_ref_unpaired when imageRefs entry lacks a spec in specs[]', async () => {
    await expect(
      phase1Validate(
        {
          ...EMPTY,
          imageRefs: [{ op: 'create', specificationId: 'rootA', imageId: 'i1' }],
        },
        CTX,
      ),
    ).rejects.toThrow(/image_ref_unpaired/)
  })

  it('accepts imageRefs entry when paired with an update in specs[]', async () => {
    await phase1Validate(
      {
        ...EMPTY,
        specs: [{ op: 'update', id: 'rootA', name: 'RootA Renamed' }],
        imageRefs: [{ op: 'delete', specificationId: 'rootA', imageId: 'i1' }],
      },
      CTX,
    )
  })

  it('rejects 413 when specs + proxyRefs + ... exceed MAX_SPECS_PER_BATCH', async () => {
    const specs = Array.from({ length: 501 }, (_, i) => ({
      op: 'update' as const,
      id: `s${i}`,
    }))
    await expect(phase1Validate({ ...EMPTY, specs }, CTX)).rejects.toThrow(/payload_too_large/)
  })
})
