#!/usr/bin/env tsx
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

/**
 * One-shot SQLite → Postgres import for Mission Autopilot.
 *
 * Usage: npx tsx scripts/import-sqlite.ts <path-to-database.sqlite> <postgres-url>
 *
 * Imports environments, actions, code_versions (preserving version_number and
 * is_active) and the VALUES of known settings keys. Skips instances and
 * execution_log by design. Refuses a non-empty target — drop/recreate the
 * database and re-run instead of forcing.
 */
import Database from 'better-sqlite3'
import pg from 'pg'
import type { Queryable } from '@mission/autopilot-storage'

const REQUIRED_SOURCE_MIGRATIONS = [
  '001-initial-schema',
  '002-action-timeout',
  '003-lifecycle-state',
  '004-api-key-setting',
]
const KNOWN_SETTINGS_KEYS = new Set([
  'log_max_size',
  'python_pool_size',
  'execution_timeout_ms',
  'instance_retention_hours',
  'api_key',
])

export interface SqliteSnapshot {
  environments: Record<string, unknown>[]
  actions: Record<string, unknown>[]
  code_versions: Record<string, unknown>[]
  settings: { key: string; value: string }[]
}
export interface ImportCounts {
  environments: number
  actions: number
  code_versions: number
  settings: number
}

export function readSqliteSnapshot(sqlite: InstanceType<typeof Database>): SqliteSnapshot {
  const applied = new Set(
    (sqlite.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name)
  )
  const missing = REQUIRED_SOURCE_MIGRATIONS.filter((m) => !applied.has(m))
  if (missing.length > 0) {
    throw new Error(
      `Source database is not fully migrated (missing: ${missing.join(', ')}). ` +
        `Start the old container once against this file to migrate it, then re-run.`
    )
  }
  return {
    environments: sqlite.prepare('SELECT * FROM environments').all() as Record<string, unknown>[],
    actions: sqlite.prepare('SELECT * FROM actions').all() as Record<string, unknown>[],
    code_versions: sqlite.prepare('SELECT * FROM code_versions').all() as Record<string, unknown>[],
    settings: sqlite.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[],
  }
}

export async function importSqlite(snap: SqliteSnapshot, q: Queryable): Promise<ImportCounts> {
  const target = await q.query(
    `SELECT (SELECT COUNT(*)::int FROM environments)
          + (SELECT COUNT(*)::int FROM actions)
          + (SELECT COUNT(*)::int FROM code_versions) AS cnt`
  )
  if ((target.rows[0] as { cnt: number }).cnt > 0) {
    throw new Error(
      'Target database is not empty (environments/actions/code_versions have rows). ' +
        'Drop and recreate the database, then re-run.'
    )
  }

  for (const e of snap.environments) {
    await q.query(
      `INSERT INTO environments (oid, local_id, version, last_modified_date, description,
         schema_version, action_property_specifications, value_property_specifications,
         resource_property_specifications, imported_at, source_filename, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        e.oid,
        e.local_id,
        e.version,
        e.last_modified_date,
        e.description,
        e.schema_version,
        e.action_property_specifications,
        e.value_property_specifications,
        e.resource_property_specifications,
        e.imported_at,
        e.source_filename,
        e.state ?? 'Draft',
      ]
    )
  }
  for (const a of snap.actions) {
    await q.query(
      `INSERT INTO actions (oid, environment_oid, local_id, version, last_modified_date,
         description, action_visibility, input_parameter_specifications,
         output_parameter_specifications, property_specifications, timeout_seconds, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        a.oid,
        a.environment_oid,
        a.local_id,
        a.version,
        a.last_modified_date,
        a.description,
        a.action_visibility,
        a.input_parameter_specifications,
        a.output_parameter_specifications,
        a.property_specifications,
        a.timeout_seconds,
        a.state ?? 'Draft',
      ]
    )
  }
  for (const c of snap.code_versions) {
    await q.query(
      `INSERT INTO code_versions (id, action_oid, state, version_number, source_code,
         is_active, created_at, created_by, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        c.id,
        c.action_oid,
        c.state,
        c.version_number,
        c.source_code,
        c.is_active === 1 || c.is_active === true,
        c.created_at,
        c.created_by,
        c.description,
      ]
    )
  }
  let settingsCount = 0
  for (const s of snap.settings) {
    if (!KNOWN_SETTINGS_KEYS.has(s.key)) continue
    const res = await q.query('UPDATE settings SET value = $1 WHERE key = $2', [s.value, s.key])
    settingsCount += res.rowCount ?? 0
  }
  return {
    environments: snap.environments.length,
    actions: snap.actions.length,
    code_versions: snap.code_versions.length,
    settings: settingsCount,
  }
}

async function main(): Promise<void> {
  const [sqlitePath, pgUrl] = process.argv.slice(2)
  if (!sqlitePath || !pgUrl) {
    console.error(
      'Usage: npx tsx scripts/import-sqlite.ts <path-to-database.sqlite> <postgres-url>'
    )
    process.exit(1)
  }
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true })
  const snap = readSqliteSnapshot(sqlite)
  const client = new pg.Client({ connectionString: pgUrl })
  await client.connect()
  try {
    await client.query('BEGIN')
    const counts = await importSqlite(snap, client)
    await client.query('COMMIT')
    console.log(
      `Imported: ${counts.environments} environments, ${counts.actions} actions, ` +
        `${counts.code_versions} code versions, ${counts.settings} settings values.`
    )
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* already broken */
    }
    throw err
  } finally {
    await client.end()
    sqlite.close()
  }
}

// Only run as CLI, not when imported by tests
if (process.argv[1] && /import-sqlite\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err))
    process.exit(1)
  })
}
