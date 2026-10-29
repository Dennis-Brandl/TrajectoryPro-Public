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

// Phase 4a: role CRUD on the GLOBAL catalog (design §3 — only the assignment
// is team-scoped). Rights payloads are validated against the closed RIGHTS
// list. Seeded roles are editable/deletable like any other (§9). Admin gate
// applied by ./index.ts.

import { Hono } from 'hono'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { rawQuery, withTransaction } from '../../../lib/db'
import { v2ErrorBody } from '../../../errors/v2'
import { RIGHTS, ROLE_SEEDS } from '../../../authz/rights'
import type { V2Session } from '../../../middleware/v2/permissions'

type Variables = { v2Session: V2Session }

export const adminRolesV2 = new Hono<{ Variables: Variables }>()

const RoleTemplatesApplyBody = z.strictObject({ roleIds: z.array(z.string()) })

const RoleCreateBody = z.strictObject({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  rights: z.array(z.string()),
})

const RolePatchBody = z
  .strictObject({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    rights: z.array(z.string()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field must be patched' })

interface RoleRow {
  id: string
  name: string
  description: string | null
  isSeeded: number
}

// I2: COUNT(*) returns bigint → string from rawQuery; Number() wraps it.
async function getRole(id: string): Promise<(RoleRow & { rights: string[]; assignmentCount: number }) | undefined> {
  const rows = await rawQuery<RoleRow & { assignmentCount: string }>(
    `SELECT r."id", r."name", r."description", r."isSeeded",
            (SELECT COUNT(*) FROM "user_team_role" utr WHERE utr."roleId" = r."id") AS "assignmentCount"
       FROM "role" r
      WHERE r."id" = $1`,
    [id],
  )
  const role = rows[0]
  if (!role) return undefined
  const rights = (
    await rawQuery<{ right: string }>('SELECT "right" FROM "role_right" WHERE "roleId" = $1 ORDER BY "right"', [id])
  ).map((r) => r.right)
  return { ...role, assignmentCount: Number(role.assignmentCount), rights }
}

async function roleExists(id: string): Promise<boolean> {
  const rows = await rawQuery('SELECT 1 FROM "role" WHERE "id" = $1', [id])
  return rows.length > 0
}

/** Dedupes and validates against the closed RIGHTS list. */
function validateRights(raw: string[]): { ok: true; rights: string[] } | { ok: false; unknown: string[] } {
  const rights = [...new Set(raw)]
  const unknown = rights.filter((r) => !RIGHTS.includes(r))
  if (unknown.length > 0) return { ok: false, unknown }
  return { ok: true, rights }
}

adminRolesV2.get('/admin/roles', async (c) => {
  const roles = await rawQuery<RoleRow & { assignmentCount: string }>(
    `SELECT r."id", r."name", r."description", r."isSeeded",
            (SELECT COUNT(*) FROM "user_team_role" utr WHERE utr."roleId" = r."id") AS "assignmentCount"
       FROM "role" r
      ORDER BY r."name"`,
  )
  const allRights = await rawQuery<{ roleId: string; right: string }>(
    'SELECT "roleId", "right" FROM "role_right" ORDER BY "right"',
  )
  const rightsByRole = new Map<string, string[]>()
  for (const rr of allRights) {
    const list = rightsByRole.get(rr.roleId) ?? []
    list.push(rr.right)
    rightsByRole.set(rr.roleId, list)
  }
  return c.json({
    roles: roles.map((r) => ({
      ...r,
      assignmentCount: Number(r.assignmentCount),
      rights: rightsByRole.get(r.id) ?? [],
    })),
  })
})

adminRolesV2.get('/admin/roles/:id', async (c) => {
  const role = await getRole(c.req.param('id'))
  if (!role) return c.json(v2ErrorBody('not_found'), 404)
  return c.json({ role })
})

adminRolesV2.post('/admin/roles', async (c) => {
  let body: z.infer<typeof RoleCreateBody>
  try {
    body = RoleCreateBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  const checked = validateRights(body.rights)
  if (!checked.ok) return c.json(v2ErrorBody('schema_mismatch', { field: 'rights', unknown: checked.unknown }), 422)

  const id = randomUUID()
  try {
    await withTransaction(async (q) => {
      await q('INSERT INTO "role" ("id","name","description","isSeeded") VALUES ($1,$2,$3,0)', [
        id,
        body.name,
        body.description ?? null,
      ])
      for (const right of checked.rights) {
        await q('INSERT INTO "role_right" ("roleId","right") VALUES ($1,$2)', [id, right])
      }
    })
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return c.json(v2ErrorBody('conflict', { conflictType: 'unique', table: 'role' }), 409)
    }
    throw err
  }
  return c.json({ role: await getRole(id) }, 201)
})

adminRolesV2.patch('/admin/roles/:id', async (c) => {
  const id = c.req.param('id')
  let body: z.infer<typeof RolePatchBody>
  try {
    body = RolePatchBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  if (!(await roleExists(id))) return c.json(v2ErrorBody('not_found'), 404)

  let rights: string[] | null = null
  if (body.rights !== undefined) {
    const checked = validateRights(body.rights)
    if (!checked.ok) return c.json(v2ErrorBody('schema_mismatch', { field: 'rights', unknown: checked.unknown }), 422)
    rights = checked.rights
  }

  try {
    await withTransaction(async (q) => {
      const sets: string[] = []
      const values: unknown[] = []
      let paramIdx = 1
      if (body.name !== undefined) {
        sets.push(`"name" = $${paramIdx++}`)
        values.push(body.name)
      }
      if (body.description !== undefined) {
        sets.push(`"description" = $${paramIdx++}`)
        values.push(body.description)
      }
      if (sets.length > 0) {
        values.push(id)
        await q(`UPDATE "role" SET ${sets.join(', ')} WHERE "id" = $${paramIdx}`, values)
      }
      if (rights !== null) {
        await q('DELETE FROM "role_right" WHERE "roleId" = $1', [id])
        for (const right of rights) {
          await q('INSERT INTO "role_right" ("roleId","right") VALUES ($1,$2)', [id, right])
        }
      }
    })
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return c.json(v2ErrorBody('conflict', { conflictType: 'unique', table: 'role' }), 409)
    }
    throw err
  }
  const updated = await getRole(id)
  if (!updated) return c.json(v2ErrorBody('not_found'), 404) // deleted mid-flight
  return c.json({ role: updated })
})

adminRolesV2.delete('/admin/roles/:id', async (c) => {
  const id = c.req.param('id')
  if (!(await roleExists(id))) return c.json(v2ErrorBody('not_found'), 404)
  // role_right and user_team_role cascade — deleting a role revokes its assignments.
  await rawQuery('DELETE FROM "role" WHERE "id" = $1', [id])
  return c.body(null, 204)
})

adminRolesV2.get('/admin/role-templates', (c) => {
  return c.json({
    roleTemplates: ROLE_SEEDS.map((r) => ({ id: r.id, name: r.name, description: r.description, rights: r.rights })),
  })
})

adminRolesV2.post('/admin/role-templates/apply', async (c) => {
  let body: z.infer<typeof RoleTemplatesApplyBody>
  try {
    body = RoleTemplatesApplyBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  const wanted = new Set(body.roleIds)
  const selected = ROLE_SEEDS.filter((r) => wanted.has(r.id))
  await withTransaction(async (q) => {
    for (const r of selected) {
      await q('INSERT INTO "role" ("id","name","description","isSeeded") VALUES ($1,$2,$3,1) ON CONFLICT DO NOTHING', [
        r.id,
        r.name,
        r.description,
      ])
      for (const right of r.rights) {
        await q('INSERT INTO "role_right" ("roleId","right") VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.id, right])
      }
    }
  })
  return c.json(
    { roles: selected.map((r) => ({ id: r.id, name: r.name, description: r.description, rights: r.rights })) },
    201,
  )
})
