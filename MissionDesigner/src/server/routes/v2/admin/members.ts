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

// Phase 4a: team membership (visibility) + per-team role assignment (capability).
// Invariant: capability never exists without visibility — assignment auto-creates
// the membership row; membership removal deletes the pair's assignments in the
// same transaction. Admin gate applied by ./index.ts.

import { Hono } from 'hono'
import { z } from 'zod'
import { rawQuery, withTransaction } from '../../../lib/db'
import { v2ErrorBody } from '../../../errors/v2'
import type { V2Session } from '../../../middleware/v2/permissions'

type Variables = { v2Session: V2Session }

export const adminMembersV2 = new Hono<{ Variables: Variables }>()

const RolesBody = z.strictObject({ roleIds: z.array(z.string().min(1)) })

async function teamExists(id: string): Promise<boolean> {
  const rows = await rawQuery('SELECT 1 FROM "team" WHERE "id" = $1', [id])
  return rows.length > 0
}
async function userExists(id: string): Promise<boolean> {
  const rows = await rawQuery('SELECT 1 FROM "user" WHERE "id" = $1', [id])
  return rows.length > 0
}

adminMembersV2.get('/admin/teams/:id/members', async (c) => {
  const teamId = c.req.param('id')
  if (!(await teamExists(teamId))) return c.json(v2ErrorBody('not_found'), 404)

  const members = await rawQuery<{ userId: string; email: string; name: string | null }>(
    `SELECT ut."userId" AS "userId", u."email" AS "email", u."name" AS "name"
       FROM "user_team" ut JOIN "user" u ON u."id" = ut."userId"
      WHERE ut."teamId" = $1
      ORDER BY u."email"`,
    [teamId],
  )
  const assignments = await rawQuery<{ userId: string; roleId: string }>(
    'SELECT "userId","roleId" FROM "user_team_role" WHERE "teamId" = $1 ORDER BY "userId","roleId"',
    [teamId],
  )
  const rolesByUser = new Map<string, string[]>()
  for (const a of assignments) {
    const list = rolesByUser.get(a.userId) ?? []
    list.push(a.roleId)
    rolesByUser.set(a.userId, list)
  }
  return c.json({ members: members.map((m) => ({ ...m, roleIds: rolesByUser.get(m.userId) ?? [] })) })
})

adminMembersV2.get('/admin/users/:id/memberships', async (c) => {
  const userId = c.req.param('id')
  if (!(await userExists(userId))) return c.json(v2ErrorBody('not_found'), 404)

  const teams = await rawQuery<{ teamId: string; teamName: string }>(
    `SELECT ut."teamId" AS "teamId", t."name" AS "teamName"
       FROM "user_team" ut JOIN "team" t ON t."id" = ut."teamId"
      WHERE ut."userId" = $1
      ORDER BY t."name"`,
    [userId],
  )
  const assignments = await rawQuery<{ teamId: string; roleId: string }>(
    'SELECT "teamId","roleId" FROM "user_team_role" WHERE "userId" = $1 ORDER BY "teamId","roleId"',
    [userId],
  )
  const rolesByTeam = new Map<string, string[]>()
  for (const a of assignments) {
    const list = rolesByTeam.get(a.teamId) ?? []
    list.push(a.roleId)
    rolesByTeam.set(a.teamId, list)
  }
  return c.json({ memberships: teams.map((t) => ({ ...t, roleIds: rolesByTeam.get(t.teamId) ?? [] })) })
})

adminMembersV2.put('/admin/teams/:id/members/:userId', async (c) => {
  const teamId = c.req.param('id')
  const userId = c.req.param('userId')
  if (!(await teamExists(teamId)) || !(await userExists(userId))) return c.json(v2ErrorBody('not_found'), 404)
  await rawQuery('INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, teamId])
  return c.body(null, 204)
})

adminMembersV2.delete('/admin/teams/:id/members/:userId', async (c) => {
  const teamId = c.req.param('id')
  const userId = c.req.param('userId')
  if (!(await teamExists(teamId))) return c.json(v2ErrorBody('not_found'), 404)
  await withTransaction(async (q) => {
    // Assignments must not outlive the membership (rights-without-visibility).
    await q('DELETE FROM "user_team_role" WHERE "userId" = $1 AND "teamId" = $2', [userId, teamId])
    await q('DELETE FROM "user_team" WHERE "userId" = $1 AND "teamId" = $2', [userId, teamId])
  })
  return c.body(null, 204)
})

adminMembersV2.put('/admin/teams/:id/members/:userId/roles', async (c) => {
  const teamId = c.req.param('id')
  const userId = c.req.param('userId')
  let body: z.infer<typeof RolesBody>
  try {
    body = RolesBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  if (!(await teamExists(teamId)) || !(await userExists(userId))) return c.json(v2ErrorBody('not_found'), 404)

  const roleIds = [...new Set(body.roleIds)]

  // Validate all requested role ids exist.
  if (roleIds.length > 0) {
    const placeholders = roleIds.map((_, i) => `$${i + 1}`).join(',')
    const validRows = await rawQuery<{ id: string }>(`SELECT "id" FROM "role" WHERE "id" IN (${placeholders})`, roleIds)
    const validSet = new Set(validRows.map((r) => r.id))
    const unknown = roleIds.filter((rid) => !validSet.has(rid))
    if (unknown.length > 0) return c.json(v2ErrorBody('schema_mismatch', { field: 'roleIds', unknown }), 422)
  }

  try {
    await withTransaction(async (q) => {
      // Capability without visibility is inconsistent — assignment implies membership.
      await q('INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, teamId])
      await q('DELETE FROM "user_team_role" WHERE "userId" = $1 AND "teamId" = $2', [userId, teamId])
      for (const rid of roleIds) {
        await q('INSERT INTO "user_team_role" ("userId","teamId","roleId") VALUES ($1,$2,$3)', [userId, teamId, rid])
      }
    })
  } catch (err) {
    // The existence checks above run outside this transaction. In-process that
    // window is narrowed by the async existence pre-checks, but a concurrent
    // server process can still delete the role/user/team in between —
    // surface a clean 409 instead of a 500.
    if ((err as { code?: string }).code === '23503') {
      return c.json(v2ErrorBody('conflict', { conflictType: 'foreign_key' }), 409)
    }
    throw err
  }

  const rows = await rawQuery<{ roleId: string }>(
    'SELECT "roleId" FROM "user_team_role" WHERE "userId" = $1 AND "teamId" = $2 ORDER BY "roleId"',
    [userId, teamId],
  )
  return c.json({ roleIds: rows.map((r) => r.roleId) })
})
