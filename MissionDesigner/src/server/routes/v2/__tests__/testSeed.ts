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

// Integration-test helper: boots a PGlite fixture used by every /api/v2/*
// integration test. Bootstraps a fresh DB once per test-file worker via
// bootstrapDatabase(), then wipes user-content tables between tests.

import { vi } from 'vitest'
import { Hono } from 'hono'
import { rawQuery, bootstrapDatabase } from '../../../lib/db'
import { seedRoles } from '../../../lib/rbacSeed'
import { v2Routes } from '../index'

// Re-export rawQuery / db directly so test files can issue custom queries
// without importing from lib/db directly. Replaces the removed `.sqlite`:
//   before: f.sqlite.prepare('SELECT ...').get(...)
//   after:  await rawQuery('SELECT ...', [...])
export { rawQuery, db } from '../../../lib/db'

// The auth mock is hoisted by Vitest's transformer before any module-level
// import executes, so the mocked `auth` is in place when v2Routes initialises.
vi.mock('../../../lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => {
        const uid = (globalThis as unknown as { __v2TestUserId?: string }).__v2TestUserId
        if (!uid) return null
        return { user: { id: uid } }
      }),
    },
    handler: () => new Response(null, { status: 404 }),
  },
}))

export interface TestFixture {
  app: Hono
  userIdGlobal: string
  userIdRegular: string
  userIdOther: string
  libSharedId: string
  libPrivateId: string
  libEnvSharedId: string
  teamMainId: string
  rootSpecId: string // in libShared
  privateRootSpecId: string // in libPrivate
}

// Cache the Promise so parallel beforeAll() calls (multiple describe blocks in
// one file) re-use the same bootstrap without running bootstrapDatabase() twice.
let cachedFixturePromise: Promise<TestFixture> | null = null

/** Call from beforeAll. Returns a live TestFixture bound to the current test-file worker. */
export async function setupTestFixture(): Promise<TestFixture> {
  if (!cachedFixturePromise) {
    cachedFixturePromise = _createFixture()
  }
  return cachedFixturePromise
}

async function _createFixture(): Promise<TestFixture> {
  await bootstrapDatabase()

  const app = new Hono()
  // Inject a default origin header on every test request unless the caller
  // sets one explicitly.
  app.use('*', async (c, next) => {
    if (!c.req.header('origin')) {
      c.req.raw.headers.set('origin', 'http://localhost:5173')
    }
    await next()
  })
  app.route('/api/v2', v2Routes)

  return {
    app,
    userIdGlobal: 'test-global',
    userIdRegular: 'test-user',
    userIdOther: 'test-other',
    libSharedId: 'lib-shared',
    libPrivateId: 'lib-private',
    libEnvSharedId: 'lib-env-shared',
    teamMainId: 'team-main',
    rootSpecId: 'spec-shared-root',
    privateRootSpecId: 'spec-private-root',
  }
}

/** Call from beforeEach. Wipes user content and re-seeds the standard fixture. */
export async function resetAndSeedFixture(f: TestFixture): Promise<void> {
  // FK-safe delete order: child tables first (mirrors original exec() block).
  // Does NOT delete team / role / role_right / app_setting — those persist
  // across resets and are re-seeded idempotently below.
  for (const table of [
    'user_team_role',
    'user_team',
    'image_reference',
    'image',
    'image_blob',
    'proxy_reference',
    'specification_environment',
    'library_environment',
    'specification',
    'library',
    'user',
  ]) {
    await rawQuery(`DELETE FROM "${table}"`)
  }

  const NOW = Date.now()
  const NOW_DATE = new Date(NOW)

  // Users — emailVerified / isAdministrator are boolean in PG (not int)
  for (const [id, email] of [
    [f.userIdGlobal, 'global@example.com'],
    [f.userIdRegular, 'user@example.com'],
    [f.userIdOther, 'other@example.com'],
  ] as const) {
    await rawQuery(
      `INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5)`,
      [id, email, false, NOW_DATE, NOW_DATE],
    )
  }

  // Team graph: teamMain owns all fixture libraries. global + regular are members
  // with full rights; other is NOT a member (preserves the "other sees nothing"
  // invariant). Idempotent — team persists so library FK is always satisfied.
  await rawQuery(
    `INSERT INTO "team" ("id","name","description","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [f.teamMainId, 'Main Team', 'fixture', NOW, NOW],
  )

  // Canonical 16 RBAC roles + rights (idempotent) — satisfies user_team_role → role FK.
  // Not on the boot path (startup-wizard cutover); explicit here as in the original.
  await seedRoles()

  for (const uid of [f.userIdGlobal, f.userIdRegular]) {
    await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
      uid,
      f.teamMainId,
    ])
    // Author (create+edit+delete) + Approver + Publisher + Librarian across all categories.
    for (const roleId of ['role-author', 'role-approver', 'role-publisher', 'role-librarian']) {
      await rawQuery(
        `INSERT INTO "user_team_role" ("userId","teamId","roleId") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [uid, f.teamMainId, roleId],
      )
    }
  }

  // Libraries
  for (const [id, createdBy, name, entityType] of [
    [f.libSharedId, f.userIdGlobal, 'Shared Lib', 'workflow'],
    [f.libPrivateId, f.userIdRegular, 'Private Lib', 'workflow'],
    [f.libEnvSharedId, f.userIdGlobal, 'Shared Env', 'environment'],
  ] as const) {
    await rawQuery(
      `INSERT INTO "library" ("id","teamId","createdByUserId","name","entityType","version","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, f.teamMainId, createdBy, name, entityType, '1.0.0', NOW, NOW],
    )
  }

  // Root specifications (parentSpecificationId = NULL bypasses the root-consistency trigger)
  for (const [id, libId, specName] of [
    [f.rootSpecId, f.libSharedId, 'Shared Root'],
    [f.privateRootSpecId, f.libPrivateId, 'Private Root'],
  ] as const) {
    await rawQuery(
      `INSERT INTO "specification"
         ("id","libraryId","name","version","state","data",
          "rootSpecificationId","parentSpecificationId","dataSchemaVersion","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, libId, specName, '1.0.0', 'Draft', '{"nodes":[]}', id, null, 3, NOW, NOW],
    )
  }
}

/** Inserts an administrator (no team membership — relies on the admin short-circuit). */
export async function seedAdminUser(_f: TestFixture, id = 'test-admin'): Promise<string> {
  await rawQuery(
    `INSERT INTO "user" ("id","email","emailVerified","isAdministrator","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [id, `${id}@example.com`, false, true, new Date(), new Date()],
  )
  return id
}

/** Set the mocked session user id for the NEXT request on the fixture's app. */
export function mockSessionAs(userId: string | null): void {
  if (userId) {
    ;(globalThis as unknown as { __v2TestUserId?: string }).__v2TestUserId = userId
  } else {
    delete (globalThis as unknown as { __v2TestUserId?: string }).__v2TestUserId
  }
}

/** Convenience: issue a v2 request against the app with an optional JSON body.
 *  Signature is intentionally unchanged so the 23 remaining test files convert
 *  mechanically in Task 2.9. */
export async function v2Req(
  f: TestFixture,
  method: string,
  path: string,
  opts: { json?: unknown; origin?: string | null; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers = new Headers(opts.headers ?? {})
  if (opts.json !== undefined) headers.set('content-type', 'application/json')
  if (opts.origin === undefined) headers.set('origin', 'http://localhost:5173')
  else if (opts.origin !== null) headers.set('origin', opts.origin)

  return f.app.request(path, {
    method,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  })
}
