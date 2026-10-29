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
import { bootstrapDatabase, rawQuery } from '../db'
import { isSetupComplete, markSetupComplete, hasAdmin, getSetupStatus, backfillSetupComplete } from '../setupState'

beforeAll(async () => {
  await bootstrapDatabase()
})

beforeEach(async () => {
  await rawQuery('DELETE FROM "app_setting" WHERE "key" = $1', ['setupComplete'])
  await rawQuery('DELETE FROM "user"')
})

describe('setupState', () => {
  it('isSetupComplete is false when the flag is absent', async () => {
    expect(await isSetupComplete()).toBe(false)
  })

  it('markSetupComplete sets the flag; isSetupComplete reads it', async () => {
    await markSetupComplete()
    expect(await isSetupComplete()).toBe(true)
    const [row] = await rawQuery<{ value: string }>('SELECT "value" FROM "app_setting" WHERE "key" = $1', [
      'setupComplete',
    ])
    expect(row.value).toBe('true')
  })

  it('hasAdmin is false with no users, true after an admin is inserted', async () => {
    expect(await hasAdmin()).toBe(false)
    await rawQuery(`INSERT INTO "user" ("id", "email", "isAdministrator") VALUES ('a', 'a@x.test', true)`)
    expect(await hasAdmin()).toBe(true)
  })

  it('getSetupStatus reports hasAdmin from an administrator row', async () => {
    expect(await getSetupStatus()).toEqual({ setupComplete: false, hasAdmin: false })
    await rawQuery(`INSERT INTO "user" ("id", "email", "isAdministrator") VALUES ('a', 'a@x.test', true)`)
    expect(await getSetupStatus()).toEqual({ setupComplete: false, hasAdmin: true })
  })

  it('backfillSetupComplete marks complete when an admin exists', async () => {
    await rawQuery(`INSERT INTO "user" ("id", "email", "isAdministrator") VALUES ('a', 'a@x.test', true)`)
    await backfillSetupComplete()
    expect(await isSetupComplete()).toBe(true)
  })

  it('backfillSetupComplete is a no-op with no admin', async () => {
    await backfillSetupComplete()
    expect(await isSetupComplete()).toBe(false)
  })
})
