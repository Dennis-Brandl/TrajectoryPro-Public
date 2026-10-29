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

import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { bootstrapDatabase, rawQuery } from '../../lib/db'

let app: Hono

vi.mock('../../lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: { id: 'u1', email: 'u1@x.com', isAdministrator: true },
        session: { id: 's1', userId: 'u1', token: 't' },
      })),
    },
  },
}))

beforeAll(async () => {
  await bootstrapDatabase()
  const { adminRoutes } = await import('../admin')
  app = new Hono().route('/api', adminRoutes)
})

beforeEach(async () => {
  await rawQuery('DELETE FROM "image_reference"')
  await rawQuery('DELETE FROM "image"')
  await rawQuery('DELETE FROM "image_blob"')
  await rawQuery('DELETE FROM "proxy_reference"')
  await rawQuery('DELETE FROM "specification_environment"')
  await rawQuery('DELETE FROM "library_environment"')
  await rawQuery('DELETE FROM specification')
  await rawQuery('DELETE FROM library')
  await rawQuery('DELETE FROM "user"')

  const NOW = Date.now()
  await rawQuery(
    'INSERT INTO "user" (id, email, "emailVerified", "isAdministrator", "createdAt", "updatedAt") VALUES ($1, $2, false, true, $3, $4)',
    ['u1', 'u1@x.com', NOW, NOW],
  )
  await rawQuery(
    'INSERT INTO team (id, name, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    ['team-default', 'Default Team', '', NOW, NOW],
  )
  await rawQuery(
    `INSERT INTO library (id, "teamId", name, "entityType", version, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['lib', 'team-default', 'L', 'workflow', '1.0.0', NOW, NOW],
  )
  await rawQuery(
    `INSERT INTO specification (id, "libraryId", name, data, "parentSpecificationId", "rootSpecificationId", "createdAt", "updatedAt", "dataSchemaVersion")
     VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8)`,
    ['root', 'lib', 'root', '{"nodes":[]}', 'root', NOW, NOW, 3],
  )
})

describe('admin/libraries route', () => {
  it('GET /admin/libraries returns each library with its team name', async () => {
    const res = await app.request('/api/admin/libraries')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { libraries: Array<{ id: string; teamId: string; teamName: string | null }> }
    const lib = body.libraries.find((l) => l.id === 'lib')
    expect(lib).toBeDefined()
    expect(lib!.teamId).toBe('team-default')
    expect(lib!.teamName).toBe('Default Team')
  })
})

describe('admin/cleanup routes', () => {
  it('GET /admin/cleanup/scans/:scanId returns 404 for unknown id', async () => {
    const res = await app.request('/api/admin/cleanup/scans/nope')
    expect(res.status).toBe(404)
  })

  it('POST /admin/cleanup/scan streams SSE events ending with result', async () => {
    const res = await app.request('/api/admin/cleanup/scan', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    // Each SSE message starts with "data: ". Split and parse.
    const events = text
      .split('\n\n')
      .filter(Boolean)
      .map((chunk) => {
        const line = chunk.split('\n').find((l) => l.startsWith('data: '))
        return line ? JSON.parse(line.slice(6)) : null
      })
      .filter(Boolean) as { type: string; scanId?: string }[]
    expect(events[0].type).toBe('start')
    expect(events[events.length - 1].type).toBe('result')
  })

  it('POST /admin/cleanup/apply returns 404 when scanId unknown', async () => {
    const res = await app.request('/api/admin/cleanup/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scanId: 'nope', findingIds: [] }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /admin/cleanup/apply returns empty results for 0 findings selected', async () => {
    const scanRes = await app.request('/api/admin/cleanup/scan', { method: 'POST' })
    const text = await scanRes.text()
    const resultEvt = text
      .split('\n\n')
      .filter(Boolean)
      .map((chunk) => {
        const line = chunk.split('\n').find((l) => l.startsWith('data: '))
        return line ? JSON.parse(line.slice(6)) : null
      })
      .filter((e) => e && e.type === 'result')[0] as { scanId: string }

    const applyRes = await app.request('/api/admin/cleanup/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scanId: resultEvt.scanId, findingIds: [] }),
    })
    expect(applyRes.status).toBe(200)
    const body = (await applyRes.json()) as { applied: number; skipped: number; failed: number }
    expect(body.applied).toBe(0)
  })
})
