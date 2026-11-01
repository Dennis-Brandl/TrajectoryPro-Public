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

import { Hono } from 'hono'
import { z } from 'zod'
import { v2ErrorBody, type V2ErrorCode } from '../../errors/v2'
import type { V2Session } from '../../middleware/v2/permissions'
import { moveToLibrary } from '../../actions/moveSpecs/moveToLibrary'
import { moveToTeam } from '../../actions/moveSpecs/moveToTeam'

type Variables = { v2Session: V2Session }

export const specificationsMoveV2 = new Hono<{ Variables: Variables }>()

const MoveBody = z.strictObject({ targetLibraryId: z.string().min(1) })

specificationsMoveV2.post('/specifications/:id/move-to-library', async (c) => {
  const session = c.get('v2Session')
  let body: z.infer<typeof MoveBody>
  try {
    body = MoveBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  const result = await moveToLibrary(session, c.req.param('id'), body.targetLibraryId)
  if (!result.ok) return c.json(v2ErrorBody(result.code as V2ErrorCode, result.details), result.status)
  return c.json({
    movedRootIds: result.movedRootIds,
    referencesUpdated: result.referencesUpdated,
    libraryId: body.targetLibraryId,
  })
})

specificationsMoveV2.post('/specifications/:id/copy-to-library', async (c) => {
  const session = c.get('v2Session')
  let body: z.infer<typeof MoveBody>
  try {
    body = MoveBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  const result = await moveToLibrary(session, c.req.param('id'), body.targetLibraryId, 'copy')
  if (!result.ok) return c.json(v2ErrorBody(result.code as V2ErrorCode, result.details), result.status)
  return c.json({ copiedRootIds: result.movedRootIds, libraryId: body.targetLibraryId })
})

const MoveTeamBody = z.strictObject({ targetTeamId: z.string().min(1), targetLibraryId: z.string().min(1) })

specificationsMoveV2.post('/specifications/:id/move-to-team', async (c) => {
  const session = c.get('v2Session')
  let body: z.infer<typeof MoveTeamBody>
  try {
    body = MoveTeamBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  const result = await moveToTeam(session, c.req.param('id'), body.targetTeamId, body.targetLibraryId)
  if (!result.ok) return c.json(v2ErrorBody(result.code as V2ErrorCode, result.details), result.status)
  return c.json({
    movedRootIds: result.movedRootIds,
    libraryId: body.targetLibraryId,
    teamId: body.targetTeamId,
    librariesCreated: result.librariesCreated,
    elementsCopied: result.elementsCopied,
    touchedLibraryIds: result.touchedLibraryIds,
  })
})

specificationsMoveV2.post('/specifications/:id/copy-to-team', async (c) => {
  const session = c.get('v2Session')
  let body: z.infer<typeof MoveTeamBody>
  try {
    body = MoveTeamBody.parse(await c.req.json())
  } catch {
    return c.json(v2ErrorBody('schema_mismatch'), 422)
  }
  const result = await moveToTeam(session, c.req.param('id'), body.targetTeamId, body.targetLibraryId, 'copy')
  if (!result.ok) return c.json(v2ErrorBody(result.code as V2ErrorCode, result.details), result.status)
  return c.json({
    copiedRootIds: result.movedRootIds,
    libraryId: body.targetLibraryId,
    teamId: body.targetTeamId,
    librariesCreated: result.librariesCreated,
    elementsCopied: result.elementsCopied,
    touchedLibraryIds: result.touchedLibraryIds,
  })
})
