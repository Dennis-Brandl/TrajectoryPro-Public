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
import { rawQuery, bootstrapDatabase } from '../db'

let createUserAccount: typeof import('../userCreate').createUserAccount
let DuplicateEmailError: typeof import('../userCreate').DuplicateEmailError
let setUserPassword: typeof import('../userCreate').setUserPassword
let UserNotFoundError: typeof import('../userCreate').UserNotFoundError

beforeAll(async () => {
  await bootstrapDatabase()
  const mod = await import('../userCreate')
  createUserAccount = mod.createUserAccount
  DuplicateEmailError = mod.DuplicateEmailError
  setUserPassword = mod.setUserPassword
  UserNotFoundError = mod.UserNotFoundError
})

beforeEach(async () => {
  await rawQuery('DELETE FROM session')
  await rawQuery('DELETE FROM account')
  await rawQuery('DELETE FROM "user"')
  // Pre-seed an admin so the auto-promote-first-user hook never fires in these tests.
  // isAdministrator is boolean in Postgres (not 0/1).
  await rawQuery(`INSERT INTO "user" (id, email, "isAdministrator") VALUES ($1, $2, $3)`, [
    'seed-admin',
    'admin@x.test',
    true,
  ])
})

describe('createUserAccount', () => {
  it('creates a user (lowercased email) with a credential account and the given admin flag', async () => {
    const { id } = await createUserAccount({
      email: 'New@X.test',
      password: 'password123',
      name: 'New User',
      isAdministrator: false,
    })
    const [u] = await rawQuery<{ email: string; name: string | null; isAdministrator: boolean }>(
      'SELECT email, name, "isAdministrator" FROM "user" WHERE id = $1',
      [id],
    )
    expect(u.email).toBe('new@x.test')
    expect(u.name).toBe('New User')
    // isAdministrator is a Postgres boolean — resolves to false (not 0).
    expect(u.isAdministrator).toBe(false)
    const [acct] = await rawQuery<{ password: string | null }>(
      `SELECT password FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`,
      [id],
    )
    expect(acct?.password).toBeTruthy()
  })

  it('honors isAdministrator: true', async () => {
    const { id } = await createUserAccount({ email: 'boss@x.test', password: 'password123', isAdministrator: true })
    const [u] = await rawQuery<{ isAdministrator: boolean }>('SELECT "isAdministrator" FROM "user" WHERE id = $1', [id])
    // isAdministrator is a Postgres boolean — resolves to true (not 1).
    expect(u.isAdministrator).toBe(true)
  })

  it('throws DuplicateEmailError on an existing email (case-insensitive)', async () => {
    await createUserAccount({ email: 'dupe@x.test', password: 'password123' })
    await expect(createUserAccount({ email: 'DUPE@x.test', password: 'password123' })).rejects.toBeInstanceOf(
      DuplicateEmailError,
    )
  })
})

describe('setUserPassword', () => {
  async function verifyFor(userId: string, password: string): Promise<boolean> {
    const { auth } = await import('../auth')
    const ctx = await auth.$context
    const [acct] = await rawQuery<{ password: string }>(
      `SELECT password FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`,
      [userId],
    )
    return ctx.password.verify({ hash: acct.password, password })
  }

  it('gives a password-less user a working credential', async () => {
    await rawQuery(`INSERT INTO "user" (id, email, "isAdministrator") VALUES ($1, $2, $3)`, [
      'no-pw',
      'nopw@x.test',
      false,
    ])
    await setUserPassword('no-pw', 'newpass123')
    const rows = await rawQuery(`SELECT id FROM account WHERE "userId" = 'no-pw' AND "providerId" = 'credential'`)
    expect(rows).toHaveLength(1)
    expect(await verifyFor('no-pw', 'newpass123')).toBe(true)
  })

  it('replaces an existing password and signs the user out', async () => {
    const { id } = await createUserAccount({ email: 'has@x.test', password: 'oldpass123' })
    await rawQuery(
      `INSERT INTO session (id, "userId", token, "expiresAt") VALUES ('s1', $1, 'tok-1', now() + interval '1 day')`,
      [id],
    )
    await setUserPassword(id, 'newpass123')
    expect(await verifyFor(id, 'oldpass123')).toBe(false)
    expect(await verifyFor(id, 'newpass123')).toBe(true)
    const sessions = await rawQuery(`SELECT id FROM session WHERE "userId" = $1`, [id])
    expect(sessions).toHaveLength(0)
    const accts = await rawQuery(`SELECT id FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`, [id])
    expect(accts).toHaveLength(1)
  })

  it('unknown user throws UserNotFoundError', async () => {
    await expect(setUserPassword('ghost', 'newpass123')).rejects.toBeInstanceOf(UserNotFoundError)
  })
})
