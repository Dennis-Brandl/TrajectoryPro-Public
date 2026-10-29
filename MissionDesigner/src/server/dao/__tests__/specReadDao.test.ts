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
let ctxU1: import('../specReadDao').ReadContext
let ctxU2: import('../specReadDao').ReadContext

beforeAll(async () => {
  ;({ rawQuery, bootstrapDatabase } = await import('../../lib/db'))
  ;({ seedRoles } = await import('../../lib/rbacSeed'))
  await bootstrapDatabase()
  await seedRoles()
  ;({ specReadDao } = await import('../specReadDao'))
  ctxU1 = { sessionUserId: 'u1' }
  ctxU2 = { sessionUserId: 'u2' }
})

beforeEach(async () => {
  // FK-safe teardown — do not delete role/role_right/app_setting (seeded once in beforeAll).
  await rawQuery('DELETE FROM "user_team_role"')
  await rawQuery('DELETE FROM "user_team"')
  await rawQuery('DELETE FROM "image_reference"')
  await rawQuery('DELETE FROM "image"')
  await rawQuery('DELETE FROM "image_blob"')
  await rawQuery('DELETE FROM "proxy_reference"')
  await rawQuery('DELETE FROM "specification_environment"')
  await rawQuery('DELETE FROM "library_environment"')
  await rawQuery('DELETE FROM "specification"')
  await rawQuery('DELETE FROM "library"')
  await rawQuery('DELETE FROM "user"')
  await rawQuery('DELETE FROM "team"')

  const NOW = Date.now()
  for (const [id, email] of [
    ['u1', 'u1@x.com'],
    ['u2', 'u2@x.com'],
  ]) {
    await rawQuery(
      `INSERT INTO "user" ("id", "email", "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, false, $3, $4)`,
      [id, email, NOW, NOW],
    )
  }

  // Team mapping that mirrors what the old owner/isShared model expressed, now
  // expressed via team membership (visibility = membership of the library's owning team):
  //   tA      → u1 only        (holds libA + libD, u1's "owned" libraries)
  //   tShared → u1 AND u2      (holds libB, the "shared" library both can see)
  //   tB      → u2 only        (holds libC, u2's "private" library)
  // ⇒ u1 ∈ {tA, tShared} sees {libA, libB, libD}; u2 ∈ {tB, tShared} sees {libB, libC}.
  for (const [tid, name] of [
    ['tA', 'Team A'],
    ['tShared', 'Team Shared'],
    ['tB', 'Team B'],
  ] as const) {
    await rawQuery(
      `INSERT INTO "team" ("id", "name", "description", "createdAt", "updatedAt") VALUES ($1, $2, '', $3, $4)`,
      [tid, name, NOW, NOW],
    )
  }

  const addMember = async (uid: string, tid: string): Promise<void> => {
    await rawQuery(`INSERT INTO "user_team" ("userId", "teamId") VALUES ($1, $2)`, [uid, tid])
    // role-author grants <cat>:edit — harmless for the read-only cases, required
    // for any DAO write path exercised through these libraries.
    await rawQuery(`INSERT INTO "user_team_role" ("userId", "teamId", "roleId") VALUES ($1, $2, 'role-author')`, [
      uid,
      tid,
    ])
  }
  await addMember('u1', 'tA')
  await addMember('u1', 'tShared')
  await addMember('u2', 'tShared')
  await addMember('u2', 'tB')

  await rawQuery(
    `INSERT INTO "library" ("id", "teamId", "name", "entityType", "version", "createdAt", "updatedAt")
     VALUES ('libA','tA','Owned A','workflow','1.0.0',$1,$2)`,
    [NOW, NOW],
  )
  await rawQuery(
    `INSERT INTO "library" ("id", "teamId", "name", "entityType", "version", "createdAt", "updatedAt")
     VALUES ('libB','tShared','Shared B','workflow','1.0.0',$1,$2)`,
    [NOW, NOW],
  )
  await rawQuery(
    `INSERT INTO "library" ("id", "teamId", "name", "entityType", "version", "createdAt", "updatedAt")
     VALUES ('libC','tB','Private C','workflow','1.0.0',$1,$2)`,
    [NOW, NOW],
  )
  await rawQuery(
    `INSERT INTO "library" ("id", "teamId", "name", "entityType", "version", "createdAt", "updatedAt")
     VALUES ('libD','tA','My Env','environment','1.0.0',$1,$2)`,
    [NOW, NOW],
  )
})

describe('specReadDao.getLibrary', () => {
  it('returns library for owner', async () => {
    expect((await specReadDao.getLibrary(ctxU1, 'libA'))?.name).toBe('Owned A')
  })
  it('returns library when shared and caller is not owner', async () => {
    expect((await specReadDao.getLibrary(ctxU1, 'libB'))?.name).toBe('Shared B')
  })
  it('returns null for private non-owned library', async () => {
    expect(await specReadDao.getLibrary(ctxU1, 'libC')).toBeNull()
  })
  it('returns null for missing id', async () => {
    expect(await specReadDao.getLibrary(ctxU1, 'nope')).toBeNull()
  })
})

describe('specReadDao.listVisibleLibraries', () => {
  it('returns owned + shared libraries', async () => {
    const rows = await specReadDao.listVisibleLibraries(ctxU1, {})
    const ids = rows.map((r) => r.id).sort()
    expect(ids).toEqual(['libA', 'libB', 'libD'])
  })
  it('filters by entityType', async () => {
    const rows = await specReadDao.listVisibleLibraries(ctxU1, { entityType: 'environment' })
    expect(rows.map((r) => r.id)).toEqual(['libD'])
  })
  it('does not leak libC private of another user', async () => {
    const rows = await specReadDao.listVisibleLibraries(ctxU1, {})
    expect(rows.map((r) => r.id)).not.toContain('libC')
  })
  it('returns only shared libraries for a third party', async () => {
    const rows = await specReadDao.listVisibleLibraries(ctxU2, {})
    const ids = rows.map((r) => r.id).sort()
    expect(ids).toEqual(['libB', 'libC'])
  })
  it('orders owned first then shared', async () => {
    const rows = await specReadDao.listVisibleLibraries(ctxU1, {})
    // Team-model ordering is name ASC: My Env (libD), Owned A (libA), Shared B (libB).
    // The original ordering assertions still hold — libD (u1-team) sorts first and
    // libB sorts last — so the same expectations are preserved under the team model.
    expect(rows[0].id).toBe('libD')
    expect(rows[rows.length - 1].id).toBe('libB')
  })
})

describe('specReadDao.getSpec + listRootSpecs', () => {
  beforeEach(async () => {
    const NOW = Date.now()
    // Root spec in libA (owned by u1)
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('sA1','libA','Root A1','1.0.0','Draft','{"nodes":[]}','sA1',NULL,3,$1,$2)`,
      [NOW, NOW],
    )
    // Root spec in libC (private of u2)
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('sC1','libC','Root C1','1.0.0','Draft','{"nodes":[]}','sC1',NULL,3,$1,$2)`,
      [NOW, NOW],
    )
    // Root spec in libB (shared of u2)
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('sB1','libB','Root B1','1.0.0','Draft','{"nodes":[]}','sB1',NULL,3,$1,$2)`,
      [NOW, NOW],
    )
    // Child of sA1
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('sA1c1','libA','Child 1','1.0.0','Draft','{"nodes":[]}','sA1','sA1',3,$1,$2)`,
      [NOW, NOW],
    )
  })

  it('getSpec returns full data for owned root', async () => {
    const s = await specReadDao.getSpec(ctxU1, 'sA1')
    expect(s?.name).toBe('Root A1')
    expect(s?.data).toBe('{"nodes":[]}')
  })

  it('getSpec returns null for private non-owned', async () => {
    expect(await specReadDao.getSpec(ctxU1, 'sC1')).toBeNull()
  })

  it('getSpec returns shared spec to third party', async () => {
    expect((await specReadDao.getSpec(ctxU1, 'sB1'))?.name).toBe('Root B1')
  })

  it('getSpec returns child via root lib permission', async () => {
    expect((await specReadDao.getSpec(ctxU1, 'sA1c1'))?.name).toBe('Child 1')
  })

  it('listRootSpecs returns only root specs (parentSpecificationId IS NULL)', async () => {
    const rows = await specReadDao.listRootSpecs(ctxU1, 'libA')
    expect(rows.map((r) => r.id)).toEqual(['sA1'])
  })

  it('listRootSpecs returns empty array when caller lacks permission', async () => {
    expect(await specReadDao.listRootSpecs(ctxU1, 'libC')).toEqual([])
  })
})

describe('specReadDao.getTree', () => {
  beforeEach(async () => {
    const NOW = Date.now()
    // Build a 4-spec tree in libA: root → child1 → grandchild1, and child2
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('tree-root','libA','Tree Root','1.0.0','Draft','{"nodes":[]}','tree-root',NULL,3,$1,$2)`,
      [NOW, NOW],
    )
    for (const [id, name, parent] of [
      ['tree-c1', 'Child 1', 'tree-root'],
      ['tree-c2', 'Child 2', 'tree-root'],
      ['tree-gc1', 'Grandchild 1', 'tree-c1'],
    ] as const) {
      await rawQuery(
        `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
         "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
         VALUES ($1,'libA',$2,'1.0.0','Draft','{"nodes":[]}','tree-root',$3,3,$4,$5)`,
        [id, name, parent, NOW, NOW],
      )
    }
    // A proxy_reference from root → c1
    await rawQuery(
      `INSERT INTO "proxy_reference" ("parentSpecificationId", "nodeId", "targetSpecificationId") VALUES ('tree-root','n1','tree-c1')`,
    )
    // An image_blob + image on c2
    await rawQuery(
      `INSERT INTO "image_blob" ("contentHash", "data", "mimeType", "byteSize", "createdAt", "refCount")
       VALUES ('h1', $1, 'image/png', 1, $2, 0)`,
      [Buffer.from([0xff]), NOW],
    )
    await rawQuery(
      `INSERT INTO "image" ("id", "specificationId", "filename", "mimeType", "contentHash", "createdAt")
       VALUES ('i1','tree-c2','a.png','image/png','h1',$1)`,
      [NOW],
    )
  })

  it('returns root + all descendants', async () => {
    const tree = await specReadDao.getTree(ctxU1, 'tree-root')
    expect(tree).not.toBeNull()
    const ids = tree!.specs.map((s) => s.id).sort()
    expect(ids).toEqual(['tree-c1', 'tree-c2', 'tree-gc1', 'tree-root'])
  })

  it('returns proxy_reference rows', async () => {
    const tree = await specReadDao.getTree(ctxU1, 'tree-root')
    expect(tree?.proxyRefs).toHaveLength(1)
    expect(tree?.proxyRefs[0].targetSpecificationId).toBe('tree-c1')
  })

  it('returns image manifest keyed by spec id (no data)', async () => {
    const tree = await specReadDao.getTree(ctxU1, 'tree-root')
    expect(tree?.imageManifest['tree-c2']).toHaveLength(1)
    expect(tree?.imageManifest['tree-c2'][0].filename).toBe('a.png')
    // data is NOT returned in the manifest
    expect(tree?.imageManifest['tree-c2'][0]).not.toHaveProperty('data')
  })

  it('returns null for private non-owned root', async () => {
    // libC is private to u2; attempt as u1 → null
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('cRoot','libC','Private Root','1.0.0','Draft','{"nodes":[]}','cRoot',NULL,3,$1,$2)`,
      [NOW, NOW],
    )
    expect(await specReadDao.getTree(ctxU1, 'cRoot')).toBeNull()
  })

  it('resolves to the containing tree when called with a non-root descendant id', async () => {
    const result = await specReadDao.getTree(ctxU1, 'tree-c1')
    expect(result).not.toBeNull()
    // The resolved tree must include the root and every descendant.
    const ids = new Set(result!.specs.map((s) => s.id))
    expect(ids.has('tree-root')).toBe(true)
    expect(ids.has('tree-c1')).toBe(true)
  })
})

describe('specReadDao.getSpecs (bulk)', () => {
  beforeEach(async () => {
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('bulk-A','libA','Bulk A','1.0.0','Draft','{"nodes":[]}','bulk-A',NULL,3,$1,$2)`,
      [NOW, NOW],
    )
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('bulk-C','libC','Bulk C','1.0.0','Draft','{"nodes":[]}','bulk-C',NULL,3,$1,$2)`,
      [NOW, NOW],
    )
  })

  it('returns readable specs + missingIds for unreadable or nonexistent', async () => {
    const result = await specReadDao.getSpecs(ctxU1, ['bulk-A', 'bulk-C', 'nope'])
    expect([...result.specs.keys()]).toEqual(['bulk-A'])
    expect(result.missingIds.sort()).toEqual(['bulk-C', 'nope'].sort())
  })

  it('returns empty on empty id list', async () => {
    expect(await specReadDao.getSpecs(ctxU1, [])).toEqual({ specs: new Map(), missingIds: [] })
  })

  it('de-duplicates input ids in missingIds count', async () => {
    const result = await specReadDao.getSpecs(ctxU1, ['nope', 'nope', 'bulk-A'])
    expect(result.missingIds.length).toBe(1)
  })
})

describe('specReadDao.getImage + getImageManifest', () => {
  beforeEach(async () => {
    const NOW = Date.now()
    await rawQuery(
      `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion", "createdAt", "updatedAt")
       VALUES ('img-root','libA','Img Root','1.0.0','Draft','{"nodes":[]}','img-root',NULL,3,$1,$2)`,
      [NOW, NOW],
    )
    await rawQuery(
      `INSERT INTO "image_blob" ("contentHash", "data", "mimeType", "byteSize", "createdAt", "refCount")
       VALUES ('h1', $1, 'image/png', 1, $2, 0)`,
      [Buffer.from([0xff]), NOW],
    )
    await rawQuery(
      `INSERT INTO "image" ("id", "specificationId", "filename", "mimeType", "contentHash", "createdAt")
       VALUES ('im1','img-root','a.png','image/png','h1',$1)`,
      [NOW],
    )
  })

  it('getImage returns row for owned spec', async () => {
    const r = await specReadDao.getImage(ctxU1, 'img-root', 'a.png')
    expect(r?.id).toBe('im1')
    expect(r?.contentHash).toBe('h1')
  })

  it('getImage returns null for unreadable spec', async () => {
    expect(await specReadDao.getImage(ctxU2, 'img-root', 'a.png')).toBeNull()
  })

  it('getImageManifest returns manifest for accessible specs', async () => {
    const m = await specReadDao.getImageManifest(ctxU1, ['img-root'])
    expect(m['img-root']).toHaveLength(1)
    expect(m['img-root'][0].byteSize).toBe(1)
  })

  it('getImageManifest drops unreadable specs', async () => {
    const m = await specReadDao.getImageManifest(ctxU2, ['img-root'])
    expect(m).toEqual({})
  })
})
