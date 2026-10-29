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

import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import JSZip from 'jszip'
import { createHmac, createHash } from 'node:crypto'
import { bootstrapDatabase, rawQuery } from '../../lib/db'

vi.mock('../../lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

import { backupFileSizeError, backupRoutes } from '../backup'
import { auth } from '../../lib/auth'
import { BACKUP_TABLES } from '../../backup/format'
import { seedGlobalTeam, seedRoles } from '../../lib/rbacSeed'
import { BACKUP_LIMITS, backupLimitError } from '../../backup/restoreV3'
import {
  MAX_BACKUP_UPLOAD_BYTES,
  MAX_BACKUP_ENTRIES,
  MAX_BACKUP_INFLATED_BYTES,
  MAX_BACKUP_JSON_BYTES,
  MAX_IMAGE_BYTES,
} from '../../limits'

const app = new Hono()
app.route('/api', backupRoutes)

const NOW = Date.now()

function mockAdmin() {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: 'u1', name: 'Admin', email: 'a@x.io', isAdministrator: true },
    session: { id: 's1', userId: 'u1', token: 't1' },
  } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>)
}

// Children before parents so every DELETE is FK-safe.
const TABLES_TO_CLEAR = [
  'specification_environment',
  'library_environment',
  'proxy_reference',
  'image_reference',
  'image',
  'image_blob',
  'specification',
  'library',
  'user_team_role',
  'role_right',
  'role',
  'user_team',
  'app_setting',
  'session',
  'account',
  'verification',
  'team',
  'user',
]

beforeAll(async () => {
  await bootstrapDatabase()
})

beforeEach(async () => {
  vi.clearAllMocks()
  for (const t of TABLES_TO_CLEAR) await rawQuery(`DELETE FROM "${t}"`)
})

async function seedEverything(): Promise<void> {
  await rawQuery(
    `INSERT INTO "user" ("id","name","email","isAdministrator","createdAt","updatedAt") VALUES ('u1','Admin','a@x.io',true,$1,$1)`,
    [new Date(NOW)],
  )
  await rawQuery(
    `INSERT INTO "team" ("id","name","description","createdAt","updatedAt") VALUES ('t1','Team','',$1,$1)`,
    [NOW],
  )
  await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ('u1','t1')`)
  await rawQuery(`INSERT INTO "role" ("id","name","description","isSeeded") VALUES ('r1','Role','',0)`)
  await rawQuery(`INSERT INTO "role_right" ("roleId","right") VALUES ('r1','library.read')`)
  await rawQuery(`INSERT INTO "user_team_role" ("userId","teamId","roleId") VALUES ('u1','t1','r1')`)
  await rawQuery(`INSERT INTO "app_setting" ("key","value") VALUES ('k','v')`)
  for (const id of ['lib-1', 'lib-env']) {
    await rawQuery(
      `INSERT INTO "library" ("id","name","entityType","version","createdAt","updatedAt","teamId") VALUES ($1,$1,$3,'1.0.0',$2,$2,'t1')`,
      [id, NOW, id === 'lib-env' ? 'environment' : 'workflow'],
    )
  }
  for (const id of ['spec-1', 'spec-2']) {
    await rawQuery(
      `INSERT INTO "specification" ("id","libraryId","name","data","createdAt","updatedAt","state","history","rootSpecificationId") VALUES ($1,'lib-1',$1,'{"nodes":[]}',$2,$2,'Released','[{"a":1}]','spec-1')`,
      [id, NOW],
    )
  }
  // One blob shared by two specs through two image rows
  await rawQuery(
    `INSERT INTO "image_blob" ("contentHash","data","mimeType","byteSize","createdAt","refCount") VALUES ('h1',$1,'image/png',4,$2,2)`,
    [Buffer.from([9, 8, 7, 6]), NOW],
  )
  await rawQuery(
    `INSERT INTO "image" ("id","specificationId","filename","mimeType","contentHash","createdAt") VALUES ('i1','spec-1','p.png','image/png','h1',$1), ('i2','spec-2','p.png','image/png','h1',$1)`,
    [NOW],
  )
  await rawQuery(`INSERT INTO "image_reference" ("specificationId","imageId") VALUES ('spec-1','i1')`)
  await rawQuery(
    `INSERT INTO "proxy_reference" ("parentSpecificationId","nodeId","targetSpecificationId") VALUES ('spec-1','n1','spec-2')`,
  )
  await rawQuery(`INSERT INTO "library_environment" ("libraryId","environmentLibraryId") VALUES ('lib-1','lib-env')`)
  await rawQuery(
    `INSERT INTO "specification_environment" ("specificationId","environmentLibraryId") VALUES ('spec-1','lib-env')`,
  )
  // Auth tables that must never be exported
  await rawQuery(`INSERT INTO "session" ("id","userId","token","expiresAt") VALUES ('s1','u1','tok',$1)`, [
    new Date(NOW + 100000),
  ])
  await rawQuery(
    `INSERT INTO "account" ("id","userId","accountId","providerId","password") VALUES ('ac1','u1','a','credential','hash')`,
  )
}

describe('GET /api/backup (format version 3)', () => {
  it('exports every table, blob bytes with matching hashes, and a valid signature', async () => {
    await seedEverything()
    mockAdmin()

    const res = await app.fetch(new Request('http://localhost/api/backup'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="trajectory-backup-\d{4}-\d{2}-\d{2}\.bpbackup"$/,
    )
    const zip = await JSZip.loadAsync(await res.arrayBuffer())

    const text = await zip.file('backup.json')!.async('string')
    const body = JSON.parse(text) as {
      version: number
      tables: Record<string, Record<string, unknown>[]>
      blobs: { id: string; entry: string; sha256: string; [k: string]: unknown }[]
    }
    expect(body.version).toBe(3)

    const expected: Record<string, number> = {
      user: 1,
      team: 1,
      user_team: 1,
      role: 1,
      role_right: 1,
      user_team_role: 1,
      app_setting: 1,
      library: 2,
      specification: 2,
      image: 2,
      image_reference: 1,
      proxy_reference: 1,
      library_environment: 1,
      specification_environment: 1,
    }
    for (const t of BACKUP_TABLES) expect(body.tables[t], t).toHaveLength(expected[t])
    expect(Object.keys(body.tables).sort()).toEqual([...BACKUP_TABLES].sort())
    for (const forbidden of ['session', 'account', 'verification', 'image_blob']) {
      expect(body.tables).not.toHaveProperty(forbidden)
    }
    expect(JSON.stringify(body.tables.user[0])).not.toMatch(/password|hash/)

    // Every column is exported (camelCase property names); data stays a parsed object
    const spec = body.tables.specification.find((s) => s.id === 'spec-1')!
    expect(spec).toMatchObject({
      state: 'Released',
      version: '1.0.0',
      dataSchemaVersion: 3,
      history: '[{"a":1}]',
      data: { nodes: [] },
    })

    // Two specs, one blob
    expect(body.blobs).toHaveLength(1)
    const blob = body.blobs[0]
    const [dbBlob] = await rawQuery<{ mimeType: string; createdAt: string | number; refCount: number }>(
      `SELECT "mimeType", "createdAt", "refCount" FROM "image_blob" WHERE "contentHash" = 'h1'`,
    )
    // Every image_blob column except the bytes survives, equal to the stored row
    expect(blob).toMatchObject({
      id: 'h1',
      entry: 'blobs/h1',
      byteLength: 4,
      mimeType: 'image/png',
      createdAt: NOW,
      refCount: Number(dbBlob!.refCount),
    })
    expect(Number(dbBlob!.createdAt)).toBe(NOW)
    const bytes = await zip.file(blob.entry)!.async('uint8array')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(blob.sha256)

    const sig = JSON.parse(await zip.file('signature.json')!.async('string')) as { signature: string }
    const secret = process.env.BETTER_AUTH_SECRET || 'dev-only-insecure-key'
    expect(sig.signature).toBe(createHmac('sha256', secret).update(text).digest('hex'))
  })

  it('returns 401 when unauthenticated and 403 for non-administrators', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as Awaited<ReturnType<typeof auth.api.getSession>>)
    expect((await app.fetch(new Request('http://localhost/api/backup'))).status).toBe(401)
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'u2', email: 'b@x.io', isAdministrator: false },
      session: { id: 's', userId: 'u2', token: 't' },
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>)
    expect((await app.fetch(new Request('http://localhost/api/backup'))).status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Restore (format version 3) and inspect
// ---------------------------------------------------------------------------

const STATES = ['Draft', 'InTest', 'InReview', 'Approved', 'Effective', 'Superseded', 'Obsolete']
// Real image headers, stored under their sha256 like every Designer blob.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3])
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const H1 = sha(PNG)
const H2 = sha(JPEG)
const SECRET = process.env.BETTER_AUTH_SECRET || 'dev-only-insecure-key'

function mockSessionUser(id: string, email: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id, name: id, email, isAdministrator: true },
    session: { id: `s-${id}`, userId: id, token: `t-${id}` },
  } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>)
}

/** Seeds every table: child specs, all seven states, history, a shared image, proxy and env links, roles. */
async function seedFull(): Promise<void> {
  await rawQuery(
    `INSERT INTO "user" ("id","name","email","emailVerified","isAdministrator","createdAt","updatedAt") VALUES
     ('u1','Admin','a@x.io',true,true,$1,$1), ('u2','Bob','b@x.io',false,false,$1,$1)`,
    [new Date(NOW)],
  )
  await seedGlobalTeam()
  await seedRoles()
  await rawQuery(
    `INSERT INTO "team" ("id","name","description","createdAt","updatedAt") VALUES ('t1','Team','d',$1,$1)`,
    [NOW],
  )
  await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ('u1','t1'), ('u2','t1')`)
  await rawQuery(`INSERT INTO "role" ("id","name","description","isSeeded") VALUES ('r1','Custom','',0)`)
  await rawQuery(`INSERT INTO "role_right" ("roleId","right") VALUES ('r1','library.read')`)
  await rawQuery(
    `INSERT INTO "user_team_role" ("userId","teamId","roleId") VALUES ('u2','t1','r1'), ('u2','t1','role-author')`,
  )
  await rawQuery(
    `INSERT INTO "app_setting" ("key","value") VALUES ('editLockedStates','["Approved","Effective"]'), ('esignatureRoles','[]')`,
  )
  await rawQuery(
    `INSERT INTO "library" ("id","name","entityType","version","createdAt","updatedAt","teamId","environmentLibraryIds","lastEditedByUserId","createdByUserId")
     VALUES ('lib-env','Env','environment','1.0.0',$1,$1,'team-global',NULL,NULL,NULL),
            ('lib-1','Lib','workflow','2.0.0',$1,$1,'t1','["lib-env"]','u2','u2'),
            ('lib-act','Act','action','1.0.0',$1,$1,'t1',NULL,NULL,NULL)`,
    [NOW],
  )
  await rawQuery(
    `INSERT INTO "library" ("id","parentLibraryId","name","entityType","version","createdAt","updatedAt","teamId")
     VALUES ('lib-act-child','lib-act','Child','action','1.0.0',$1,$1,'t1')`,
    [NOW],
  )
  for (const state of STATES) {
    const id = `spec-${state}`
    await rawQuery(
      `INSERT INTO "specification" ("id","libraryId","name","data","createdAt","updatedAt","state","history","rootSpecificationId","version","environmentLibraryIds","effectiveFrom","lastEditedByUserId","typeName")
       VALUES ($1,'lib-1',$1,$2,$3,$3,$4,'[{"version":"1.0.0","state":"Draft"}]',$1,'1.2.0','["lib-env"]',$5,'u2','Batch')`,
      [id, JSON.stringify({ nodes: [{ id: 'n1' }] }), NOW, state, state === 'Effective' ? NOW : null],
    )
  }
  await rawQuery(
    `INSERT INTO "specification" ("id","libraryId","name","data","createdAt","updatedAt","parentSpecificationId","rootSpecificationId")
     VALUES ('child-1','lib-1','child','{}',$1,$1,'spec-Draft','spec-Draft')`,
    [NOW],
  )
  await rawQuery(
    `INSERT INTO "specification" ("id","libraryId","name","data","createdAt","updatedAt","parentSpecificationId","rootSpecificationId")
     VALUES ('grandchild-1','lib-1','grandchild','{}',$1,$1,'child-1','spec-Draft')`,
    [NOW],
  )
  await rawQuery(
    `INSERT INTO "image_blob" ("contentHash","data","mimeType","byteSize","createdAt","refCount") VALUES
     ($4,$1,'image/png',12,$3,0), ($5,$2,'image/jpeg',6,$3,0)`,
    [PNG, JPEG, NOW, H1, H2],
  )
  await rawQuery(
    `INSERT INTO "image" ("id","specificationId","filename","mimeType","contentHash","createdAt") VALUES
     ('i1','spec-Draft','p.png','image/png',$2,$1), ('i2','spec-Effective','p.png','image/png',$2,$1),
     ('i3','child-1','q.jpg','image/jpeg',$3,$1)`,
    [NOW, H1, H2],
  )
  await rawQuery(
    `INSERT INTO "image_reference" ("specificationId","imageId") VALUES ('spec-Draft','i1'), ('child-1','i3')`,
  )
  await rawQuery(
    `INSERT INTO "proxy_reference" ("parentSpecificationId","nodeId","targetSpecificationId") VALUES ('spec-Draft','n1','child-1'), ('child-1','n2','grandchild-1')`,
  )
  await rawQuery(`INSERT INTO "library_environment" ("libraryId","environmentLibraryId") VALUES ('lib-1','lib-env')`)
  await rawQuery(
    `INSERT INTO "specification_environment" ("specificationId","environmentLibraryId") VALUES ('spec-Draft','lib-env')`,
  )
  await rawQuery(`INSERT INTO "session" ("id","userId","token","expiresAt") VALUES ('s1','u1','tok',$1)`, [
    new Date(NOW + 100000),
  ])
  await rawQuery(
    `INSERT INTO "account" ("id","userId","accountId","providerId","password") VALUES ('ac1','u1','a','credential','hash'), ('ac2','u2','b','credential','hash2')`,
  )
}

/** Every backed-up table plus image_blob, each as a sorted list of JSON rows. */
async function snapshot(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const t of [...BACKUP_TABLES, 'image_blob']) {
    const rows = await rawQuery<Record<string, unknown>>(`SELECT * FROM "${t}"`)
    out[t] = rows
      .map((r) => {
        const plain: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(r)) plain[k] = v instanceof Uint8Array ? Array.from(v) : v
        return JSON.stringify(plain, Object.keys(plain).sort())
      })
      .sort()
  }
  return out
}

/** Deletes every Designer row except u1 and their session (what an emptied install looks like). */
async function clearAllButU1(): Promise<void> {
  for (const t of TABLES_TO_CLEAR) {
    if (t === 'user') await rawQuery(`DELETE FROM "user" WHERE "id" <> 'u1'`)
    else if (t === 'session' || t === 'account') await rawQuery(`DELETE FROM "${t}" WHERE "userId" <> 'u1'`)
    else await rawQuery(`DELETE FROM "${t}"`)
  }
}

async function takeBackup(): Promise<ArrayBuffer> {
  const res = await app.fetch(new Request('http://localhost/api/backup'))
  expect(res.status).toBe(200)
  return res.arrayBuffer()
}

async function post(path: string, body: ArrayBuffer | Uint8Array): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: body as BodyInit,
    }),
  )
}

/** Re-zips a backup after `mutate` changes it. */
async function rezip(buffer: ArrayBuffer, mutate: (zip: JSZip) => Promise<void> | void): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer)
  await mutate(zip)
  return zip.generateAsync({ type: 'arraybuffer' })
}

async function resign(zip: JSZip, text: string, secret = SECRET): Promise<void> {
  zip.file('backup.json', text)
  zip.file(
    'signature.json',
    JSON.stringify({ algorithm: 'hmac-sha256', signature: createHmac('sha256', secret).update(text).digest('hex') }),
  )
}

describe('POST /api/backup/restore (format version 3)', () => {
  it('round trip restores an equal database', async () => {
    await seedFull()
    mockAdmin()
    const before = await snapshot()
    expect(before.image_blob.map((r) => (JSON.parse(r) as { refCount: number }).refCount).sort()).toEqual([1, 2])
    const buffer = await takeBackup()

    await clearAllButU1()
    const res = await post('/backup/restore', buffer)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; version: number; counts: Record<string, number> }
    expect(body).toMatchObject({ success: true, version: 3 })
    expect(body.counts).toMatchObject({ specification: 9, image: 3, image_blob: 2, proxy_reference: 2, user: 2 })

    const after = await snapshot()
    for (const t of Object.keys(before)) expect(after[t], t).toEqual(before[t])
  })

  it('a spec whose stored data is not valid JSON round-trips byte-identical, not as {}', async () => {
    await seedFull()
    mockAdmin()
    const corrupt = '{"nodes": [broken'
    await rawQuery(`UPDATE "specification" SET "data" = $1 WHERE "id" = 'spec-Draft'`, [corrupt])
    const before = await snapshot()
    const buffer = await takeBackup()
    const zip = await JSZip.loadAsync(buffer)
    const parsed = JSON.parse(await zip.file('backup.json')!.async('string')) as {
      tables: { specification: { id: string; data: unknown }[] }
    }
    expect(parsed.tables.specification.find((r) => r.id === 'spec-Draft')!.data).toBe(corrupt)

    await clearAllButU1()
    expect((await post('/backup/restore', buffer)).status).toBe(200)
    const rows = await rawQuery<{ data: string }>(`SELECT "data" FROM "specification" WHERE "id" = 'spec-Draft'`)
    expect(rows[0].data).toBe(corrupt)
    const after = await snapshot()
    for (const t of Object.keys(before)) expect(after[t], t).toEqual(before[t])
  })

  it('restores rows given in any order (children before parents in the file)', async () => {
    await seedFull()
    mockAdmin()
    const before = await snapshot()
    const buffer = await rezip(await takeBackup(), async (zip) => {
      const parsed = JSON.parse(await zip.file('backup.json')!.async('string')) as {
        tables: Record<string, unknown[]>
      }
      parsed.tables.specification.reverse()
      parsed.tables.library.reverse()
      await resign(zip, JSON.stringify(parsed, null, 2))
    })
    await clearAllButU1()
    expect((await post('/backup/restore', buffer)).status).toBe(200)
    expect(await snapshot()).toEqual(before)
  })

  it('restore over different content leaves only the backup content and no orphan blobs', async () => {
    await seedFull()
    mockAdmin()
    const before = await snapshot()
    const buffer = await takeBackup()

    await rawQuery(
      `INSERT INTO "team" ("id","name","description","createdAt","updatedAt") VALUES ('t9','Other','',$1,$1)`,
      [NOW],
    )
    await rawQuery(`INSERT INTO "role" ("id","name","description","isSeeded") VALUES ('r9','Other role','',0)`)
    await rawQuery(
      `INSERT INTO "library" ("id","name","entityType","version","createdAt","updatedAt","teamId") VALUES ('lib-x','X','workflow','1.0.0',$1,$1,'t9')`,
      [NOW],
    )
    await rawQuery(
      `INSERT INTO "specification" ("id","libraryId","name","data","createdAt","updatedAt","rootSpecificationId") VALUES ('spec-x','lib-x','x','{}',$1,$1,'spec-x')`,
      [NOW],
    )
    await rawQuery(
      `INSERT INTO "image_blob" ("contentHash","data","mimeType","byteSize","createdAt","refCount") VALUES ('hx',$1,'image/png',1,$2,0), ('h-orphan',$1,'image/png',1,$2,0)`,
      [Buffer.from([5]), NOW],
    )
    await rawQuery(
      `INSERT INTO "image" ("id","specificationId","filename","mimeType","contentHash","createdAt") VALUES ('ix','spec-x','x.png','image/png','hx',$1)`,
      [NOW],
    )
    await rawQuery(`INSERT INTO "app_setting" ("key","value") VALUES ('stray','1')`)
    await rawQuery(`DELETE FROM "proxy_reference" WHERE "targetSpecificationId" = 'grandchild-1'`)
    await rawQuery(`DELETE FROM "specification" WHERE "id" = 'grandchild-1'`)

    expect((await post('/backup/restore', buffer)).status).toBe(200)
    expect(await snapshot()).toEqual(before)
    const blobs = await rawQuery<{ contentHash: string; refCount: number }>(
      `SELECT "contentHash","refCount" FROM "image_blob" ORDER BY "contentHash"`,
    )
    expect(blobs).toEqual(
      [
        { contentHash: H1, refCount: 2 },
        { contentHash: H2, refCount: 1 },
      ].sort((a, b) => a.contentHash.localeCompare(b.contentHash)),
    )
    // A user in the backup keeps their password
    const accounts = await rawQuery<{ id: string }>(`SELECT "id" FROM "account" ORDER BY "id"`)
    expect(accounts.map((a) => a.id)).toEqual(['ac1', 'ac2'])
  })

  it('an admin not in the backup stays signed in', async () => {
    await seedFull()
    mockAdmin()
    const buffer = await takeBackup()

    await rawQuery(
      `INSERT INTO "user" ("id","name","email","isAdministrator","createdAt","updatedAt") VALUES ('adm2','New admin','n@x.io',true,$1,$1)`,
      [new Date(NOW)],
    )
    await rawQuery(`INSERT INTO "session" ("id","userId","token","expiresAt") VALUES ('s-adm2','adm2','tok2',$1)`, [
      new Date(NOW + 100000),
    ])
    mockSessionUser('adm2', 'n@x.io')
    expect((await post('/backup/restore', buffer)).status).toBe(200)

    const sessions = await rawQuery<{ id: string }>(`SELECT "id" FROM "session" WHERE "userId" = 'adm2'`)
    expect(sessions).toHaveLength(1)
    const res = await app.fetch(new Request('http://localhost/api/backup'))
    expect(res.status).toBe(200)
    const users = await rawQuery<{ id: string }>(`SELECT "id" FROM "user" ORDER BY "id"`)
    expect(users.map((u) => u.id)).toEqual(['adm2', 'u1', 'u2'])
    const roles = await rawQuery<{ userId: string; roleId: string }>(
      `SELECT "userId","roleId" FROM "user_team_role" ORDER BY "roleId"`,
    )
    expect(roles).toEqual([
      { userId: 'u2', roleId: 'r1' },
      { userId: 'u2', roleId: 'role-author' },
    ])
  })

  it('a backup user with the restoring admin email becomes that admin', async () => {
    await seedFull()
    mockAdmin()
    const buffer = await takeBackup()
    await clearAllButU1()
    // A fresh install whose admin has the same email as the backup's u1 but a new id
    await rawQuery(`DELETE FROM "user"`)
    await rawQuery(
      `INSERT INTO "user" ("id","name","email","isAdministrator","createdAt","updatedAt") VALUES ('fresh','Fresh','a@x.io',true,$1,$1)`,
      [new Date(NOW)],
    )
    mockSessionUser('fresh', 'a@x.io')
    const res = await post('/backup/restore', buffer)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings: string[] }
    expect(body.warnings.some((w) => w.includes('a@x.io'))).toBe(true)
    const users = await rawQuery<{ id: string }>(`SELECT "id" FROM "user" ORDER BY "id"`)
    expect(users.map((u) => u.id)).toEqual(['fresh', 'u2'])
    const teams = await rawQuery<{ userId: string }>(`SELECT "userId" FROM "user_team" ORDER BY "userId"`)
    expect(teams.map((t) => t.userId)).toEqual(['fresh', 'u2'])
  })

  it("a backup user whose email differs only in case from the signed-in admin's is merged into that admin", async () => {
    await seedFull()
    mockAdmin()
    const buffer = await takeBackup()
    const upper = await rezip(buffer, async (zip) => {
      const parsed = JSON.parse(await zip.file('backup.json')!.async('string')) as {
        tables: Record<string, Record<string, unknown>[]>
      }
      for (const u of parsed.tables.user) if (u.id === 'u1') u.email = 'A@X.io'
      await resign(zip, JSON.stringify(parsed, null, 2))
    })
    await clearAllButU1()
    await rawQuery(`DELETE FROM "user"`)
    await rawQuery(
      `INSERT INTO "user" ("id","name","email","isAdministrator","createdAt","updatedAt") VALUES ('fresh','Fresh','a@x.io',true,$1,$1)`,
      [new Date(NOW)],
    )
    mockSessionUser('fresh', 'a@x.io')
    const res = await post('/backup/restore', upper)
    expect(res.status).toBe(200)
    const users = await rawQuery<{ id: string }>(`SELECT "id" FROM "user" ORDER BY "id"`)
    expect(users.map((u) => u.id)).toEqual(['fresh', 'u2'])
  })

  const DIFFERENT = (email: string) =>
    `User ${email}: restored without a password (its id belonged to a different account here). Set a password in Admin → Accounts.`

  it("a backup user whose id belongs to a different local account is restored without that account's password", async () => {
    await seedFull()
    mockAdmin()
    const buffer = await takeBackup()
    await rawQuery(`UPDATE "user" SET "email" = 'other@x.io' WHERE "id" = 'u2'`)
    await rawQuery(
      `INSERT INTO "account" ("id","userId","providerId","accountId","password") VALUES ('acc-u2','u2','credential','u2','local-hash')`,
    )
    const res = await post('/backup/restore', buffer)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings: string[] }
    const [u2] = await rawQuery<{ email: string }>(`SELECT "email" FROM "user" WHERE "id" = 'u2'`)
    expect(u2.email).toBe('b@x.io')
    expect(await rawQuery(`SELECT "id" FROM "account" WHERE "userId" = 'u2'`)).toHaveLength(0)
    expect(body.warnings).toContain(DIFFERENT('b@x.io'))
  })

  it('same id and same email keeps the password', async () => {
    await seedFull()
    mockAdmin()
    const buffer = await takeBackup()
    await rawQuery(
      `INSERT INTO "account" ("id","userId","providerId","accountId","password") VALUES ('acc-u2','u2','credential','u2','local-hash')`,
    )
    const res = await post('/backup/restore', buffer)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings: string[] }
    const rows = await rawQuery<{ password: string }>(`SELECT "password" FROM "account" WHERE "id" = 'acc-u2'`)
    expect(rows).toEqual([{ password: 'local-hash' }])
    expect(body.warnings.some((w) => w.includes('different account'))).toBe(false)
  })

  it('email case does not split a person', async () => {
    await seedFull()
    mockAdmin()
    const buffer = await takeBackup()
    await rawQuery(`UPDATE "user" SET "email" = 'B@X.io' WHERE "id" = 'u2'`)
    await rawQuery(
      `INSERT INTO "account" ("id","userId","providerId","accountId","password") VALUES ('acc-u2','u2','credential','u2','local-hash')`,
    )
    expect((await post('/backup/restore', buffer)).status).toBe(200)
    const rows = await rawQuery<{ password: string }>(`SELECT "password" FROM "account" WHERE "id" = 'acc-u2'`)
    expect(rows).toEqual([{ password: 'local-hash' }])
  })

  it("a backup user with the signed-in admin's id but another email gets a new id", async () => {
    await seedFull()
    mockAdmin()
    const buffer = await takeBackup()
    await rawQuery(`UPDATE "user" SET "email" = 'boss@x.io' WHERE "id" = 'u1'`)
    // The backup's u1 holds a team role, so the test can tell whose roles u1 ends up with.
    mockSessionUser('u1', 'boss@x.io')
    const withRole = await rezip(buffer, async (zip) => {
      const parsed = JSON.parse(await zip.file('backup.json')!.async('string')) as {
        tables: Record<string, Record<string, unknown>[]>
      }
      parsed.tables.user_team_role.push({ userId: 'u1', teamId: 't1', roleId: 'r1' })
      await resign(zip, JSON.stringify(parsed, null, 2))
    })
    const res = await post('/backup/restore', withRole)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings: string[] }

    const users = await rawQuery<{ id: string; email: string }>(`SELECT "id","email" FROM "user" ORDER BY "email"`)
    const fresh = users.find((u) => u.email === 'a@x.io')
    expect(fresh).toBeDefined()
    expect(fresh!.id).not.toBe('u1')
    expect(users.map((u) => [u.id === fresh!.id ? 'new' : u.id, u.email])).toEqual([
      ['new', 'a@x.io'],
      ['u2', 'b@x.io'],
      ['u1', 'boss@x.io'],
    ])
    const teams = await rawQuery<{ userId: string }>(`SELECT "userId" FROM "user_team" WHERE "teamId" = 't1'`)
    expect(teams.map((t) => t.userId).sort()).toEqual([fresh!.id, 'u2'].sort())
    expect(await rawQuery(`SELECT 1 FROM "user_team_role" WHERE "userId" = 'u1'`)).toHaveLength(0)
    expect(await rawQuery(`SELECT 1 FROM "user_team_role" WHERE "userId" = $1`, [fresh!.id])).toHaveLength(1)
    expect(body.warnings).toContain(DIFFERENT('a@x.io'))
  })

  it('every restored user without a password is reported', async () => {
    await seedFull()
    mockAdmin()
    const buffer = await takeBackup()
    await clearAllButU1()
    const res = await post('/backup/restore', buffer)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings: string[] }
    expect(body.warnings).toContain('User b@x.io: has no password on this install. Set one in Admin → Accounts.')
    expect(body.warnings.some((w) => w.startsWith('User a@x.io'))).toBe(false)
  })

  it('a file signed by another install needs the flag', async () => {
    await seedFull()
    mockAdmin()
    const buffer = await rezip(await takeBackup(), async (zip) => {
      await resign(zip, await zip.file('backup.json')!.async('string'), 'another-install-secret')
    })
    const refused = await post('/backup/restore', buffer)
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'signature_mismatch' })
    expect((await post('/backup/restore?acceptForeignSignature=1', buffer)).status).toBe(200)
  })

  it('a changed image entry is a mismatch', async () => {
    await seedFull()
    mockAdmin()
    const buffer = await rezip(await takeBackup(), async (zip) => {
      const bytes = await zip.file(`blobs/${H1}`)!.async('uint8array')
      bytes[0] ^= 0xff
      zip.file(`blobs/${H1}`, bytes)
    })
    const inspect = await post('/backup/inspect', buffer)
    expect(inspect.status).toBe(200)
    expect(((await inspect.json()) as { signature: string }).signature).toBe('mismatch')
    expect((await post('/backup/restore', buffer)).status).toBe(409)
  })

  it('a file without signature.json is refused', async () => {
    await seedFull()
    mockAdmin()
    const buffer = await rezip(await takeBackup(), (zip) => {
      zip.remove('signature.json')
    })
    expect((await post('/backup/inspect', buffer)).status).toBe(422)
    expect((await post('/backup/restore', buffer)).status).toBe(422)
  })

  it('inspect reports version and counts for v3 and v2 files', async () => {
    await seedFull()
    mockAdmin()
    const v3 = await post('/backup/inspect', await takeBackup())
    expect(v3.status).toBe(200)
    const v3Body = (await v3.json()) as { version: number; signature: string; counts: Record<string, number> }
    expect(v3Body).toMatchObject({ version: 3, signature: 'match' })
    expect(v3Body.counts).toMatchObject({ user: 2, specification: 9, image: 3, image_blob: 2, library: 4 })

    const zip = new JSZip()
    await resign(zip, JSON.stringify({ version: 2, users: [{ id: 'x' }], libraries: [{}, {}], specifications: [] }))
    const v2 = await post('/backup/inspect', await zip.generateAsync({ type: 'arraybuffer' }))
    expect(await v2.json()).toEqual({
      version: 2,
      signature: 'match',
      counts: { user: 1, library: 2, specification: 0 },
    })
    // Inspecting changes nothing
    expect(await rawQuery(`SELECT 1 FROM "specification"`)).toHaveLength(9)
  })

  it('oversized and bomb uploads are refused', async () => {
    mockAdmin()
    const huge = new Uint8Array(100 * 1024 * 1024 + 1)
    const refused = await post('/backup/restore', huge)
    expect(refused.status).toBe(413)
    const refusedBody = (await refused.json()) as { error: string; code: string; message: string }
    expect(refusedBody).toMatchObject({ error: 'backup_too_large', code: 'backup_too_large' })
    expect(refusedBody.message).toMatch(/larger than the Designer can restore/)
    const refusedInspect = await post('/backup/inspect', huge)
    expect(refusedInspect.status).toBe(413)
    expect(((await refusedInspect.json()) as { error: string }).error).toBe('backup_too_large')

    const bomb = new JSZip()
    await resign(bomb, JSON.stringify({ version: 3, exportedAt: '', tables: {}, blobs: [] }))
    bomb.file('blobs/zero', new Uint8Array(11 * 1024 * 1024))
    const bombBytes = await bomb.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
    expect(bombBytes.byteLength).toBeLessThan(1024 * 1024)
    expect((await post('/backup/inspect', bombBytes)).status).toBe(413)
    expect((await post('/backup/restore', bombBytes)).status).toBe(413)
  })

  /** Rewrites one blob's bytes and recorded type in a fresh backup, re-signed so only the image differs. */
  async function backupWithBlob(bytes: Uint8Array, mimeType: string, rehash: boolean): Promise<ArrayBuffer> {
    return rezip(await takeBackup(), async (zip) => {
      const parsed = JSON.parse(await zip.file('backup.json')!.async('string')) as {
        blobs: { id: string; entry: string; sha256: string; mimeType: string }[]
      }
      const blob = parsed.blobs.find((b) => b.id === H1)!
      blob.mimeType = mimeType
      if (rehash) blob.sha256 = sha(bytes)
      zip.file(blob.entry, bytes)
      await resign(zip, JSON.stringify(parsed, null, 2))
    })
  }

  it('a blob that is not an image is skipped with its image rows', async () => {
    await seedFull()
    mockAdmin()
    const buffer = await backupWithBlob(Buffer.from('<html><script>alert(1)</script></html>'), 'text/html', true)
    const res = await post('/backup/restore?acceptForeignSignature=1', buffer)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings: string[] }
    expect(body.warnings).toContain('Skipped image "p.png": not a PNG, JPEG, WebP or GIF image.')
    const images = await rawQuery<{ id: string }>(`SELECT "id" FROM "image" ORDER BY "id"`)
    expect(images.map((i) => i.id)).toEqual(['i3'])
    expect(await rawQuery(`SELECT 1 FROM "image_reference" WHERE "imageId" = 'i1'`)).toHaveLength(0)
    expect(await rawQuery(`SELECT 1 FROM "image_blob" WHERE "mimeType" = 'text/html'`)).toHaveLength(0)
  })

  it('a PNG labelled image/svg+xml is stored as image/png', async () => {
    await seedFull()
    mockAdmin()
    const buffer = await backupWithBlob(PNG, 'image/svg+xml', false)
    expect((await post('/backup/restore', buffer)).status).toBe(200)
    const [blob] = await rawQuery<{ mimeType: string }>(
      `SELECT "mimeType" FROM "image_blob" WHERE "contentHash" = $1`,
      [H1],
    )
    expect(blob.mimeType).toBe('image/png')
    const types = await rawQuery<{ mimeType: string }>(
      `SELECT DISTINCT "mimeType" FROM "image" WHERE "contentHash" = $1`,
      [H1],
    )
    expect(types).toEqual([{ mimeType: 'image/png' }])
  })

  it('an image row labelled image/svg+xml takes its blob type', async () => {
    await seedFull()
    mockAdmin()
    const buffer = await rezip(await takeBackup(), async (zip) => {
      const parsed = JSON.parse(await zip.file('backup.json')!.async('string')) as {
        tables: { image: { id: string; mimeType: string }[] }
      }
      parsed.tables.image.find((i) => i.id === 'i1')!.mimeType = 'image/svg+xml'
      await resign(zip, JSON.stringify(parsed, null, 2))
    })
    expect((await post('/backup/restore', buffer)).status).toBe(200)
    const [row] = await rawQuery<{ mimeType: string }>(`SELECT "mimeType" FROM "image" WHERE "id" = 'i1'`)
    expect(row.mimeType).toBe('image/png')
  })

  it('a changed blob accepted with the flag lands under its real hash', async () => {
    await seedFull()
    mockAdmin()
    const changed = Buffer.from(PNG)
    changed[changed.length - 1] ^= 0xff
    const buffer = await backupWithBlob(changed, 'image/png', false)
    expect((await post('/backup/restore', buffer)).status).toBe(409)
    expect((await post('/backup/restore?acceptForeignSignature=1', buffer)).status).toBe(200)
    expect(await rawQuery(`SELECT 1 FROM "image_blob" WHERE "contentHash" = $1`, [H1])).toHaveLength(0)
    const [blob] = await rawQuery<{ refCount: number }>(
      `SELECT "refCount" FROM "image_blob" WHERE "contentHash" = $1`,
      [sha(changed)],
    )
    expect(blob.refCount).toBe(2)
    const images = await rawQuery<{ id: string }>(`SELECT "id" FROM "image" WHERE "contentHash" = $1 ORDER BY "id"`, [
      sha(changed),
    ])
    expect(images.map((i) => i.id)).toEqual(['i1', 'i2'])
  })

  it('an empty or unreadable signature.json is refused like a missing one', async () => {
    await seedFull()
    mockAdmin()
    const backup = await takeBackup()
    for (const content of ['', '{}', 'not json', '{"signature":""}']) {
      const buffer = await rezip(backup, (zip) => {
        zip.file('signature.json', content)
      })
      expect((await post('/backup/inspect', buffer)).status, content).toBe(422)
      expect((await post('/backup/restore?acceptForeignSignature=1', buffer)).status, content).toBe(422)
    }
  })

  it('only versions 1, 2 and 3 are accepted, and responses report the real version', async () => {
    mockAdmin()
    for (const version of [0, 4, 2.5, '3']) {
      const zip = new JSZip()
      await resign(zip, JSON.stringify({ version, users: [], libraries: [], specifications: [] }))
      const buffer = await zip.generateAsync({ type: 'arraybuffer' })
      const res = await post('/backup/inspect', buffer)
      expect(res.status, String(version)).toBe(422)
      expect(await res.json()).toEqual({ error: 'unsupported_backup_version' })
      expect((await post('/backup/restore', buffer)).status).toBe(422)
    }
    await rawQuery(
      `INSERT INTO "user" ("id","name","email","isAdministrator","createdAt","updatedAt") VALUES ('u1','Admin','a@x.io',true,$1,$1)`,
      [new Date(NOW)],
    )
    for (const version of [1, 2]) {
      const zip = new JSZip()
      await resign(zip, JSON.stringify({ version, users: [], libraries: [], specifications: [] }))
      const res = await post('/backup/restore', await zip.generateAsync({ type: 'arraybuffer' }))
      expect(res.status).toBe(200)
      expect(((await res.json()) as { version: number }).version).toBe(version)
    }
  })

  it('a v2 file whose backup.json inflates past 100 MB restores', { timeout: 120_000 }, async () => {
    await rawQuery(
      `INSERT INTO "user" ("id","name","email","isAdministrator","createdAt","updatedAt") VALUES ('u1','Admin','a@x.io',true,$1,$1)`,
      [new Date(NOW)],
    )
    mockAdmin()
    const zip = new JSZip()
    const padding = 'x'.repeat(101 * 1024 * 1024)
    await resign(zip, JSON.stringify({ version: 2, users: [], libraries: [], specifications: [], padding }))
    const buffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
    expect(buffer.byteLength).toBeLessThan(100 * 1024 * 1024)
    expect((await post('/backup/restore', buffer)).status).toBe(200)
  })

  it('a backup over the entry limit is refused with 413', { timeout: 120_000 }, async () => {
    mockAdmin()
    const zip = new JSZip()
    await resign(zip, JSON.stringify({ version: 3, exportedAt: '', tables: {}, blobs: [] }))
    for (let i = 0; i < MAX_BACKUP_ENTRIES; i++) zip.file(`blobs/b${i}`, '')
    const res = await post('/backup/restore', await zip.generateAsync({ type: 'arraybuffer' }))
    expect(res.status).toBe(413)
  })

  it('the export refuses content a restore could not take', async () => {
    const limits = { entries: 10, totalBytes: 1000, jsonBytes: 500, blobBytes: 100 }
    expect(backupLimitError(10, 500, [100, 100], limits)).toBeNull()
    expect(backupLimitError(11, 10, [], limits)).toMatch(/11 files/)
    expect(backupLimitError(3, 501, [], limits)).toMatch(/data/)
    expect(backupLimitError(3, 10, [101], limits)).toMatch(/an image/)
    expect(backupLimitError(9, 500, [100, 100, 100, 100, 100, 100], limits)).toMatch(/in all/)
    // The real limits match the restore side
    expect(BACKUP_LIMITS).toEqual({
      entries: MAX_BACKUP_ENTRIES,
      totalBytes: MAX_BACKUP_INFLATED_BYTES,
      jsonBytes: MAX_BACKUP_JSON_BYTES,
      blobBytes: MAX_IMAGE_BYTES,
    })
  })

  it('GET /backup answers 413 backup_too_large when the content is over the limits', async () => {
    await seedFull()
    mockAdmin()
    // An image larger than any restore accepts (stored directly, past the upload checks)
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)])
    await rawQuery(
      `INSERT INTO "image_blob" ("contentHash","data","mimeType","byteSize","createdAt","refCount") VALUES ($1,$2,'image/png',$3,$4,0)`,
      [sha(big), big, big.length, NOW],
    )
    await rawQuery(
      `INSERT INTO "image" ("id","specificationId","filename","mimeType","contentHash","createdAt") VALUES ('ibig','spec-Draft','big.png','image/png',$1,$2)`,
      [sha(big), NOW],
    )
    const res = await app.fetch(new Request('http://localhost/api/backup'))
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: string; message: string }
    expect(body.error).toBe('backup_too_large')
    expect(body.message).toMatch(
      /^This Designer holds more than a backup can restore \(.+\)\. Contact support or remove unused images first\.$/,
    )
  })

  it('refuses a backup file larger than the upload cap, in the same 413 shape', () => {
    expect(backupFileSizeError(100, 100)).toBeNull()
    expect(backupFileSizeError(101 * 1024 * 1024, 100 * 1024 * 1024)).toMatch(
      /^This Designer holds more than a backup can restore \(the backup file is 101 MB, the limit is 100 MB\)\. Contact support or remove unused images first\.$/,
    )
    expect(MAX_BACKUP_UPLOAD_BYTES).toBe(100 * 1024 * 1024)
  })

  it('inspect is admin only', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as Awaited<ReturnType<typeof auth.api.getSession>>)
    expect((await post('/backup/inspect', new Uint8Array(4))).status).toBe(401)
  })
})
