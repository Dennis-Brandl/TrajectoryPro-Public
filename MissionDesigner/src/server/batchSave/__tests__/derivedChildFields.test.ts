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

let derivedChildFields: (rootId: string) => Promise<{ libraryId: string; version: string; state: string } | null>

beforeAll(async () => {
  await bootstrapDatabase()
  await seedRoles()
  ;({ derivedChildFields } = await import('../derivedChildFields'))
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
    'team-default',
    'Default Team',
    '',
    NOW,
    NOW,
  ])
  await rawQuery(
    `INSERT INTO library (id, "teamId", name, "entityType", version, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['lib1', 'team-default', 'L', 'workflow', '1.0.0', NOW, NOW],
  )
  await rawQuery(
    `INSERT INTO specification
       (id, "libraryId", name, version, state, data,
        "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    ['root1', 'lib1', 'Root', '1.0.0', 'Draft', '{"nodes":[]}', 'root1', null, 3, NOW, NOW],
  )
})

describe('derivedChildFields', () => {
  it("returns root's libraryId/version/state for a known root", async () => {
    expect(await derivedChildFields('root1')).toEqual({ libraryId: 'lib1', version: '1.0.0', state: 'Draft' })
  })
  it('returns null for unknown root id', async () => {
    expect(await derivedChildFields('nope')).toBeNull()
  })
})
