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

// Phase 35 §5 Gate G1: trigger matrix tests. For each guard trigger, attempt
// the violating operation and assert it raises. For each bump trigger,
// perform the bumping operation and assert the version moves.

// @vitest-environment node

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { rawQuery, bootstrapDatabase } from '../../lib/db'

beforeAll(async () => {
  await bootstrapDatabase()
})

beforeEach(async () => {
  // Wipe user-content tables between tests (delete children first to respect FKs).
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
  await insertTeam('team-default', 'Default Team')
})

async function insertUser(id: string, email: string) {
  await rawQuery('INSERT INTO "user" (id, email, "emailVerified") VALUES ($1, $2, $3)', [id, email, false])
}

async function insertTeam(id: string, name: string) {
  const now = Date.now()
  await rawQuery(
    'INSERT INTO team (id, name, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    [id, name, '', now, now],
  )
}

async function insertLibrary(
  id: string,
  userId: string | null,
  name: string,
  entityType = 'workflow',
  // teamId is NOT NULL; default to 'team-default', seeded per-test in beforeEach.
  teamId = 'team-default',
) {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO library (id, "createdByUserId", "teamId", name, "entityType", version, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, '1.0.0', $6, $7)`,
    [id, userId, teamId, name, entityType, now, now],
  )
}

async function insertRootSpec(id: string, libraryId: string, name: string) {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO specification
       (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, '1.0.0', 'Draft', '{}', $4, NULL, 3, $5, $6)`,
    [id, libraryId, name, id, now, now],
  )
}

async function insertChildSpec(id: string, libraryId: string, name: string, rootId: string, parentId: string) {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO specification
       (id, "libraryId", name, version, state, data, "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, '1.0.0', 'Draft', '{}', $4, $5, 3, $6, $7)`,
    [id, libraryId, name, rootId, parentId, now, now],
  )
}

describe('library triggers', () => {
  it('library_immutable_columns: UPDATE OF id is rejected', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertLibrary('lib1', 'u1', 'Lib 1')
    await expect(rawQuery('UPDATE library SET id = $1 WHERE id = $2', ['lib1-new', 'lib1'])).rejects.toThrow(
      /library\.id is immutable/,
    )
  })

  it('library_parent_same_team_insert: nested library with mismatched team is rejected', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertUser('u2', 'u2@example.com')
    await insertTeam('teamA', 'Team A')
    await insertTeam('teamB', 'Team B')
    await insertLibrary('lib1', 'u1', 'Parent', 'action', 'teamA')
    const now = Date.now()
    await expect(
      rawQuery(
        `INSERT INTO library (id, "createdByUserId", "teamId", "parentLibraryId", name, "entityType", version, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'action', '1.0.0', $6, $7)`,
        ['lib2', 'u2', 'teamB', 'lib1', 'Child', now, now],
      ),
    ).rejects.toThrow(/parent library must belong to same team/)
  })

  it('library_parent_same_team_insert: nesting a child in the SAME team is allowed', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertTeam('teamA', 'Team A')
    await insertLibrary('lib1', 'u1', 'Parent', 'action', 'teamA')
    const now = Date.now()
    await expect(
      rawQuery(
        `INSERT INTO library (id, "createdByUserId", "teamId", "parentLibraryId", name, "entityType", version, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'action', '1.0.0', $6, $7)`,
        ['lib2', 'u1', 'teamA', 'lib1', 'Child', now, now],
      ),
    ).resolves.toBeInstanceOf(Array)
  })

  it('library has no isShared column (retired in slice 6b)', async () => {
    const cols = await rawQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'library'`,
    )
    expect(cols.map((c) => c.column_name)).not.toContain('isShared')
  })

  it('library_unshare_blocked_by_refs trigger is gone (retired in slice 6b)', async () => {
    const rows = await rawQuery(
      `SELECT tgname FROM pg_catalog.pg_trigger WHERE tgname = 'library_unshare_blocked_by_refs'`,
    )
    expect(rows).toHaveLength(0)
  })
})

describe('specification triggers', () => {
  it('specification_immutable_columns: UPDATE OF libraryId is rejected', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertLibrary('lib1', 'u1', 'Lib 1')
    await insertLibrary('lib2', 'u1', 'Lib 2')
    await insertRootSpec('s1', 'lib1', 'Spec 1')
    await expect(rawQuery('UPDATE specification SET "libraryId" = $1 WHERE id = $2', ['lib2', 's1'])).rejects.toThrow(
      /immutable/,
    )
  })

  it('spec_root_consistency_insert: child with wrong rootSpecificationId is rejected', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertLibrary('lib1', 'u1', 'Lib 1')
    await insertRootSpec('s1', 'lib1', 'Spec 1')
    await insertRootSpec('s2', 'lib1', 'Spec 2')
    // child claims s2 as root but parent is s1 → root mismatch
    await expect(insertChildSpec('child1', 'lib1', 'Child 1', 's2', 's1')).rejects.toThrow(
      /child rootSpecificationId mismatch/,
    )
  })
})

describe('proxy_reference triggers', () => {
  it('proxy_ref_same_tree_insert: cross-tree proxy is rejected', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertLibrary('lib1', 'u1', 'Lib 1')
    await insertRootSpec('s1', 'lib1', 'Spec 1')
    await insertRootSpec('s2', 'lib1', 'Spec 2')
    await expect(
      rawQuery(
        'INSERT INTO proxy_reference ("parentSpecificationId", "nodeId", "targetSpecificationId") VALUES ($1, $2, $3)',
        ['s1', 'node1', 's2'],
      ),
    ).rejects.toThrow(/proxy reference crosses trees/)
  })
})

describe('image triggers', () => {
  it('image_insert_bumps_blob_refcount: insert bumps blob refCount', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertLibrary('lib1', 'u1', 'Lib 1')
    await insertRootSpec('s1', 'lib1', 'Spec 1')
    const now = Date.now()
    await rawQuery(
      'INSERT INTO image_blob ("contentHash", data, "mimeType", "byteSize", "createdAt", "refCount") VALUES ($1, $2, $3, $4, $5, $6)',
      ['hash1', Buffer.from('xxx'), 'image/png', 3, now, 0],
    )
    await rawQuery(
      'INSERT INTO image (id, "specificationId", filename, "mimeType", "contentHash", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)',
      ['img1', 's1', 'a.png', 'image/png', 'hash1', now],
    )
    const [blob] = await rawQuery<{ refCount: number }>('SELECT "refCount" FROM image_blob WHERE "contentHash" = $1', [
      'hash1',
    ])
    expect(Number(blob.refCount)).toBe(1)
  })

  it('image_delete_bumps_blob_refcount: delete decrements and removes orphan', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertLibrary('lib1', 'u1', 'Lib 1')
    await insertRootSpec('s1', 'lib1', 'Spec 1')
    const now = Date.now()
    await rawQuery(
      'INSERT INTO image_blob ("contentHash", data, "mimeType", "byteSize", "createdAt", "refCount") VALUES ($1, $2, $3, $4, $5, $6)',
      ['hash1', Buffer.from('xxx'), 'image/png', 3, now, 0],
    )
    await rawQuery(
      'INSERT INTO image (id, "specificationId", filename, "mimeType", "contentHash", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)',
      ['img1', 's1', 'a.png', 'image/png', 'hash1', now],
    )
    await rawQuery('DELETE FROM image WHERE id = $1', ['img1'])
    const rows = await rawQuery('SELECT 1 FROM image_blob WHERE "contentHash" = $1', ['hash1'])
    expect(rows).toHaveLength(0) // orphan auto-deleted by trigger
  })
})

describe('library_environment triggers', () => {
  it('libenv_target_must_be_environment: rejects non-environment target', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertLibrary('libA', 'u1', 'Workflow Lib A', 'workflow')
    await insertLibrary('libB', 'u1', 'Workflow Lib B', 'workflow')
    await expect(
      rawQuery('INSERT INTO library_environment ("libraryId", "environmentLibraryId") VALUES ($1, $2)', [
        'libA',
        'libB',
      ]),
    ).rejects.toThrow(/must reference an environment library/)
  })

  it('libenv_same_team: rejects env ref from a different team', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertUser('u2', 'u2@example.com')
    await insertTeam('teamA', 'Team A')
    await insertTeam('teamB', 'Team B')
    await insertLibrary('libEnv', 'u1', 'Env', 'environment', 'teamA')
    await insertLibrary('libWf', 'u2', 'Wf', 'workflow', 'teamB')
    await expect(
      rawQuery('INSERT INTO library_environment ("libraryId", "environmentLibraryId") VALUES ($1, $2)', [
        'libWf',
        'libEnv',
      ]),
    ).rejects.toThrow(/environment library must belong to the same team/)
  })

  it('libenv_same_team: binding an env library in the SAME team is allowed', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertTeam('teamA', 'Team A')
    await insertLibrary('libEnv', 'u1', 'Env', 'environment', 'teamA')
    await insertLibrary('libWf', 'u1', 'Wf', 'workflow', 'teamA')
    await expect(
      rawQuery('INSERT INTO library_environment ("libraryId", "environmentLibraryId") VALUES ($1, $2)', [
        'libWf',
        'libEnv',
      ]),
    ).resolves.toBeInstanceOf(Array)
  })
})

describe('specification_environment triggers', () => {
  it('specenv_root_only: rejects junction on a child spec', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertLibrary('lib1', 'u1', 'Lib 1')
    await insertLibrary('libEnv', 'u1', 'Env', 'environment')
    await insertRootSpec('s1', 'lib1', 'Spec 1')
    await insertChildSpec('child1', 'lib1', 'Child 1', 's1', 's1')
    await expect(
      rawQuery('INSERT INTO specification_environment ("specificationId", "environmentLibraryId") VALUES ($1, $2)', [
        'child1',
        'libEnv',
      ]),
    ).rejects.toThrow(/environment overrides allowed on root specs only/)
  })

  it('specenv_same_team: rejects env ref when env library is in a different team than the spec library', async () => {
    await insertUser('u1', 'u1@example.com')
    await insertUser('u2', 'u2@example.com')
    await insertTeam('teamA', 'Team A')
    await insertTeam('teamB', 'Team B')
    await insertLibrary('libWf', 'u1', 'Workflow', 'workflow', 'teamA')
    await insertLibrary('libEnv', 'u2', 'Env', 'environment', 'teamB')
    await insertRootSpec('specRoot', 'libWf', 'Root Spec')
    await expect(
      rawQuery('INSERT INTO specification_environment ("specificationId", "environmentLibraryId") VALUES ($1, $2)', [
        'specRoot',
        'libEnv',
      ]),
    ).rejects.toThrow(/environment library must belong to the same team/)
  })
})

describe('GLOBAL team triggers (spec 2026-10-12)', () => {
  it('library_global_entity_types: a workflow library cannot be inserted into GLOBAL', async () => {
    await insertTeam('team-global', 'GLOBAL')
    await insertUser('u1', 'u1@example.com')
    await expect(insertLibrary('libWf', 'u1', 'Wf', 'workflow', 'team-global')).rejects.toThrow(
      /workflow libraries cannot belong to GLOBAL/,
    )
  })

  it('library_global_entity_types: nor moved into GLOBAL', async () => {
    await insertTeam('team-global', 'GLOBAL')
    await insertUser('u1', 'u1@example.com')
    await insertLibrary('libWf', 'u1', 'Wf', 'workflow')
    await expect(rawQuery(`UPDATE library SET "teamId" = 'team-global' WHERE id = 'libWf'`)).rejects.toThrow(
      /workflow libraries cannot belong to GLOBAL/,
    )
  })

  it('action, environment and step libraries may live in GLOBAL', async () => {
    await insertTeam('team-global', 'GLOBAL')
    await insertUser('u1', 'u1@example.com')
    for (const t of ['action', 'environment', 'step']) {
      await expect(insertLibrary(`lib-${t}`, 'u1', t, t, 'team-global')).resolves.toBeUndefined()
    }
  })

  it('libenv_same_team: a workflow library may bind a GLOBAL environment library', async () => {
    await insertTeam('team-global', 'GLOBAL')
    await insertTeam('teamA', 'Team A')
    await insertUser('u1', 'u1@example.com')
    await insertLibrary('libEnv', 'u1', 'Env', 'environment', 'team-global')
    await insertLibrary('libWf', 'u1', 'Wf', 'workflow', 'teamA')
    await expect(
      rawQuery('INSERT INTO library_environment ("libraryId", "environmentLibraryId") VALUES ($1, $2)', [
        'libWf',
        'libEnv',
      ]),
    ).resolves.toBeInstanceOf(Array)
  })

  it('specenv_same_team: a root spec may bind a GLOBAL environment library', async () => {
    await insertTeam('team-global', 'GLOBAL')
    await insertTeam('teamA', 'Team A')
    await insertUser('u1', 'u1@example.com')
    await insertLibrary('libWf', 'u1', 'Workflow', 'workflow', 'teamA')
    await insertLibrary('libEnv', 'u1', 'Env', 'environment', 'team-global')
    await insertRootSpec('specRoot', 'libWf', 'Root Spec')
    await expect(
      rawQuery('INSERT INTO specification_environment ("specificationId", "environmentLibraryId") VALUES ($1, $2)', [
        'specRoot',
        'libEnv',
      ]),
    ).resolves.toBeInstanceOf(Array)
  })
})
