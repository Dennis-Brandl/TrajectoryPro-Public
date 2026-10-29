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

import { Pool } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import * as schema from '../db/schema'
import { DDL_SQL } from '../db/ddl.pg'
import { TRIGGERS_SQL } from '../db/triggers.pg'
import { isTriggerAuditEnabled, TRIGGER_AUDIT_CREATE_SQL } from '../db/triggerAudit'
import { seedRbac, seedGlobalTeam } from './rbacSeed'
import { backfillSetupComplete } from './setupState'
import { migrateFormDocuments } from './formDocumentMigration'
import { clearStampedActionTimeouts } from './actionTimeoutMigration'

// ---------------------------------------------------------------------------
// Factory: in-memory PGlite for tests, real Pool for production/development.
// Pool connects lazily so `import { db }` is synchronous — callers (auth.ts
// etc.) don't need to change their import style.
// ---------------------------------------------------------------------------

const useMemoryDb = process.env.NODE_ENV === 'test' || !!process.env.VITEST

const pglite = useMemoryDb ? new PGlite() : null
const pool = useMemoryDb ? null : new Pool({ connectionString: process.env.DATABASE_URL })

export const db = (useMemoryDb ? drizzlePglite(pglite!, { schema }) : drizzlePg(pool!, { schema })) as NodePgDatabase<
  typeof schema
>

// ---------------------------------------------------------------------------
// Raw helpers — prefer Drizzle's fluent API for everything else.
// ---------------------------------------------------------------------------

/** Run multi-statement DDL (no bind params). */
async function execScript(sql: string): Promise<void> {
  if (pglite) await pglite.exec(sql)
  else await pool!.query(sql)
}

/** Parameterized query escape hatch — returns typed rows.
 *  Replaces the old better-sqlite3 `rawClient()` accessor. */
export async function rawQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  if (pglite) return (await pglite.query<T>(text, params)).rows
  return (await pool!.query(text, params)).rows as T[]
}

/** Run fn inside a single-connection transaction. `q` is a connection-scoped
 *  rawQuery: every query inside MUST use `q`, not the module-level rawQuery,
 *  or it will run on a different connection (Pool) and break atomicity.
 *  For PGlite (tests) uses pglite.transaction so tx.query() bypasses the
 *  PGlite processing lock — calling rawQuery() inside would deadlock. */
export async function withTransaction<T>(
  fn: (q: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  if (pglite) {
    return pglite.transaction(async (tx) => {
      const q = async <R>(text: string, params: unknown[] = []) => (await tx.query<R>(text, params)).rows
      return fn(q as never)
    }) as Promise<T>
  }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const q = async <R>(text: string, params: unknown[] = []) => (await client.query(text, params)).rows as R[]
    const result = await fn(q as never)
    await client.query('COMMIT')
    return result
  } catch (e) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore rollback errors */
    }
    throw e
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Expected schema — Postgres information_schema data_type strings.
// Used by checkDatabaseSchema() to detect and auto-fix missing columns.
// The `type` value must match what information_schema.columns.data_type
// reports for that column; `dflt` is the SQL DEFAULT expression (interpolated
// verbatim into ALTER TABLE … ADD COLUMN … DEFAULT <dflt>).
// ---------------------------------------------------------------------------

export const EXPECTED_SCHEMA: Record<string, { name: string; type: string; notnull: boolean; dflt: string | null }[]> =
  {
    user: [
      { name: 'id', type: 'text', notnull: true, dflt: null },
      { name: 'name', type: 'text', notnull: false, dflt: null },
      { name: 'email', type: 'text', notnull: true, dflt: null },
      { name: 'emailVerified', type: 'boolean', notnull: false, dflt: null },
      { name: 'image', type: 'text', notnull: false, dflt: null },
      { name: 'isAdministrator', type: 'boolean', notnull: false, dflt: 'false' },
      { name: 'createdAt', type: 'timestamp with time zone', notnull: false, dflt: null },
      { name: 'updatedAt', type: 'timestamp with time zone', notnull: false, dflt: null },
    ],
    session: [
      { name: 'id', type: 'text', notnull: true, dflt: null },
      { name: 'userId', type: 'text', notnull: true, dflt: null },
      { name: 'token', type: 'text', notnull: true, dflt: null },
      { name: 'expiresAt', type: 'timestamp with time zone', notnull: true, dflt: null },
      { name: 'ipAddress', type: 'text', notnull: false, dflt: null },
      { name: 'userAgent', type: 'text', notnull: false, dflt: null },
      { name: 'createdAt', type: 'timestamp with time zone', notnull: false, dflt: null },
      { name: 'updatedAt', type: 'timestamp with time zone', notnull: false, dflt: null },
    ],
    account: [
      { name: 'id', type: 'text', notnull: true, dflt: null },
      { name: 'userId', type: 'text', notnull: true, dflt: null },
      { name: 'accountId', type: 'text', notnull: true, dflt: null },
      { name: 'providerId', type: 'text', notnull: true, dflt: null },
      { name: 'accessToken', type: 'text', notnull: false, dflt: null },
      { name: 'refreshToken', type: 'text', notnull: false, dflt: null },
      { name: 'accessTokenExpiresAt', type: 'timestamp with time zone', notnull: false, dflt: null },
      { name: 'refreshTokenExpiresAt', type: 'timestamp with time zone', notnull: false, dflt: null },
      { name: 'scope', type: 'text', notnull: false, dflt: null },
      { name: 'idToken', type: 'text', notnull: false, dflt: null },
      { name: 'password', type: 'text', notnull: false, dflt: null },
      { name: 'createdAt', type: 'timestamp with time zone', notnull: false, dflt: null },
      { name: 'updatedAt', type: 'timestamp with time zone', notnull: false, dflt: null },
    ],
    verification: [
      { name: 'id', type: 'text', notnull: true, dflt: null },
      { name: 'identifier', type: 'text', notnull: true, dflt: null },
      { name: 'value', type: 'text', notnull: true, dflt: null },
      { name: 'expiresAt', type: 'timestamp with time zone', notnull: true, dflt: null },
      { name: 'createdAt', type: 'timestamp with time zone', notnull: false, dflt: null },
      { name: 'updatedAt', type: 'timestamp with time zone', notnull: false, dflt: null },
    ],
    team: [
      { name: 'id', type: 'text', notnull: true, dflt: null },
      { name: 'name', type: 'text', notnull: true, dflt: null },
      { name: 'description', type: 'text', notnull: false, dflt: null },
      { name: 'createdAt', type: 'bigint', notnull: true, dflt: null },
      { name: 'updatedAt', type: 'bigint', notnull: true, dflt: null },
    ],
    user_team: [
      { name: 'userId', type: 'text', notnull: true, dflt: null },
      { name: 'teamId', type: 'text', notnull: true, dflt: null },
    ],
    role: [
      { name: 'id', type: 'text', notnull: true, dflt: null },
      { name: 'name', type: 'text', notnull: true, dflt: null },
      { name: 'description', type: 'text', notnull: false, dflt: null },
      { name: 'isSeeded', type: 'integer', notnull: false, dflt: '0' },
    ],
    role_right: [
      { name: 'roleId', type: 'text', notnull: true, dflt: null },
      { name: 'right', type: 'text', notnull: true, dflt: null },
    ],
    user_team_role: [
      { name: 'userId', type: 'text', notnull: true, dflt: null },
      { name: 'teamId', type: 'text', notnull: true, dflt: null },
      { name: 'roleId', type: 'text', notnull: true, dflt: null },
    ],
    app_setting: [
      { name: 'key', type: 'text', notnull: true, dflt: null },
      { name: 'value', type: 'text', notnull: true, dflt: null },
    ],
    library: [
      { name: 'id', type: 'text', notnull: true, dflt: null },
      { name: 'parentLibraryId', type: 'text', notnull: false, dflt: null },
      { name: 'name', type: 'text', notnull: true, dflt: null },
      { name: 'entityType', type: 'text', notnull: true, dflt: null },
      { name: 'description', type: 'text', notnull: false, dflt: null },
      { name: 'author', type: 'text', notnull: false, dflt: null },
      { name: 'changeHistory', type: 'text', notnull: false, dflt: null },
      { name: 'version', type: 'text', notnull: false, dflt: "'1.0.0'" },
      { name: 'environmentLibraryIds', type: 'text', notnull: false, dflt: null },
      { name: 'createdAt', type: 'bigint', notnull: true, dflt: null },
      { name: 'updatedAt', type: 'bigint', notnull: true, dflt: null },
      { name: 'lastEditedByUserId', type: 'text', notnull: false, dflt: null },
      { name: 'teamId', type: 'text', notnull: true, dflt: null },
      { name: 'createdByUserId', type: 'text', notnull: false, dflt: null },
    ],
    specification: [
      { name: 'id', type: 'text', notnull: true, dflt: null },
      { name: 'libraryId', type: 'text', notnull: true, dflt: null },
      { name: 'name', type: 'text', notnull: true, dflt: null },
      { name: 'description', type: 'text', notnull: false, dflt: null },
      { name: 'typeName', type: 'text', notnull: false, dflt: null },
      { name: 'version', type: 'text', notnull: true, dflt: "'1.0.0'" },
      { name: 'state', type: 'text', notnull: true, dflt: "'Draft'" },
      { name: 'data', type: 'text', notnull: true, dflt: null },
      { name: 'environmentLibraryIds', type: 'text', notnull: false, dflt: null },
      { name: 'createdAt', type: 'bigint', notnull: true, dflt: null },
      { name: 'updatedAt', type: 'bigint', notnull: true, dflt: null },
      { name: 'parentSpecificationId', type: 'text', notnull: false, dflt: null },
      { name: 'rootSpecificationId', type: 'text', notnull: false, dflt: null },
      { name: 'dataSchemaVersion', type: 'integer', notnull: true, dflt: '3' },
      { name: 'lastEditedByUserId', type: 'text', notnull: false, dflt: null },
      { name: 'history', type: 'text', notnull: true, dflt: "'[]'" },
      { name: 'effectiveFrom', type: 'bigint', notnull: false, dflt: null },
    ],
    image_blob: [
      { name: 'contentHash', type: 'text', notnull: true, dflt: null },
      { name: 'data', type: 'bytea', notnull: true, dflt: null },
      { name: 'mimeType', type: 'text', notnull: true, dflt: null },
      { name: 'byteSize', type: 'integer', notnull: true, dflt: null },
      { name: 'createdAt', type: 'bigint', notnull: true, dflt: null },
      { name: 'refCount', type: 'integer', notnull: true, dflt: '0' },
    ],
    image: [
      { name: 'id', type: 'text', notnull: true, dflt: null },
      { name: 'specificationId', type: 'text', notnull: true, dflt: null },
      { name: 'filename', type: 'text', notnull: true, dflt: null },
      { name: 'mimeType', type: 'text', notnull: true, dflt: null },
      { name: 'contentHash', type: 'text', notnull: true, dflt: null },
      { name: 'createdAt', type: 'bigint', notnull: true, dflt: null },
    ],
    image_reference: [
      { name: 'specificationId', type: 'text', notnull: true, dflt: null },
      { name: 'imageId', type: 'text', notnull: true, dflt: null },
    ],
    proxy_reference: [
      { name: 'parentSpecificationId', type: 'text', notnull: true, dflt: null },
      { name: 'nodeId', type: 'text', notnull: true, dflt: null },
      { name: 'targetSpecificationId', type: 'text', notnull: true, dflt: null },
    ],
    library_environment: [
      { name: 'libraryId', type: 'text', notnull: true, dflt: null },
      { name: 'environmentLibraryId', type: 'text', notnull: true, dflt: null },
    ],
    specification_environment: [
      { name: 'specificationId', type: 'text', notnull: true, dflt: null },
      { name: 'environmentLibraryId', type: 'text', notnull: true, dflt: null },
    ],
  }

// ---------------------------------------------------------------------------
// Schema introspection — async, information_schema-based.
// ---------------------------------------------------------------------------

/**
 * Compare actual database schema against EXPECTED_SCHEMA using
 * information_schema.columns. Optionally auto-fix by adding missing columns.
 */
export async function checkDatabaseSchema(fix = false) {
  const results: {
    table: string
    status: string
    missingColumns: string[]
    extraColumns: string[]
    fixed: string[]
  }[] = []

  for (const [tableName, expectedCols] of Object.entries(EXPECTED_SCHEMA)) {
    const actualCols = await rawQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [tableName],
    )

    if (actualCols.length === 0) {
      results.push({ table: tableName, status: 'missing_table', missingColumns: [], extraColumns: [], fixed: [] })
      continue
    }

    const actualNames = new Set(actualCols.map((c) => c.column_name))
    const missing = expectedCols.filter((c) => !actualNames.has(c.name))
    const fixed: string[] = []

    if (fix) {
      for (const col of missing) {
        const def = col.dflt != null ? ` DEFAULT ${col.dflt}` : ''
        await execScript(`ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}${def}`)
        fixed.push(col.name)
      }
    }

    results.push({
      table: tableName,
      status: missing.length && !fixed.length ? 'missing_columns' : 'ok',
      missingColumns: missing.map((c) => c.name),
      extraColumns: [],
      fixed,
    })
  }

  return results
}

/**
 * Returns whether all expected tables exist. Shared by bootstrapDatabase()
 * and the /api/health endpoint.
 */
export async function databaseSchemaStatus(): Promise<{ ok: boolean; missingTables: string[] }> {
  const missingTables = (await checkDatabaseSchema(false))
    .filter((r) => r.status === 'missing_table')
    .map((r) => r.table)
  return { ok: missingTables.length === 0, missingTables }
}

// ---------------------------------------------------------------------------
// Bootstrap — called once at server startup (by index.ts) after the event
// loop is running. NOT called at module load; Pool connects lazily.
// ---------------------------------------------------------------------------

/**
 * Idempotent database bootstrap:
 *   1. Apply DDL (all tables, indexes) — IF NOT EXISTS everywhere.
 *   2. Apply PL/pgSQL trigger functions + triggers.
 *   3. Create _trigger_audit table in dev/test (audit guard in triggers).
 *   4. Auto-fix any missing columns (ALTER TABLE … ADD COLUMN IF NOT EXISTS).
 *   5. Verify all 18 tables present — throw if any are missing.
 *   6. Seed the editLockedStates app_setting (idempotent).
 *   6.5 Seed the GLOBAL team (spec 2026-10-12).
 *   7. Backfill setupComplete for installs that already have an admin.
 *   7.5. Migrate formLayouts → formDocument (dataSchemaVersion < 4), all states — spec 2026-07-23.
 *   7.6. Clear Designer-stamped ACTION PROXY timeout_ms 30000 in Draft/InTest/InReview, once (app_setting marker) — spec 2026-10-19 §B.3.
 *   8. Wipe sessions (unless KEEP_SESSIONS_ON_RESTART=true).
 */
export async function bootstrapDatabase(): Promise<void> {
  await execScript(DDL_SQL)
  await execScript(TRIGGERS_SQL)
  if (isTriggerAuditEnabled()) await execScript(TRIGGER_AUDIT_CREATE_SQL)

  await checkDatabaseSchema(true) // auto-add any missing columns
  const { ok, missingTables } = await databaseSchemaStatus()
  if (!ok) {
    throw new Error(
      `[db] FATAL: schema verification failed — missing tables: ${missingTables.join(', ')}. Refusing to start.`,
    )
  }

  await seedRbac()
  await seedGlobalTeam()
  await backfillSetupComplete()
  await migrateFormDocuments()
  await clearStampedActionTimeouts()

  if (process.env.KEEP_SESSIONS_ON_RESTART !== 'true') {
    await rawQuery('DELETE FROM "session"')
  }
}
