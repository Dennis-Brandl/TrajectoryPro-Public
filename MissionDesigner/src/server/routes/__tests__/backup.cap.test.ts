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

// @vitest-environment node

import { vi, describe, it, expect, beforeAll } from 'vitest'
import { Hono } from 'hono'
import { bootstrapDatabase, rawQuery } from '../../lib/db'

vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
// A tiny cap so a real export can exceed it without building 100 MB.
vi.mock('../../limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../limits')>()),
  MAX_BACKUP_UPLOAD_BYTES: 4096,
}))

import { backupRoutes } from '../backup'
import { auth } from '../../lib/auth'

const app = new Hono()
app.route('/api', backupRoutes)

beforeAll(async () => {
  await bootstrapDatabase()
})

describe('GET /api/backup against the upload cap', () => {
  it('answers 413 backup_too_large when the finished zip is larger than the cap', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'u1', name: 'Admin', email: 'a@x.io', isAdministrator: true },
      session: { id: 's1', userId: 'u1', token: 't1' },
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>)
    const blob = Buffer.alloc(8192, 7)
    await rawQuery(
      `INSERT INTO "image_blob" ("contentHash","data","mimeType","byteSize","createdAt","refCount") VALUES ('hcap',$1,'image/png',$2,$3,0)`,
      [blob, blob.length, Date.now()],
    )
    const res = await app.fetch(new Request('http://localhost/api/backup'))
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: string; code: string; message: string }
    expect(body).toMatchObject({ error: 'backup_too_large', code: 'backup_too_large' })
    expect(body.message).toMatch(/^This Designer holds more than a backup can restore \(the backup file is /)
  })
})
