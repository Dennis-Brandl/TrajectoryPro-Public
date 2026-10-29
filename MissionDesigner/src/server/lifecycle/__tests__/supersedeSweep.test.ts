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
import { bootstrapDatabase, rawQuery } from '../../lib/db'
import { supersedeSweep } from '../supersedeSweep'

const T0 = 1_750_000_000_000 // fixed injected clock

beforeAll(async () => {
  await bootstrapDatabase()
  // Insert the persistent team once — never deleted between tests.
  await rawQuery(
    `INSERT INTO "team" ("id", "name", "description", "createdAt", "updatedAt") VALUES ($1, $2, '', $3, $4)
     ON CONFLICT DO NOTHING`,
    ['t1', 'T', T0, T0],
  )
})

beforeEach(async () => {
  // FK-safe teardown — do not delete role/role_right/app_setting (seeded in beforeAll).
  await rawQuery('DELETE FROM "specification"')
  await rawQuery('DELETE FROM "library"')
  await insertLib('lib1')
})

async function insertLib(id: string): Promise<void> {
  await rawQuery(
    `INSERT INTO "library" ("id", "teamId", "name", "entityType", "version", "createdAt", "updatedAt")
     VALUES ($1, 't1', $2, 'workflow', '1.0.0', $3, $4)`,
    [id, `L-${id}`, T0, T0],
  )
}

async function insertRoot(
  id: string,
  name: string,
  version: string,
  state: string,
  effectiveFrom: number | null,
  createdAt = T0,
  libraryId = 'lib1',
): Promise<void> {
  await rawQuery(
    `INSERT INTO "specification" ("id", "libraryId", "name", "version", "state", "data",
       "rootSpecificationId", "parentSpecificationId", "dataSchemaVersion",
       "createdAt", "updatedAt", "effectiveFrom", "history")
     VALUES ($1, $2, $3, $4, $5, '{"nodes":[]}', NULL, NULL, 3, $6, $6, $7, '[]')`,
    [id, libraryId, name, version, state, createdAt, effectiveFrom],
  )
}

async function stateOf(id: string): Promise<string> {
  const [row] = await rawQuery<{ state: string }>('SELECT "state" FROM "specification" WHERE "id" = $1', [id])
  return row.state
}

describe('supersedeSweep', () => {
  it('flips the older in-force Effective version to Superseded with a system history entry', async () => {
    await insertRoot('v1', 'WF', '1.0.0', 'Effective', T0 - 10_000)
    await insertRoot('v2', 'WF', '2.0.0', 'Effective', T0 - 1_000)
    const result = await supersedeSweep(T0)
    expect(result.superseded).toEqual(['v1'])
    expect(await stateOf('v1')).toBe('Superseded')
    expect(await stateOf('v2')).toBe('Effective')
    const [histRow] = await rawQuery<{ history: string }>('SELECT history FROM specification WHERE id = $1', ['v1'])
    const history = JSON.parse(histRow.history) as Array<Record<string, unknown>>
    expect(history[history.length - 1]).toMatchObject({
      type: 'state_change',
      account: 'system',
      system: true,
      fromState: 'Effective',
      toState: 'Superseded',
    })
  })

  it('a future-dated version is not in force and supersedes nothing', async () => {
    await insertRoot('v1', 'WF', '1.0.0', 'Effective', T0 - 1_000)
    await insertRoot('v2', 'WF', '2.0.0', 'Effective', T0 + 1_000_000)
    expect((await supersedeSweep(T0)).superseded).toEqual([])
    expect(await stateOf('v1')).toBe('Effective')
    expect(await stateOf('v2')).toBe('Effective')
  })

  it('is idempotent', async () => {
    await insertRoot('v1', 'WF', '1.0.0', 'Effective', T0 - 10_000)
    await insertRoot('v2', 'WF', '2.0.0', 'Effective', T0 - 1_000)
    expect((await supersedeSweep(T0)).superseded).toEqual(['v1'])
    expect((await supersedeSweep(T0)).superseded).toEqual([])
  })

  it('breaks an effectiveFrom tie by createdAt (newer row wins)', async () => {
    await insertRoot('v1', 'WF', '1.0.0', 'Effective', T0 - 5_000, T0 - 100)
    await insertRoot('v2', 'WF', '2.0.0', 'Effective', T0 - 5_000, T0 - 50)
    expect((await supersedeSweep(T0)).superseded).toEqual(['v1'])
  })

  it('scopes to one library when libraryId is given', async () => {
    await insertLib('lib2')
    await insertRoot('a1', 'WF', '1.0.0', 'Effective', T0 - 10_000)
    await insertRoot('a2', 'WF', '2.0.0', 'Effective', T0 - 1_000)
    await insertRoot('b1', 'WF', '1.0.0', 'Effective', T0 - 10_000, T0, 'lib2')
    await insertRoot('b2', 'WF', '2.0.0', 'Effective', T0 - 1_000, T0, 'lib2')
    expect((await supersedeSweep(T0, 'lib1')).superseded).toEqual(['a1'])
    expect(await stateOf('b1')).toBe('Effective')
  })

  it('treats distinct names as independent lineages', async () => {
    await insertRoot('x1', 'WF-A', '1.0.0', 'Effective', T0 - 10_000)
    await insertRoot('y1', 'WF-B', '1.0.0', 'Effective', T0 - 1_000)
    expect((await supersedeSweep(T0)).superseded).toEqual([])
  })

  it('ignores non-Effective states and NULL effectiveFrom', async () => {
    await insertRoot('v1', 'WF', '1.0.0', 'Approved', T0 - 10_000)
    await insertRoot('v2', 'WF', '2.0.0', 'Effective', null)
    await insertRoot('v3', 'WF', '3.0.0', 'Effective', T0 - 1_000)
    expect((await supersedeSweep(T0)).superseded).toEqual([])
    expect(await stateOf('v1')).toBe('Approved')
    expect(await stateOf('v2')).toBe('Effective')
  })
})
