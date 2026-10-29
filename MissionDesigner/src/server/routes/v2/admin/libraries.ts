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
// Spec 2026-10-12 §4.7: move a library (and every child library under it) to another
// team — the way an existing library enters or leaves GLOBAL. Admin gate applied by ./index.ts.

import { Hono } from 'hono'
import { z } from 'zod'
import { withTransaction } from '../../../lib/db'
import { v2ErrorBody } from '../../../errors/v2'
import type { V2Session } from '../../../middleware/v2/permissions'
import { GLOBAL_TEAM_ID, allowedInGlobal } from '@/lib/global-team'

type Variables = { v2Session: V2Session }

export const adminLibrariesV2 = new Hono<{ Variables: Variables }>()

const MoveBody = z.strictObject({ teamId: z.string().min(1), force: z.boolean().optional() })

type Q = <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>

/**
 * How many libraries and specs outside the target team would be left pointing across a team
 * boundary they can no longer see after the move (review 2026-10-12, Important 2): other teams'
 * bindings to a moved environment library, environments naming a moved action library, and a
 * moved workflow/step library's own bindings — library- or spec-level — to environments that
 * stay behind. Moving INTO GLOBAL is never counted — everyone keeps access.
 */
async function countCrossTeamReferences(q: Q, ids: string[], teamId: string): Promise<number> {
  const [row] = await q<{ n: string }>(
    `WITH tree AS (SELECT "id","name","entityType","environmentLibraryIds" FROM "library" WHERE "id" = ANY($1::text[])),
          outside AS (SELECT * FROM "library" WHERE NOT ("id" = ANY($1::text[])) AND "teamId" <> $2)
     SELECT
       -- incoming: another team's library binds a moved environment library
       (SELECT COUNT(*) FROM outside o
         WHERE EXISTS (SELECT 1 FROM tree t WHERE t."entityType" = 'environment'
                         AND (o."environmentLibraryIds" LIKE '%"' || t."id" || '"%'
                              OR EXISTS (SELECT 1 FROM "library_environment" le
                                          WHERE le."libraryId" = o."id" AND le."environmentLibraryId" = t."id"))))
       -- incoming: another team's spec binds a moved environment library or one of its specs
     + (SELECT COUNT(*) FROM "specification" s JOIN outside o ON o."id" = s."libraryId"
         WHERE EXISTS (SELECT 1 FROM "specification_environment" se JOIN tree t ON t."id" = se."environmentLibraryId"
                        WHERE se."specificationId" = s."id")
            OR EXISTS (SELECT 1 FROM "specification" es JOIN tree t ON t."id" = es."libraryId"
                        WHERE t."entityType" = 'environment' AND s."data" LIKE '%"' || es."id" || '"%'))
       -- incoming: another team's environment names a moved action library
     + (SELECT COUNT(*) FROM "specification" s JOIN outside o ON o."id" = s."libraryId"
         WHERE o."entityType" = 'environment'
           AND EXISTS (SELECT 1 FROM tree t WHERE t."entityType" = 'action'
                         AND (s."data" LIKE '%"action_library":"' || t."name" || '"%'
                              OR s."data" LIKE '%"actionLibrary":"' || t."name" || '"%')))
       -- outgoing: a moved library binds an environment library that stays in another team
     + (SELECT COUNT(*) FROM tree t
         WHERE EXISTS (SELECT 1 FROM outside e WHERE e."entityType" = 'environment' AND e."teamId" <> $3
                         AND (t."environmentLibraryIds" LIKE '%"' || e."id" || '"%'
                              OR EXISTS (SELECT 1 FROM "library_environment" le
                                          WHERE le."libraryId" = t."id" AND le."environmentLibraryId" = e."id"))))
       -- outgoing: a moved spec binds an environment (library or spec) that stays in another team
     + (SELECT COUNT(*) FROM "specification" s JOIN tree t ON t."id" = s."libraryId"
         WHERE EXISTS (SELECT 1 FROM "specification_environment" se JOIN outside e ON e."id" = se."environmentLibraryId"
                        WHERE se."specificationId" = s."id" AND e."teamId" <> $3)
            OR EXISTS (SELECT 1 FROM "specification" es JOIN outside e ON e."id" = es."libraryId"
                        WHERE e."entityType" = 'environment' AND e."teamId" <> $3
                          AND s."data" LIKE '%"' || es."id" || '"%'))
       AS n`,
    [ids, teamId, GLOBAL_TEAM_ID],
  )
  return Number(row?.n ?? 0)
}

class MoveRefused extends Error {
  constructor(
    public status: 404 | 409 | 422,
    public body: Record<string, unknown>,
  ) {
    super('move refused')
  }
}

adminLibrariesV2.post('/admin/libraries/:id/move', async (c) => {
  const id = c.req.param('id')
  let body: z.infer<typeof MoveBody>
  try {
    body = MoveBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }

  try {
    const moved = await withTransaction(async (q) => {
      const [lib] = await q<{ parentLibraryId: string | null; entityType: string; teamId: string }>(
        `SELECT "parentLibraryId", "entityType", "teamId" FROM "library" WHERE "id" = $1`,
        [id],
      )
      if (!lib) throw new MoveRefused(404, v2ErrorBody('not_found'))
      if (lib.parentLibraryId) throw new MoveRefused(422, v2ErrorBody('schema_mismatch', { field: 'parentLibraryId' }))
      const [team] = await q(`SELECT 1 FROM "team" WHERE "id" = $1`, [body.teamId])
      if (!team) throw new MoveRefused(404, v2ErrorBody('not_found', { field: 'teamId' }))
      if (body.teamId === GLOBAL_TEAM_ID && !allowedInGlobal(lib.entityType)) {
        throw new MoveRefused(422, v2ErrorBody('schema_mismatch', { field: 'entityType' }))
      }
      if (lib.teamId === body.teamId) return 0
      // The (teamId, name, entityType, parentLibraryId) unique index cannot catch this: a root's
      // parentLibraryId is NULL, and NULLs never collide. Check the name in the target team.
      const [clash] = await q(
        `SELECT 1 FROM "library" l JOIN "library" me ON me."id" = $1
          WHERE l."teamId" = $2 AND l."name" = me."name" AND l."entityType" = me."entityType"
            AND l."parentLibraryId" IS NULL`,
        [id, body.teamId],
      )
      if (clash) throw new MoveRefused(409, v2ErrorBody('conflict', { conflictType: 'unique', table: 'library' }))

      const tree = await q<{ id: string }>(
        `WITH RECURSIVE tree(id) AS (
           SELECT "id" FROM "library" WHERE "id" = $1
           UNION ALL
           SELECT l."id" FROM "library" l JOIN tree t ON l."parentLibraryId" = t.id
         )
         SELECT id FROM tree`,
        [id],
      )
      const ids = tree.map((r) => r.id)
      if (body.teamId !== GLOBAL_TEAM_ID && !body.force) {
        const references = await countCrossTeamReferences(q, ids, body.teamId)
        if (references > 0) {
          throw new MoveRefused(409, v2ErrorBody('conflict', { conflictType: 'referenced', references }))
        }
      }
      await q(`UPDATE "library" SET "teamId" = $1, "updatedAt" = $2 WHERE "id" = ANY($3::text[])`, [
        body.teamId,
        Date.now(),
        ids,
      ])
      return ids.length
    })
    return c.json({ moved })
  } catch (err) {
    if (err instanceof MoveRefused) return c.json(err.body, err.status)
    if ((err as { code?: string }).code === '23505') {
      return c.json(v2ErrorBody('conflict', { conflictType: 'unique', table: 'library' }), 409)
    }
    throw err
  }
})
