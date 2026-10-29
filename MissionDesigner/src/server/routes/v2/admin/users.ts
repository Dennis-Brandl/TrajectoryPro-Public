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

// Phase 5d slice 4 (design §5/D14): the admin "user accounts" surface, replacing
// the legacy /api/users route. Only isAdministrator survives the flag retirement;
// all other capability is team roles (members.ts). Drizzle is used (not rawClient)
// to preserve the exact createdAt (timestamp → ISO) and boolean serialization the
// legacy route produced and AccountsTab already consumes. Admin gate: ./index.ts.

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, ne } from 'drizzle-orm'
import { db } from '../../../lib/db'
import { user, account, session } from '../../../db/schema'
import { v2ErrorBody } from '../../../errors/v2'
import type { V2Session } from '../../../middleware/v2/permissions'
import { createUserAccount, DuplicateEmailError, setUserPassword, UserNotFoundError } from '../../../lib/userCreate'

type Variables = { v2Session: V2Session }

export const adminUsersV2 = new Hono<{ Variables: Variables }>()

const UserPatchBody = z.strictObject({ isAdministrator: z.boolean() })

const UserCreateBody = z.strictObject({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().max(200).optional(),
  isAdministrator: z.boolean().optional(),
})

const UserPasswordBody = z.strictObject({ password: z.string().min(8) })

adminUsersV2.get('/admin/users', async (c) => {
  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isAdministrator: user.isAdministrator,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(user.email)
  return c.json({ users })
})

adminUsersV2.post('/admin/users', async (c) => {
  let body: z.infer<typeof UserCreateBody>
  try {
    body = UserCreateBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }

  let result: { id: string }
  try {
    result = await createUserAccount(body)
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return c.json(v2ErrorBody('conflict', { conflictType: 'unique', table: 'user' }), 409)
    }
    throw err
  }

  const [created] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isAdministrator: user.isAdministrator,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, result.id))
  return c.json({ user: created }, 201)
})

adminUsersV2.patch('/admin/users/:id', async (c) => {
  const userId = c.req.param('id')
  let body: z.infer<typeof UserPatchBody>
  try {
    body = UserPatchBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }

  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId))
  if (!target) return c.json(v2ErrorBody('not_found'), 404)

  // Invariant: never remove the last administrator. Counting admins OTHER than
  // the target handles both self-demotion and demoting any sole admin.
  if (body.isAdministrator === false) {
    const otherAdmins = await db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.isAdministrator, true), ne(user.id, userId)))
    if (otherAdmins.length === 0) return c.json(v2ErrorBody('last_admin'), 409)
  }

  await db.update(user).set({ isAdministrator: body.isAdministrator }).where(eq(user.id, userId))
  const [updated] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isAdministrator: user.isAdministrator,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId))
  return c.json({ user: updated })
})

adminUsersV2.delete('/admin/users/:id', async (c) => {
  const currentUserId = c.get('v2Session').userId
  const userId = c.req.param('id')
  if (userId === currentUserId) return c.json(v2ErrorBody('forbidden', { reason: 'self_delete' }), 403)

  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId))
  if (!target) return c.json(v2ErrorBody('not_found'), 404)

  // Team model: libraries are team-owned. We no longer explicitly delete a user's
  // libraries. Post-cutover the library.userId CASCADE column is dropped and the
  // attribution FKs (library.createdByUserId/lastEditedByUserId,
  // specification.lastEditedByUserId) are ON DELETE SET NULL, so a deleted user's
  // team libraries survive and their attribution blanks. The defensive 409 catch
  // below remains for any future RESTRICT reference.
  await db.delete(session).where(eq(session.userId, userId))
  await db.delete(account).where(eq(account.userId, userId))
  try {
    await db.delete(user).where(eq(user.id, userId))
  } catch (err) {
    if ((err as { code?: string }).code === '23503') {
      return c.json(v2ErrorBody('conflict', { reason: 'user_has_references' }), 409)
    }
    throw err
  }
  return c.body(null, 204)
})

adminUsersV2.post('/admin/users/:id/password', async (c) => {
  let body: z.infer<typeof UserPasswordBody>
  try {
    body = UserPasswordBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  try {
    await setUserPassword(c.req.param('id'), body.password)
  } catch (err) {
    if (err instanceof UserNotFoundError) return c.json(v2ErrorBody('not_found'), 404)
    throw err
  }
  return c.body(null, 204)
})
