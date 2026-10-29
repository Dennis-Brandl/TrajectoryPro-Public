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

import type pg from 'pg'
import type { Queryable } from './database.js'
import { EnvironmentRepository } from './repositories/environment.repository.js'
import { ActionRepository } from './repositories/action.repository.js'
import { CodeVersionRepository } from './repositories/code-version.repository.js'
import { InstanceRepository } from './repositories/instance.repository.js'
import { LogRepository } from './repositories/log.repository.js'
import { SettingsRepository } from './repositories/settings.repository.js'

export interface TransactionRepos {
  environments: EnvironmentRepository
  actions: ActionRepository
  codeVersions: CodeVersionRepository
  instances: InstanceRepository
  log: LogRepository
  settings: SettingsRepository
}

export interface TransactionRunner {
  inTransaction<T>(fn: (tx: { q: Queryable; repos: TransactionRepos }) => Promise<T>): Promise<T>
}

function buildRepos(q: Queryable): TransactionRepos {
  return {
    environments: new EnvironmentRepository(q),
    actions: new ActionRepository(q),
    codeVersions: new CodeVersionRepository(q),
    instances: new InstanceRepository(q),
    log: new LogRepository(q),
    settings: new SettingsRepository(q),
  }
}

/**
 * Cross-repository atomic operations. All statements inside fn run on ONE
 * checked-out client inside BEGIN/COMMIT; use tx.repos (bound to that client),
 * never the pool-bound repositories, inside the callback.
 */
export function createTransactionHelper(pool: pg.Pool): TransactionRunner {
  return {
    async inTransaction<T>(
      fn: (tx: { q: Queryable; repos: TransactionRepos }) => Promise<T>
    ): Promise<T> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn({ q: client, repos: buildRepos(client) })
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
    },
  }
}

/** Test variant over a single serialized connection (PGlite): BEGIN/COMMIT as plain SQL. */
export function createTestTransactionHelper(q: Queryable): TransactionRunner {
  return {
    async inTransaction<T>(
      fn: (tx: { q: Queryable; repos: TransactionRepos }) => Promise<T>
    ): Promise<T> {
      await q.query('BEGIN')
      try {
        const result = await fn({ q, repos: buildRepos(q) })
        await q.query('COMMIT')
        return result
      } catch (err) {
        await q.query('ROLLBACK')
        throw err
      }
    },
  }
}
