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

// Phase 4a: team CRUD. Raw SQL via rawQuery (async Postgres). Admin gate applied by ./index.ts.

import { GLOBAL_TEAM_ID } from '@/lib/global-team'
import { Hono } from 'hono'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { rawQuery } from '../../../lib/db'
import { v2ErrorBody } from '../../../errors/v2'
import type { V2Session } from '../../../middleware/v2/permissions'

type Variables = { v2Session: V2Session }

export const adminTeamsV2 = new Hono<{ Variables: Variables }>()

const TeamCreateBody = z.strictObject({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
})

const TeamPatchBody = z
  .strictObject({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field must be patched' })

interface TeamRow {
  id: string
  name: string
  description: string | null
  createdAt: number
  updatedAt: number
}

// I2: bigint columns (createdAt/updatedAt) arrive as strings from rawQuery → Number() wrap.
async function getTeam(id: string): Promise<TeamRow | undefined> {
  const rows = await rawQuery<{
    id: string
    name: string
    description: string | null
    createdAt: string
    updatedAt: string
  }>('SELECT "id","name","description","createdAt","updatedAt" FROM "team" WHERE "id" = $1', [id])
  if (!rows[0]) return undefined
  const r = rows[0]
  return { ...r, createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt) }
}

adminTeamsV2.get('/admin/teams', async (c) => {
  const rows = await rawQuery<{
    id: string
    name: string
    description: string | null
    createdAt: string
    updatedAt: string
    memberCount: string
    libraryCount: string
  }>(
    `SELECT t."id", t."name", t."description", t."createdAt", t."updatedAt",
            (SELECT COUNT(*) FROM "user_team" ut WHERE ut."teamId" = t."id") AS "memberCount",
            (SELECT COUNT(*) FROM "library" l WHERE l."teamId" = t."id") AS "libraryCount"
       FROM "team" t
      ORDER BY t."name"`,
  )
  const teams = rows.map((t) => ({
    ...t,
    createdAt: Number(t.createdAt),
    updatedAt: Number(t.updatedAt),
    memberCount: Number(t.memberCount),
    libraryCount: Number(t.libraryCount),
  }))
  return c.json({ teams })
})

adminTeamsV2.post('/admin/teams', async (c) => {
  let body: z.infer<typeof TeamCreateBody>
  try {
    body = TeamCreateBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  const id = randomUUID()
  const now = Date.now()
  try {
    await rawQuery('INSERT INTO "team" ("id","name","description","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5)', [
      id,
      body.name,
      body.description ?? null,
      now,
      now,
    ])
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '23505') {
      return c.json(v2ErrorBody('conflict', { conflictType: 'unique', table: 'team' }), 409)
    }
    throw err
  }
  return c.json({ team: await getTeam(id) }, 201)
})

adminTeamsV2.patch('/admin/teams/:id', async (c) => {
  const id = c.req.param('id')
  let body: z.infer<typeof TeamPatchBody>
  try {
    body = TeamPatchBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  const current = await getTeam(id)
  if (!current) return c.json(v2ErrorBody('not_found'), 404)
  // The Teams dialog always resends the name; only a real rename of GLOBAL is refused.
  if (id === GLOBAL_TEAM_ID && body.name !== undefined && body.name !== current.name) {
    return c.json(v2ErrorBody('global_team_protected'), 409)
  }

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
  sets.push(`"updatedAt" = $${paramIdx++}`)
  values.push(Date.now())
  values.push(id)
  try {
    await rawQuery(`UPDATE "team" SET ${sets.join(', ')} WHERE "id" = $${paramIdx}`, values)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '23505') {
      return c.json(v2ErrorBody('conflict', { conflictType: 'unique', table: 'team' }), 409)
    }
    throw err
  }
  const updated = await getTeam(id)
  if (!updated) return c.json(v2ErrorBody('not_found'), 404) // deleted mid-flight
  return c.json({ team: updated })
})

adminTeamsV2.delete('/admin/teams/:id', async (c) => {
  const id = c.req.param('id')
  if (!(await getTeam(id))) return c.json(v2ErrorBody('not_found'), 404)
  if (id === GLOBAL_TEAM_ID) return c.json(v2ErrorBody('global_team_protected'), 409)
  try {
    // user_team / user_team_role cascade; library.teamId has NO cascade —
    // a team that still owns libraries fails the FK and maps to 409 (plan decision).
    await rawQuery('DELETE FROM "team" WHERE "id" = $1', [id])
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '23503') {
      return c.json(v2ErrorBody('team_not_empty', { reason: 'owns_libraries' }), 409)
    }
    throw err
  }
  return c.body(null, 204)
})
