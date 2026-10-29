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

// Admin-initiated user creation (design §5.2). better-auth 1.4.18 has no admin
// plugin, so we use the lower-level `$context` internal adapter: hash (scrypt) →
// createUser (persists isAdministrator inline; fires the auto-promote-first-user
// hook) → linkAccount credential. Goes through the server adapter directly, so it
// bypasses the route-level sign-up gate (signupGate.ts) and creates no session.

import { eq } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db'
import { user, session } from '../db/schema'

export class DuplicateEmailError extends Error {
  constructor() {
    super('email already in use')
    this.name = 'DuplicateEmailError'
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super('user not found')
    this.name = 'UserNotFoundError'
  }
}

export interface CreateUserInput {
  email: string
  password: string
  name?: string
  isAdministrator?: boolean
}

export async function createUserAccount(input: CreateUserInput): Promise<{ id: string }> {
  const ctx = await auth.$context
  const email = input.email.toLowerCase()

  const existing = await ctx.internalAdapter.findUserByEmail(email)
  if (existing?.user) throw new DuplicateEmailError()

  const passwordHash = await ctx.password.hash(input.password)

  // Cast needed because the TypeScript type for createUser does not declare
  // additionalFields (isAdministrator) in its parameter type — they flow through
  // at runtime via the drizzle adapter's spread, which is what better-auth's own
  // sign-up route does (parseUserInput result is spread into the createUser arg).
  // The source argument (better-auth 1.7) names who provisioned the user; 'admin'
  // is what better-auth's own admin plugin passes.
  const created = await ctx.internalAdapter.createUser(
    {
      email,
      name: input.name ?? '',
      emailVerified: false,
      isAdministrator: input.isAdministrator ?? false,
    } as Parameters<typeof ctx.internalAdapter.createUser>[0],
    { method: 'admin' },
  )

  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    accountId: created.id,
    providerId: 'credential',
    password: passwordHash,
  })

  return { id: created.id }
}

/**
 * Administrator-set password. Creates the credential account when the user has
 * none (e.g. restored from a backup), otherwise replaces the hash. Signs the user
 * out everywhere by deleting every session row.
 */
export async function setUserPassword(userId: string, password: string): Promise<void> {
  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId))
  if (!target) throw new UserNotFoundError()

  const ctx = await auth.$context
  const hash = await ctx.password.hash(password)
  const accounts = await ctx.internalAdapter.findAccounts(userId)
  if (accounts.some((a) => a.providerId === 'credential')) {
    await ctx.internalAdapter.updatePassword(userId, hash)
  } else {
    await ctx.internalAdapter.linkAccount({
      userId,
      accountId: userId,
      providerId: 'credential',
      password: hash,
    })
  }
  await db.delete(session).where(eq(session.userId, userId))
}
