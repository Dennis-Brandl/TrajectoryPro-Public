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
import { rawQuery, bootstrapDatabase } from '../../lib/db'

beforeAll(async () => {
  await bootstrapDatabase()
})

beforeEach(async () => {
  // FK-ordered cleanup (referencing rows before referenced rows).
  await rawQuery('DELETE FROM image_reference')
  await rawQuery('DELETE FROM image')
  await rawQuery('DELETE FROM image_blob')
  await rawQuery('DELETE FROM proxy_reference')
  await rawQuery('DELETE FROM specification_environment')
  await rawQuery('DELETE FROM library_environment')
  await rawQuery('DELETE FROM specification')
  // library has a self-FK (parentLibraryId → id) with NO ACTION: delete children first.
  await rawQuery('DELETE FROM library WHERE "parentLibraryId" IS NOT NULL')
  await rawQuery('DELETE FROM library')
  await rawQuery('DELETE FROM "user"')

  const NOW = Date.now()
  // Seed user u1.
  await rawQuery('INSERT INTO "user" (id, email, "emailVerified") VALUES ($1, $2, $3)', ['u1', 'u@x.com', false])
  // Seed teams.
  for (const [tid, name] of [
    ['teamA', 'Team A'],
    ['teamB', 'Team B'],
  ] as const) {
    await rawQuery(
      'INSERT INTO team (id, name, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [tid, name, '', NOW, NOW],
    )
  }
  // Seed lib1 in teamA.
  await rawQuery(
    `INSERT INTO library (id, "teamId", name, "entityType", version, "createdAt", "updatedAt")
     VALUES ('lib1', 'teamA', 'L', 'workflow', '1.0.0', $1, $2)`,
    [NOW, NOW],
  )
  // Two root workflows in lib1.
  await rawQuery(
    `INSERT INTO specification (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
     "dataSchemaVersion", "createdAt", "updatedAt")
     VALUES ('rootA', 'lib1', 'Parent A', '1.0.0', 'Draft', '{"nodes":[]}', 'rootA', NULL, 3, $1, $2),
            ('rootB', 'lib1', 'Parent B', '1.0.0', 'Draft', '{"nodes":[]}', 'rootB', NULL, 3, $3, $4)`,
    [NOW, NOW, NOW, NOW],
  )
})

async function insertChild(id: string, parent: string, root: string, name: string, version = '1.0.0') {
  const NOW = Date.now()
  await rawQuery(
    `INSERT INTO specification (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
     "dataSchemaVersion", "createdAt", "updatedAt")
     VALUES ($1, 'lib1', $2, $3, 'Draft', '{"nodes":[]}', $4, $5, 3, $6, $7)`,
    [id, name, version, root, parent, NOW, NOW],
  )
}

async function insertRoot(id: string, name: string, version = '1.0.0') {
  const NOW = Date.now()
  await rawQuery(
    `INSERT INTO specification (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId",
     "dataSchemaVersion", "createdAt", "updatedAt")
     VALUES ($1, 'lib1', $2, $3, 'Draft', '{"nodes":[]}', $4, NULL, 3, $5, $6)`,
    [id, name, version, id, NOW, NOW],
  )
}

describe('specification sibling-scoped uniqueness', () => {
  it('allows two children with the same name under different parents', async () => {
    await insertChild('c1', 'rootA', 'rootA', 'Shared Name')
    await expect(insertChild('c2', 'rootB', 'rootB', 'Shared Name')).resolves.toBeUndefined()
  })

  it('rejects two children with the same name under the same parent', async () => {
    await insertChild('c1', 'rootA', 'rootA', 'Dup Name')
    await expect(insertChild('c2', 'rootA', 'rootA', 'Dup Name')).rejects.toThrow(
      /duplicate key value violates unique constraint/,
    )
  })

  it('rejects two root specs with the same (name, version) in the same library', async () => {
    await expect(insertRoot('rootC', 'Parent A')).rejects.toThrow(/duplicate key value violates unique constraint/)
  })

  it('allows a root and a child to share a name (different uniqueness scopes)', async () => {
    // Reuse a root name for a child under rootB — root uniqueness doesn't
    // apply to child rows and vice versa.
    await expect(insertChild('c1', 'rootB', 'rootB', 'Parent A')).resolves.toBeUndefined()
  })

  it('allows the same (name, version) across different versions at the same scope', async () => {
    await insertChild('c1', 'rootA', 'rootA', 'Release', '1.0.0')
    await expect(insertChild('c2', 'rootA', 'rootA', 'Release', '2.0.0')).resolves.toBeUndefined()
  })
})

async function insertLib(
  id: string,
  teamId: string,
  name: string,
  entityType = 'action',
  parentLibraryId: string | null = null,
) {
  const NOW = Date.now()
  await rawQuery(
    `INSERT INTO library (id, "teamId", "parentLibraryId", name, "entityType", version, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, '1.0.0', $6, $7)`,
    [id, teamId, parentLibraryId, name, entityType, NOW, NOW],
  )
}

describe('library per-team uniqueness (slice 6a: UNIQUE moved from userId to teamId)', () => {
  // The unique index is (teamId, name, entityType, parentLibraryId). Postgres treats
  // NULLs as distinct in a UNIQUE index, so the constraint only bites for sibling
  // (non-NULL parentLibraryId) libraries — hence each case nests under a parent.
  beforeEach(async () => {
    // A parent action library per team (lib1 from the outer seed is on teamA).
    await insertLib('parentA', 'teamA', 'Parent A', 'action', null)
    await insertLib('parentB', 'teamB', 'Parent B', 'action', null)
  })

  it('rejects two sibling libraries with the same (name, entityType, parent) in the SAME team', async () => {
    await insertLib('libDupA', 'teamA', 'Catalog', 'action', 'parentA')
    await expect(insertLib('libDupB', 'teamA', 'Catalog', 'action', 'parentA')).rejects.toThrow(
      /duplicate key value violates unique constraint/,
    )
  })

  it('allows two DIFFERENT teams to each hold a "Catalog" sibling library', async () => {
    await insertLib('libTeamA', 'teamA', 'Catalog', 'action', 'parentA')
    // Same (name, entityType) under teamB's own parent — different team, allowed.
    await expect(insertLib('libTeamB', 'teamB', 'Catalog', 'action', 'parentB')).resolves.toBeUndefined()
  })

  it('allows the same sibling name + parent within a team when entityType differs', async () => {
    await insertLib('libAct', 'teamA', 'Catalog', 'action', 'parentA')
    // Same name + same parent, different entityType → distinct index key, allowed.
    await expect(insertLib('libEnv', 'teamA', 'Catalog', 'environment', 'parentA')).resolves.toBeUndefined()
  })
})
