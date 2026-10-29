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
import { eq } from 'drizzle-orm'
import JSZip from 'jszip'
import { createHmac } from 'node:crypto'

// ---------------------------------------------------------------------------
// Real PGlite-backed db — active when VITEST is set (see db.ts useMemoryDb).
// No vi.mock('../../lib/db') needed; the module self-selects PGlite in tests.
// ---------------------------------------------------------------------------

import { db, bootstrapDatabase, rawQuery } from '../../lib/db'

vi.mock('../../lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

// ---------------------------------------------------------------------------
// Import route and mocked deps AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { backupRoutes } from '../backup'
import { auth } from '../../lib/auth'
import { user, library, specification, session, account } from '../../db/schema'

// ---------------------------------------------------------------------------
// Test app — mounts backupRoutes under /api exactly as index.ts does
// ---------------------------------------------------------------------------

const app = new Hono()
app.route('/api', backupRoutes)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type UserRow = {
  id: string
  name: string
  email: string
  emailVerified?: number | null // kept as number for backward-compat opts; converted to boolean on insert
  image?: string | null
  isAdministrator: boolean
}

const NOW = Date.now()

function mockSession(userRow: UserRow) {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: userRow,
    session: { id: 'sess-1', userId: userRow.id, token: 'tok-1' },
  } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>)
}

function clearSession() {
  vi.mocked(auth.api.getSession).mockResolvedValue(null as Awaited<ReturnType<typeof auth.api.getSession>>)
}

async function requestGet(path: string) {
  return app.fetch(new Request(`http://localhost${path}`, { method: 'GET' }))
}

async function requestPostJson(path: string, body?: unknown) {
  const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  return app.fetch(new Request(`http://localhost${path}`, init))
}

async function requestPostBinary(path: string, buffer: ArrayBuffer) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
    }),
  )
}

/** Build a .bpbackup ZIP from a backup JSON object */
async function buildBackupZip(backupJson: Record<string, unknown>): Promise<ArrayBuffer> {
  const zip = new JSZip()
  const jsonText = JSON.stringify(backupJson)
  zip.file('backup.json', jsonText)
  // Sign the backup with the dev-only key (matches backup.ts signBackup logic)
  const secret = process.env.BETTER_AUTH_SECRET || 'dev-only-insecure-key'
  const signature = createHmac('sha256', secret).update(jsonText).digest('hex')
  zip.file('signature.json', JSON.stringify({ algorithm: 'hmac-sha256', signature }))
  return zip.generateAsync({ type: 'arraybuffer' })
}

/** Parse a backup response into its backup.json content */
async function parseBackupResponse(res: Response): Promise<Record<string, unknown>> {
  const buffer = await res.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)
  const jsonFile = zip.file('backup.json')
  if (!jsonFile) throw new Error('No backup.json in ZIP')
  const text = await jsonFile.async('string')
  return JSON.parse(text) as Record<string, unknown>
}

async function insertUser(id: string, email: string, opts: Partial<UserRow> = {}): Promise<UserRow> {
  await rawQuery(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "isAdministrator", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      opts.name ?? 'Test User',
      email,
      opts.emailVerified != null ? !!opts.emailVerified : null,
      opts.image ?? null,
      opts.isAdministrator ?? false,
      new Date(NOW),
      new Date(NOW),
    ],
  )
  return {
    id,
    name: opts.name ?? 'Test User',
    email,
    emailVerified: opts.emailVerified ?? null,
    image: opts.image ?? null,
    isAdministrator: opts.isAdministrator ?? false,
  }
}

async function insertLibrary(
  id: string,
  _userId: string,
  name: string,
  entityType = 'workflow',
  teamId = 'team-default',
  createdByUserId: string | null = null,
): Promise<void> {
  await rawQuery(
    `INSERT INTO "library" ("id", "name", "entityType", "version", "createdAt", "updatedAt", "teamId", "createdByUserId")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, name, entityType, '1.0.0', NOW, NOW, teamId, createdByUserId],
  )
}

async function insertSpecification(id: string, libraryId: string, name: string, data = '{}'): Promise<void> {
  await rawQuery(
    `INSERT INTO "specification" ("id", "libraryId", "name", "data", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, libraryId, name, data, NOW, NOW],
  )
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await bootstrapDatabase()
})

beforeEach(async () => {
  vi.clearAllMocks()
  // Clear all tables in FK-safe order
  await rawQuery('DELETE FROM "specification"')
  await rawQuery('DELETE FROM "library"')
  await rawQuery('DELETE FROM "session"')
  await rawQuery('DELETE FROM "account"')
  await rawQuery('DELETE FROM "user"')
  await rawQuery('DELETE FROM "team"')
  // Insert the default team referenced by all tests that insert libraries
  await rawQuery(
    `INSERT INTO "team" ("id", "name", "description", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5)`,
    ['team-default', 'Default Team', '', NOW, NOW],
  )
})

// ---------------------------------------------------------------------------
// Tests: GET /api/backup
// ---------------------------------------------------------------------------

describe('GET /api/backup', () => {
  it('returns a ZIP file with Content-Type application/zip', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    mockSession(adminUser)

    const res = await requestGet('/api/backup')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
  })

  it('exports all users, libraries, and specifications in backup.json', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    await insertUser('user-2', 'bob@example.com')
    await insertLibrary('lib-1', 'user-2', 'Bob Library')
    await insertSpecification('spec-1', 'lib-1', 'My Spec', '{"nodes":[]}')
    mockSession(adminUser)

    const res = await requestGet('/api/backup')
    const body = await parseBackupResponse(res)

    const tables = body.tables as Record<string, unknown[]>
    expect(tables.user.length).toBe(2)
    expect(tables.library.length).toBe(1)
    expect(tables.specification.length).toBe(1)
  })

  it('returns version 3 format', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    mockSession(adminUser)

    const res = await requestGet('/api/backup')
    const body = await parseBackupResponse(res)
    expect(body.version).toBe(3)
    expect(typeof body.exportedAt).toBe('string')
  })

  it('round-trip preserves emailVerified and image on user', async () => {
    // Insert a user with non-default emailVerified and image values
    const adminUser = await insertUser('admin-1', 'admin@example.com', {
      isAdministrator: true,
      emailVerified: 1,
      image: 'https://x/a.png',
    })
    mockSession(adminUser)

    // Export
    const exportRes = await requestGet('/api/backup')
    expect(exportRes.status).toBe(200)
    const exportBody = await parseBackupResponse(exportRes)
    const exportedUsers = (exportBody.tables as Record<string, Record<string, unknown>[]>).user
    expect(exportedUsers).toHaveLength(1)
    // Postgres boolean column: exported as true (truthy)
    expect(exportedUsers[0].emailVerified).toBeTruthy()
    expect(exportedUsers[0].image).toBe('https://x/a.png')

    // Rebuild a signed ZIP from the parsed export body to use as the restore payload
    // The restore still reads the v2 shape until the v3 restore lands, so feed it the exported users that way.
    const restoreBuffer = await buildBackupZip({ version: 2, users: exportedUsers })
    const restoreRes = await requestPostBinary('/api/backup/restore', restoreBuffer)
    expect(restoreRes.status).toBe(200)

    // Verify the values survived the round-trip in the database
    type UserDbRow = { id: string; emailVerified: boolean | null; image: string | null }
    const [row] = await rawQuery<UserDbRow>(`SELECT "id", "emailVerified", "image" FROM "user" WHERE "id" = 'admin-1'`)
    expect(row).toBeDefined()
    expect(row!.emailVerified).toBeTruthy()
    expect(row!.image).toBe('https://x/a.png')
  })

  it('keeps images in the backup as image rows plus a blob entry', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    await insertLibrary('lib-1', 'admin-1', 'My Library')
    mockSession(adminUser)
    await insertSpecification('spec-img', 'lib-1', 'Image Spec', JSON.stringify({ nodes: [] }))
    await rawQuery(
      `INSERT INTO "image_blob" ("contentHash", "data", "mimeType", "byteSize", "createdAt", "refCount") VALUES ($1, $2, $3, $4, $5, 1)`,
      ['hash-1', Buffer.from([1, 2, 3]), 'image/png', 3, NOW],
    )
    await rawQuery(
      `INSERT INTO "image" ("id", "specificationId", "filename", "mimeType", "contentHash", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)`,
      ['img-1', 'spec-img', 'photo.png', 'image/png', 'hash-1', NOW],
    )

    const res = await requestGet('/api/backup')
    const zip = await JSZip.loadAsync(await res.arrayBuffer())

    // The bytes live in a blobs/<id> entry; the image row links filename to that blob
    const blobFile = zip.file('blobs/hash-1')
    expect(blobFile).not.toBeNull()
    expect(Array.from(await blobFile!.async('uint8array'))).toEqual([1, 2, 3])
    const body = JSON.parse(await zip.file('backup.json')!.async('string'))
    expect(body.tables.image[0]).toMatchObject({
      specificationId: 'spec-img',
      filename: 'photo.png',
      contentHash: 'hash-1',
    })
  })

  it('returns 401 when unauthenticated', async () => {
    clearSession()
    const res = await requestGet('/api/backup')
    expect(res.status).toBe(401)
  })

  it('returns 403 when not an administrator', async () => {
    const regularUser = await insertUser('user-1', 'regular@example.com', { isAdministrator: false })
    mockSession(regularUser)

    const res = await requestGet('/api/backup')
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /api/backup/restore
// ---------------------------------------------------------------------------

describe('POST /api/backup/restore', () => {
  it('rejects a non-ZIP payload', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    mockSession(adminUser)

    const res = await requestPostBinary('/api/backup/restore', new ArrayBuffer(10))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('not a valid ZIP')
  })

  it('rejects a ZIP without backup.json', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    mockSession(adminUser)

    const zip = new JSZip()
    zip.file('readme.txt', 'not a backup')
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    const res = await requestPostBinary('/api/backup/restore', buffer)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('missing backup.json')
  })

  it('restores users, libraries, and specifications from a valid ZIP', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    mockSession(adminUser)

    const backupData = {
      version: 2,
      users: [
        {
          id: 'u-new-1',
          name: 'Alice',
          email: 'alice@example.com',
          isAdministrator: false,
        },
      ],
      libraries: [
        {
          id: 'lib-new-1',
          name: 'Alice Library',
          entityType: 'workflow',
          teamId: 'team-default',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      specifications: [
        {
          id: 'spec-new-1',
          libraryId: 'lib-new-1',
          name: 'Alice Spec',
          data: { nodes: [] },
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    }

    const buffer = await buildBackupZip(backupData)
    const res = await requestPostBinary('/api/backup/restore', buffer)
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      success: boolean
      counts: { users: number; libraries: number; specifications: number }
    }
    expect(body.success).toBe(true)
    expect(body.counts.users).toBe(1)
    expect(body.counts.libraries).toBe(1)
    expect(body.counts.specifications).toBe(1)
  })

  it('round-trip preserves specification typeName; a backup without the key restores null', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    mockSession(adminUser)
    const backupData = {
      version: 2,
      users: [],
      libraries: [
        { id: 'lib-t', name: 'L', entityType: 'workflow', teamId: 'team-default', createdAt: NOW, updatedAt: NOW },
      ],
      specifications: [
        {
          id: 'spec-typed',
          libraryId: 'lib-t',
          name: 'Typed',
          typeName: 'Operation',
          data: { nodes: [] },
          createdAt: NOW,
          updatedAt: NOW,
        },
        { id: 'spec-plain', libraryId: 'lib-t', name: 'Plain', data: { nodes: [] }, createdAt: NOW, updatedAt: NOW },
      ],
    }
    const res = await requestPostBinary('/api/backup/restore', await buildBackupZip(backupData))
    expect(res.status).toBe(200)
    const rows = await rawQuery<{ id: string; typeName: string | null }>(
      'SELECT id, "typeName" FROM "specification" ORDER BY id',
    )
    expect(rows).toEqual([
      { id: 'spec-plain', typeName: null },
      { id: 'spec-typed', typeName: 'Operation' },
    ])
    const exported = await parseBackupResponse(await requestGet('/api/backup'))
    const typed = (
      (exported.tables as Record<string, unknown[]>).specification as Array<{ id: string; typeName: string | null }>
    ).find((x) => x.id === 'spec-typed')
    expect(typed?.typeName).toBe('Operation')
  })

  it('round-trip preserves teamId, version, createdByUserId, and lastEditedByUserId on library', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    mockSession(adminUser)

    // Build a backup payload that contains the surviving attribution columns.
    // user-creator / user-editor must be in the backup's users array so they are
    // preserved / inserted BEFORE the library FK check fires.
    const backupData = {
      version: 2,
      users: [
        { id: 'user-creator', name: 'Creator', email: 'creator@example.com', isAdministrator: false },
        { id: 'user-editor', name: 'Editor', email: 'editor@example.com', isAdministrator: false },
      ],
      libraries: [
        {
          id: 'lib-rt-1',
          name: 'Round-Trip Library',
          entityType: 'workflow',
          version: '2.3.1',
          teamId: 'team-default',
          createdByUserId: 'user-creator',
          lastEditedByUserId: 'user-editor',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      specifications: [],
    }

    const buffer = await buildBackupZip(backupData)
    const res = await requestPostBinary('/api/backup/restore', buffer)
    expect(res.status).toBe(200)

    type LibRow = {
      id: string
      version: string | null
      teamId: string
      createdByUserId: string | null
      lastEditedByUserId: string | null
    }
    const [lib] = await rawQuery<LibRow>(
      `SELECT "id", "version", "teamId", "createdByUserId", "lastEditedByUserId" FROM "library" WHERE "id" = 'lib-rt-1'`,
    )
    expect(lib).toBeDefined()
    expect(lib!.version).toBe('2.3.1')
    expect(lib!.teamId).toBe('team-default')
    expect(lib!.createdByUserId).toBe('user-creator')
    expect(lib!.lastEditedByUserId).toBe('user-editor')
  })

  it('reconstitutes images from ZIP into specification data', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    await insertLibrary('lib-1', 'admin-1', 'My Library')
    mockSession(adminUser)

    const zip = new JSZip()
    zip.file('images/spec-img/photo.png', 'iVBORw0KGgo=', { base64: true })
    const backupJson = {
      version: 2,
      users: [],
      libraries: [
        {
          id: 'lib-1',
          name: 'My Library',
          entityType: 'workflow',
          teamId: 'team-default',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      specifications: [
        {
          id: 'spec-img',
          libraryId: 'lib-1',
          name: 'Image Spec',
          data: { nodes: [], images: { 'photo.png': 'image/png' } },
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    }
    const jsonText = JSON.stringify(backupJson)
    zip.file('backup.json', jsonText)
    // Sign the backup with the dev-only key (matches backup.ts signBackup logic)
    const secret = process.env.BETTER_AUTH_SECRET || 'dev-only-insecure-key'
    const signature = createHmac('sha256', secret).update(jsonText).digest('hex')
    zip.file('signature.json', JSON.stringify({ algorithm: 'hmac-sha256', signature }))
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    const res = await requestPostBinary('/api/backup/restore', buffer)
    expect(res.status).toBe(200)

    const specs = await db.select().from(specification)
    expect(specs).toHaveLength(1)
    const data = JSON.parse(specs[0].data) as { images?: Record<string, string> }
    expect(data.images?.['photo.png']).toMatch(/^data:image\/png;base64,/)
  })

  it('skips unknown fields and defaults missing fields (schema tolerance)', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    mockSession(adminUser)

    const backupData = {
      version: 2,
      users: [
        {
          id: 'u-1',
          name: 'Alice',
          email: 'alice@example.com',
          futureField: 'should be ignored',
        },
      ],
      libraries: [],
      specifications: [],
    }

    const buffer = await buildBackupZip(backupData)
    const res = await requestPostBinary('/api/backup/restore', buffer)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { warnings?: string[] }
    expect(body.warnings).toBeDefined()
    expect(body.warnings!.some((w: string) => w.includes('futureField'))).toBe(true)

    const rows = await db
      .select({ id: user.id, email: user.email, isAdministrator: user.isAdministrator })
      .from(user)
      .where(eq(user.email, 'alice@example.com'))
    expect(rows).toHaveLength(1)
    expect(rows[0].isAdministrator).toBe(false)
  })

  it('preserves the current admin user even when not in backup', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    mockSession(adminUser)

    const buffer = await buildBackupZip({
      version: 2,
      users: [],
      libraries: [],
      specifications: [],
    })
    await requestPostBinary('/api/backup/restore', buffer)

    const admins = await db.select({ id: user.id }).from(user).where(eq(user.id, 'admin-1'))
    expect(admins).toHaveLength(1)
  })

  it("v2: a backup user whose id belongs to a different local account is restored without that account's password", async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    mockSession(adminUser)
    await insertUser('u-x', 'local@x.io')
    await rawQuery(
      `INSERT INTO "account" ("id","userId","providerId","accountId","password") VALUES ('acc-ux','u-x','credential','u-x','local-hash')`,
    )
    const buffer = await buildBackupZip({
      version: 2,
      users: [{ id: 'u-x', name: 'Remote', email: 'remote@x.io', isAdministrator: false }],
      libraries: [],
      specifications: [],
    })
    const res = await requestPostBinary('/api/backup/restore', buffer)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings?: string[] }
    const [row] = await rawQuery<{ email: string }>(`SELECT "email" FROM "user" WHERE "id" = 'u-x'`)
    expect(row.email).toBe('remote@x.io')
    const accounts = await rawQuery(`SELECT "id" FROM "account" WHERE "userId" = 'u-x'`)
    expect(accounts).toHaveLength(0)
    expect(body.warnings).toContain(
      'User remote@x.io: restored without a password (its id belonged to a different account here). Set a password in Admin → Accounts.',
    )
  })

  it("v2: a backup user with the signed-in admin's id but another email is not restored", async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true, name: 'Admin' })
    mockSession(adminUser)
    const buffer = await buildBackupZip({
      version: 2,
      users: [{ id: 'admin-1', name: 'Imposter', email: 'other@x.io', isAdministrator: false }],
      libraries: [],
      specifications: [],
    })
    const res = await requestPostBinary('/api/backup/restore', buffer)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings?: string[] }
    const rows = await rawQuery<{ id: string; email: string; name: string; isAdministrator: boolean }>(
      `SELECT "id","email","name","isAdministrator" FROM "user" ORDER BY "id"`,
    )
    expect(rows).toEqual([{ id: 'admin-1', email: 'admin@example.com', name: 'Admin', isAdministrator: true }])
    expect(body.warnings).toContain(
      'User other@x.io: not restored — its id belongs to the signed-in administrator here.',
    )
  })

  it("v2: a backup user with the admin's email does not change the admin", async () => {
    const adminUser = await insertUser('admin-1', 'admin@x.io', { isAdministrator: true, name: 'Boss' })
    mockSession(adminUser)
    const buffer = await buildBackupZip({
      version: 2,
      users: [{ id: 'other-id', name: 'Other', email: 'admin@x.io', isAdministrator: false }],
      libraries: [],
      specifications: [],
    })
    const res = await requestPostBinary('/api/backup/restore', buffer)
    expect(res.status).toBe(200)
    const [row] = await rawQuery<{ name: string; isAdministrator: boolean }>(
      `SELECT "name","isAdministrator" FROM "user" WHERE "id" = 'admin-1'`,
    )
    expect(row).toEqual({ name: 'Boss', isAdministrator: true })
  })

  it("v2: a backup user with the admin's id and email does not change the admin", async () => {
    const adminUser = await insertUser('admin-1', 'admin@x.io', { isAdministrator: true, name: 'Boss' })
    mockSession(adminUser)
    const buffer = await buildBackupZip({
      version: 2,
      users: [{ id: 'admin-1', name: 'Other', email: 'admin@x.io', isAdministrator: false }],
      libraries: [],
      specifications: [],
    })
    const res = await requestPostBinary('/api/backup/restore', buffer)
    expect(res.status).toBe(200)
    const [row] = await rawQuery<{ name: string; isAdministrator: boolean }>(
      `SELECT "name","isAdministrator" FROM "user" WHERE "id" = 'admin-1'`,
    )
    expect(row).toEqual({ name: 'Boss', isAdministrator: true })
  })

  it('v2: email case does not split a person', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    mockSession(adminUser)
    await insertUser('u-x', 'B@X.io')
    await rawQuery(
      `INSERT INTO "account" ("id","userId","providerId","accountId","password") VALUES ('acc-ux','u-x','credential','u-x','local-hash')`,
    )
    const buffer = await buildBackupZip({
      version: 2,
      users: [{ id: 'u-x', name: 'Bob', email: 'b@x.io', isAdministrator: false }],
      libraries: [],
      specifications: [],
    })
    expect((await requestPostBinary('/api/backup/restore', buffer)).status).toBe(200)
    const rows = await rawQuery<{ password: string }>(`SELECT "password" FROM "account" WHERE "userId" = 'u-x'`)
    expect(rows).toEqual([{ password: 'local-hash' }])
  })

  it('returns 403 when not an administrator', async () => {
    const regularUser = await insertUser('user-1', 'regular@example.com', { isAdministrator: false })
    mockSession(regularUser)

    const buffer = await buildBackupZip({ version: 2, users: [], libraries: [], specifications: [] })
    const res = await requestPostBinary('/api/backup/restore', buffer)
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    clearSession()
    const buffer = await buildBackupZip({ version: 2, users: [], libraries: [], specifications: [] })
    const res = await requestPostBinary('/api/backup/restore', buffer)
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /api/backup/clear
// ---------------------------------------------------------------------------

describe('POST /api/backup/clear', () => {
  it('deletes all users, sessions, accounts, libraries, and specifications', async () => {
    const adminUser = await insertUser('admin-1', 'admin@example.com', { isAdministrator: true })
    await insertUser('user-2', 'bob@example.com')
    await insertLibrary('lib-1', 'user-2', 'Bob Library')
    await insertSpecification('spec-1', 'lib-1', 'Bob Spec')

    await rawQuery(`INSERT INTO "session" ("id", "userId", "token", "expiresAt") VALUES ($1, $2, $3, $4)`, [
      'sess-1',
      'user-2',
      'tok-1',
      new Date(NOW + 3600000),
    ])

    await rawQuery(`INSERT INTO "account" ("id", "userId", "accountId", "providerId") VALUES ($1, $2, $3, $4)`, [
      'acct-1',
      'user-2',
      'acct-1',
      'credential',
    ])

    mockSession(adminUser)

    const res = await requestPostJson('/api/backup/clear')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean }
    expect(body.success).toBe(true)

    // clear preserves the current admin user, their sessions and accounts
    const remainingUsers = await db.select({ id: user.id }).from(user)
    expect(remainingUsers).toHaveLength(1)
    expect(remainingUsers[0].id).toBe('admin-1')
    expect(await db.select({ id: library.id }).from(library)).toHaveLength(0)
    expect(await db.select({ id: specification.id }).from(specification)).toHaveLength(0)
    // Only user-2's session + account deleted; admin-1's session/account preserved
    const remainingSessions = await db.select().from(session)
    expect(remainingSessions.every((s) => s.userId === 'admin-1')).toBe(true)
    const remainingAccounts = await db.select().from(account)
    expect(remainingAccounts.every((a) => a.userId === 'admin-1')).toBe(true)
  })

  it('returns 403 when not an administrator', async () => {
    const regularUser = await insertUser('user-1', 'regular@example.com', { isAdministrator: false })
    mockSession(regularUser)

    const res = await requestPostJson('/api/backup/clear')
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    clearSession()
    const res = await requestPostJson('/api/backup/clear')
    expect(res.status).toBe(401)
  })
})
