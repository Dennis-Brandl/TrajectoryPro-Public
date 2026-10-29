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

export const STORAGE_VERSION = '0.0.1' as const

export { EnvironmentRepository } from './repositories/environment.repository.js'
export { ActionRepository } from './repositories/action.repository.js'
export { CodeVersionRepository } from './repositories/code-version.repository.js'
export { InstanceRepository } from './repositories/instance.repository.js'
export { LogRepository } from './repositories/log.repository.js'
export type { LogQueryFilters } from './repositories/log.repository.js'
export { SettingsRepository } from './repositories/settings.repository.js'
export { createTransactionHelper, createTestTransactionHelper } from './transaction.js'
export type { TransactionRunner, TransactionRepos } from './transaction.js'
export { StorageError, NotFoundError, ValidationError } from './errors.js'

export {
  createPool,
  EXPECTED_TABLES,
  databaseSchemaStatus,
  withAtomic,
  isUniqueViolation,
  isPool,
} from './database.js'
export type { Queryable } from './database.js'

export { runMigrations } from './migrations/runner.js'
export type { Migration } from './migrations/runner.js'

export { migration as initialMigration } from './migrations/001-initial-schema.js'
export { migrations } from './migrations/index.js'

export type {
  Visibility,
  FinalStatus,
  LifecycleState,
  SignatureChange,
  // Row types
  EnvironmentRow,
  ActionRow,
  CodeVersionRow,
  InstanceRow,
  ExecutionLogRow,
  SettingRow,
  // Domain types
  Environment,
  Action,
  CodeVersion,
  Instance,
  ExecutionLogEntry,
  Setting,
  // Input types
  EnvironmentInput,
  ActionInput,
  CodeVersionInput,
  InstanceInput,
  ExecutionLogInput,
  SettingInput,
} from './types.js'

import pg from 'pg'
import { createPool, databaseSchemaStatus } from './database.js'
import { runMigrations } from './migrations/runner.js'
import { migrations } from './migrations/index.js'

const MIGRATION_LOCK_KEY = 728_501 // app-unique advisory lock id

/**
 * Convenience function for consumers (e.g. packages/server) to call on startup.
 * Opens the connection pool, runs all migrations under a session advisory
 * lock (safe against concurrent app instances migrating simultaneously), and
 * verifies the resulting schema before returning the pool.
 */
export async function initializeDatabase(databaseUrl: string): Promise<pg.Pool> {
  const pool = createPool(databaseUrl)
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    try {
      await runMigrations(client, migrations)
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    }
  } finally {
    client.release()
  }

  // Permanent rule: a distributed app must guarantee its DB has all required
  // tables on startup. Migrations create them; verify and refuse to serve an
  // incomplete database (e.g. a corrupt/partial db whose _migrations table
  // claims everything is applied while the tables are actually missing).
  const { ok, missingTables } = await databaseSchemaStatus(pool)
  if (!ok) {
    await pool.end()
    throw new Error(
      `[storage] FATAL: schema verification failed after migrations — missing tables: ` +
        `${missingTables.join(', ')} (database: ${safeDbName(databaseUrl)}). Refusing to start.`
    )
  }
  return pool
}

function safeDbName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '') || '(unknown)'
  } catch {
    return '(unparseable url)'
  }
}
