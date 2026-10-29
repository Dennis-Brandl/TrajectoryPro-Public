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

import pg from 'pg'

// int8 (OID 20) arrives as string by default; this container's counts and
// identity ids all fit in JS numbers. See also the ::int casts in queries and
// the PGlite adapter's bigint conversion (the "int64 rule").
pg.types.setTypeParser(20, (v) => Number(v))

/**
 * Minimal query surface shared by pg.Pool, pg.PoolClient, and the PGlite test
 * adapter. Repositories depend on THIS, never on pg directly.
 */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 })
}

export const EXPECTED_TABLES = [
  'environments',
  'actions',
  'code_versions',
  'instances',
  'execution_log',
  'settings',
  '_migrations',
] as const

/**
 * Permanent rule: a distributed app must guarantee its database has every
 * required table on startup. Shared by initializeDatabase() (fail-fast) and
 * the server's /health endpoint.
 */
export async function databaseSchemaStatus(
  q: Queryable
): Promise<{ ok: boolean; missingTables: string[] }> {
  const res = await q.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  )
  const existing = new Set(res.rows.map((r) => r.table_name as string))
  const missingTables = EXPECTED_TABLES.filter((t) => !existing.has(t))
  return { ok: missingTables.length === 0, missingTables }
}

/**
 * Runs fn atomically. Over a pg.Pool: checks out one client and wraps fn in
 * BEGIN/COMMIT (pool.query alone would auto-commit each statement on arbitrary
 * connections). Over a PoolClient or the PGlite test adapter: runs fn directly —
 * a PoolClient is already inside the caller's transaction, and PGlite is a
 * single serialized connection. Pool detection MUST be `instanceof pg.Pool`:
 * a PoolClient also has a .connect() method (it extends Client), so a
 * "has connect" duck-check would double-connect a checked-out client.
 * NOTE: unlike better-sqlite3's savepoints, a nested withAtomic does not
 * partially roll back; no call site relies on that.
 */
export async function withAtomic<T>(q: Queryable, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  if (!(q instanceof pg.Pool)) return fn(q)
  const client = await q.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* connection may already be broken */
    }
    throw err
  } finally {
    client.release()
  }
}

/** True when err is a Postgres unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505'
}

/**
 * True when q is the pool itself (statements auto-commit individually).
 * Retry-on-conflict is ONLY legal on the pool path: after an error inside an
 * open PG transaction the transaction is poisoned (25P02) and every further
 * statement fails — retrying there is a bug, not resilience.
 */
export function isPool(q: Queryable): boolean {
  return q instanceof pg.Pool
}
