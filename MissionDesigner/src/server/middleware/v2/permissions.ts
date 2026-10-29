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

// Phase 35 §2.2: permission predicates + session middleware + origin checks.
// Every handler under /api/v2/* runs these in order:
//   v2RequireOrigin → v2RequireSession → (per-handler canRead/canWrite)
// Multipart handlers add v2RequireMultipartOrigin as an explicit second check.

import type { MiddlewareHandler } from 'hono'
import { auth } from '../../lib/auth'
import { rawQuery } from '../../lib/db'
import { v2ErrorBody } from '../../errors/v2'
import { isOriginAllowed } from '../../lib/deploy-policy'

// Hono context extension: v2 handlers read `c.get('v2Session')` after the
// v2RequireSession middleware runs.
export interface V2Session {
  userId: string
  isAdministrator: boolean
}

export const v2RequireSession: MiddlewareHandler = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user?.id) {
    // Distinct code: the client renders `not_found` as "It may have been deleted", which
    // turned every session expiry into a data-loss scare (2026-08-20). Auth boundary only.
    return c.json(v2ErrorBody('unauthenticated'), 401)
  }
  const [row] = await rawQuery<{ isAdministrator: boolean }>('SELECT "isAdministrator" FROM "user" WHERE "id" = $1', [
    session.user.id,
  ])
  if (!row) {
    // Session references a user that no longer exists. Treat like no session.
    return c.json(v2ErrorBody('unauthenticated'), 401)
  }
  c.set('v2Session', { userId: session.user.id, isAdministrator: Boolean(row.isAdministrator) } satisfies V2Session)
  await next()
}

// Same-origin enforcement for mutating requests. Reads (GET, HEAD) are exempt
// because browsers do not attach cookies to cross-origin image/media requests
// anyway; the cookie-session model handles them.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export const v2RequireOrigin: MiddlewareHandler = async (c, next) => {
  if (!MUTATING_METHODS.has(c.req.method)) {
    return next()
  }
  const origin = c.req.header('origin') ?? ''
  if (!isOriginAllowed(origin, process.env.ALLOWED_ORIGINS)) {
    return c.json(v2ErrorBody('not_found'), 404) // 404 conflation — never reveal origin policy
  }
  await next()
}

// Multipart endpoints re-check explicitly. Some frameworks bypass global
// Origin checks for multipart bodies; this is a belt-and-suspenders guard.
export const v2RequireMultipartOrigin: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('origin') ?? ''
  if (!isOriginAllowed(origin, process.env.ALLOWED_ORIGINS)) {
    return c.json(v2ErrorBody('not_found'), 404)
  }
  await next()
}
