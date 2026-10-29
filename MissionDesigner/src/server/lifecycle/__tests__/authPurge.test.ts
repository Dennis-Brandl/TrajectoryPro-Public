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
import { purgeExpiredAuthRows } from '../authPurge'

const NOW = 1_750_000_000_000
const HOUR = 3_600_000

beforeAll(async () => {
  await bootstrapDatabase()
})

beforeEach(async () => {
  await rawQuery('DELETE FROM "session"')
  await rawQuery('DELETE FROM "verification"')
  await rawQuery('DELETE FROM "user" WHERE "id" = $1', ['u-purge'])
  await rawQuery(`INSERT INTO "user" ("id", "name", "email") VALUES ('u-purge', 'P', 'purge@example.com')`)
  for (const [id, delta] of [
    ['old', -HOUR],
    ['new', HOUR],
  ] as const) {
    await rawQuery(
      `INSERT INTO "session" ("id", "userId", "token", "expiresAt")
       VALUES ($1, 'u-purge', $2, to_timestamp($3 / 1000.0))`,
      [`s-${id}`, `tok-${id}`, NOW + delta],
    )
    await rawQuery(
      `INSERT INTO "verification" ("id", "identifier", "value", "expiresAt")
       VALUES ($1, 'i', 'v', to_timestamp($2 / 1000.0))`,
      [`v-${id}`, NOW + delta],
    )
  }
})

describe('purgeExpiredAuthRows', () => {
  it('deletes only expired sessions and verifications', async () => {
    expect(await purgeExpiredAuthRows(NOW)).toEqual({ sessions: 1, verifications: 1 })
    const s = await rawQuery<{ id: string }>('SELECT "id" FROM "session"')
    const v = await rawQuery<{ id: string }>('SELECT "id" FROM "verification"')
    expect(s.map((r) => r.id)).toEqual(['s-new'])
    expect(v.map((r) => r.id)).toEqual(['v-new'])
  })

  it('second run deletes nothing', async () => {
    await purgeExpiredAuthRows(NOW)
    expect(await purgeExpiredAuthRows(NOW)).toEqual({ sessions: 0, verifications: 0 })
  })
})
