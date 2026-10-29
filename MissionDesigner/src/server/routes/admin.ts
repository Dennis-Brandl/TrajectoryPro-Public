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
import { streamSSE } from 'hono/streaming'
import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'
import { auth } from '../lib/auth'
import { db, checkDatabaseSchema } from '../lib/db'
import { user, library, specification, team } from '../db/schema'
import { scanAll } from '../admin/cleanup/scan'
import { applyFindings } from '../admin/cleanup/apply'
import { reportCache } from '../admin/cleanup/reportCache'
import { cleanupMutex } from '../admin/cleanup/mutex'

type Variables = {
  user: typeof user.$inferSelect
  session: { id: string; userId: string; token: string }
}

const adminRoutes = new Hono<{ Variables: Variables }>()

const requireAdmin = async (c: Context<{ Variables: Variables }>, next: Next) => {
  const s = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!s?.user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const currentUser = s.user as typeof user.$inferSelect
  if (currentUser.isAdministrator !== true) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  c.set('user', currentUser)
  c.set('session', s.session as Variables['session'])
  await next()
}

adminRoutes.use('/admin/*', requireAdmin)

// GET /api/admin/libraries?entityType=X - List all libraries from all users with owner info
adminRoutes.get('/admin/libraries', async (c) => {
  const entityTypeFilter = c.req.query('entityType')

  let rows
  if (entityTypeFilter) {
    rows = await db
      .select({
        id: library.id,
        createdByUserId: library.createdByUserId,
        name: library.name,
        entityType: library.entityType,
        description: library.description,
        createdAt: library.createdAt,
        updatedAt: library.updatedAt,
        teamId: library.teamId,
        teamName: team.name,
        ownerName: user.name,
        ownerEmail: user.email,
      })
      .from(library)
      .leftJoin(user, eq(library.createdByUserId, user.id))
      .leftJoin(team, eq(library.teamId, team.id))
      .where(eq(library.entityType, entityTypeFilter))
  } else {
    rows = await db
      .select({
        id: library.id,
        createdByUserId: library.createdByUserId,
        name: library.name,
        entityType: library.entityType,
        description: library.description,
        createdAt: library.createdAt,
        updatedAt: library.updatedAt,
        teamId: library.teamId,
        teamName: team.name,
        ownerName: user.name,
        ownerEmail: user.email,
      })
      .from(library)
      .leftJoin(user, eq(library.createdByUserId, user.id))
      .leftJoin(team, eq(library.teamId, team.id))
  }

  return c.json({ libraries: rows })
})

// GET /api/admin/specifications?libraryId=X - List all specs in a library (no ownership check)
adminRoutes.get('/admin/specifications', async (c) => {
  const libraryId = c.req.query('libraryId')
  if (!libraryId) {
    return c.json({ error: 'libraryId query parameter is required' }, 400)
  }

  const rows = await db
    .select({
      id: specification.id,
      libraryId: specification.libraryId,
      name: specification.name,
      description: specification.description,
      typeName: specification.typeName,
      createdAt: specification.createdAt,
      updatedAt: specification.updatedAt,
    })
    .from(specification)
    .where(eq(specification.libraryId, libraryId))

  return c.json({ specifications: rows })
})

// DELETE /api/admin/specifications/:id - Delete a specification and its recursive children
adminRoutes.delete('/admin/specifications/:id', async (c) => {
  const id = c.req.param('id')

  const [existing] = await db.select().from(specification).where(eq(specification.id, id)).limit(1)
  if (!existing) {
    return c.json({ error: 'Specification not found' }, 404)
  }

  // Recursive delete: find child specs (specs whose data.parentSpecificationId points to this one)
  const deleteRecursive = async (specId: string) => {
    // Find children by scanning all specs in the same library
    const allSpecs = await db.select().from(specification).where(eq(specification.libraryId, existing.libraryId))
    for (const spec of allSpecs) {
      try {
        const data = JSON.parse(spec.data) as Record<string, unknown>
        if (data.parentSpecificationId === specId) {
          await deleteRecursive(spec.id)
        }
      } catch {
        // Skip unparseable specs
      }
    }
    await db.delete(specification).where(eq(specification.id, specId))
  }

  await deleteRecursive(id)
  return c.json({ success: true })
})

// GET /api/admin/db-check - Compare database schema against expected
adminRoutes.get('/admin/db-check', async (c) => {
  const results = await checkDatabaseSchema(false)
  const allOk = results.every((r) => r.status === 'ok')
  return c.json({ status: allOk ? 'ok' : 'mismatch', tables: results })
})

// POST /api/admin/db-fix - Auto-fix missing columns
adminRoutes.post('/admin/db-fix', async (c) => {
  const results = await checkDatabaseSchema(true)
  const allOk = results.every((r) => r.status === 'ok')
  return c.json({ status: allOk ? 'ok' : 'partial', tables: results })
})

// POST /api/admin/cleanup/scan — stream SSE events
adminRoutes.post('/admin/cleanup/scan', (c) => {
  return streamSSE(c, async (stream) => {
    for await (const evt of scanAll()) {
      await stream.writeSSE({ data: JSON.stringify(evt) })
    }
  })
})

// GET /api/admin/cleanup/scans/:scanId — fetch cached report (fallback for dropped SSE)
adminRoutes.get('/admin/cleanup/scans/:scanId', (c) => {
  const report = reportCache.get(c.req.param('scanId'))
  if (!report) return c.json({ error: 'ReportNotFound' }, 404)
  return c.json(report)
})

// POST /api/admin/cleanup/apply — apply selected findings
adminRoutes.post('/admin/cleanup/apply', async (c) => {
  const body = (await c.req.json()) as { scanId?: string; findingIds?: string[] }
  if (typeof body.scanId !== 'string' || !Array.isArray(body.findingIds)) {
    return c.json({ error: 'Invalid body' }, 400)
  }
  const report = reportCache.get(body.scanId)
  if (!report) return c.json({ error: 'ReportNotFound' }, 404)
  if (!cleanupMutex.acquire()) return c.json({ error: 'Busy' }, 409)
  try {
    const results = await applyFindings(report, body.findingIds)
    const applied = results.filter((r) => r.result === 'applied').length
    const skipped = results.filter((r) => r.result === 'skipped').length
    const failed = results.filter((r) => r.result === 'failed').length
    return c.json({ applied, skipped, failed, results })
  } finally {
    cleanupMutex.release()
  }
})

export { adminRoutes }
