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

import { describe, it, expect, beforeAll } from 'vitest'
import { ROLE_SEEDS, EDIT_LOCKED_STATES_DEFAULT } from '../../authz/rights'

let rawQuery: typeof import('../db').rawQuery
let bootstrapDatabase: typeof import('../db').bootstrapDatabase
let seedRbac: typeof import('../rbacSeed').seedRbac
let seedRoles: typeof import('../rbacSeed').seedRoles

beforeAll(async () => {
  ;({ rawQuery, bootstrapDatabase } = await import('../db'))
  ;({ seedRbac, seedRoles } = await import('../rbacSeed'))
  await bootstrapDatabase()
})

// Wipe RBAC tables in FK-safe order (children before parents) so each case
// is independent. Uses rawQuery for PGlite/Postgres compatibility.
async function wipeRbac(): Promise<void> {
  await rawQuery('DELETE FROM "user_team_role"')
  await rawQuery('DELETE FROM "user_team"')
  await rawQuery('DELETE FROM "role_right"')
  await rawQuery('DELETE FROM "role"')
  await rawQuery('DELETE FROM "library"')
  await rawQuery('DELETE FROM "team"')
  await rawQuery('DELETE FROM "app_setting"')
}

describe('seedRbac (post startup-wizard cutover)', () => {
  it('seeds ONLY the editLockedStates setting — creates no roles and no team', async () => {
    await wipeRbac()
    await seedRbac()
    const [{ n: teams }] = await rawQuery<{ n: string }>('SELECT COUNT(*) AS n FROM "team"')
    const [{ n: roles }] = await rawQuery<{ n: string }>('SELECT COUNT(*) AS n FROM "role"')
    const [{ n: rights }] = await rawQuery<{ n: string }>('SELECT COUNT(*) AS n FROM "role_right"')
    expect(Number(teams)).toBe(0)
    expect(Number(roles)).toBe(0)
    expect(Number(rights)).toBe(0)
    const [setting] = await rawQuery<{ value: string }>(`SELECT "value" FROM "app_setting" WHERE "key" = $1`, [
      'editLockedStates',
    ])
    expect(JSON.parse(setting!.value)).toEqual([...EDIT_LOCKED_STATES_DEFAULT])
  })

  it('is idempotent — running again does not duplicate or throw', async () => {
    await wipeRbac()
    await seedRbac()
    await seedRbac()
    const [{ n }] = await rawQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM "app_setting" WHERE "key" = 'editLockedStates'`,
    )
    expect(Number(n)).toBe(1)
  })
})

describe('seedRoles', () => {
  it('inserts the 16 seeded roles and all their rights, idempotently', async () => {
    await wipeRbac()
    await seedRoles()
    await seedRoles()
    const [{ n: roleCount }] = await rawQuery<{ n: string }>('SELECT COUNT(*) AS n FROM "role"')
    expect(Number(roleCount)).toBe(16)
    const expectedRightRows = ROLE_SEEDS.reduce((n, r) => n + r.rights.length, 0)
    const [{ n: rightCount }] = await rawQuery<{ n: string }>('SELECT COUNT(*) AS n FROM "role_right"')
    expect(Number(rightCount)).toBe(expectedRightRows)
  })
})
