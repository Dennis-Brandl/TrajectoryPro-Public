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
import { bootstrapDatabase } from '../db'
import { auth } from '../auth'

describe('better-auth on pg adapter', () => {
  beforeAll(async () => {
    await bootstrapDatabase()
  })

  it('signs up the first user and promotes them to admin', async () => {
    const res = await auth.api.signUpEmail({
      body: { email: 'admin@example.test', password: 'Password123!', name: 'Admin' },
    })
    expect(res).toBeTruthy()
    const { rawQuery } = await import('../db')
    const [u] = await rawQuery<{ isAdministrator: boolean }>(`SELECT "isAdministrator" FROM "user" WHERE "email"=$1`, [
      'admin@example.test',
    ])
    expect(u.isAdministrator).toBe(true) // databaseHooks.user.create.after fired
  })

  it('ignores isAdministrator on sign-up', async () => {
    const body = {
      email: 'mallory@example.test',
      password: 'Password123!',
      name: 'M',
      isAdministrator: true,
    } as unknown as NonNullable<Parameters<typeof auth.api.signUpEmail>[0]>['body']
    await auth.api.signUpEmail({ body })
    const { rawQuery } = await import('../db')
    const [u] = await rawQuery<{ isAdministrator: boolean }>(`SELECT "isAdministrator" FROM "user" WHERE "email"=$1`, [
      'mallory@example.test',
    ])
    expect(u.isAdministrator).toBe(false)
  })

  it('ignores isAdministrator on update-user', async () => {
    const res = await auth.api.signInEmail({
      body: { email: 'mallory@example.test', password: 'Password123!' },
      asResponse: true,
    })
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    try {
      await auth.api.updateUser({
        body: { isAdministrator: true } as unknown as NonNullable<Parameters<typeof auth.api.updateUser>[0]>['body'],
        headers: new Headers({ cookie }),
      })
    } catch {
      // rejecting the field outright is also acceptable
    }
    const { rawQuery } = await import('../db')
    const [u] = await rawQuery<{ isAdministrator: boolean }>(`SELECT "isAdministrator" FROM "user" WHERE "email"=$1`, [
      'mallory@example.test',
    ])
    expect(u.isAdministrator).toBe(false)
  })
})
