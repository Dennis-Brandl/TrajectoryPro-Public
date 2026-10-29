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

import { describe, it, expect, beforeAll } from 'vitest'
import { bootstrapDatabase, rawQuery } from '../db'

describe('bootstrapDatabase (PGlite)', () => {
  beforeAll(async () => {
    await bootstrapDatabase()
  })

  it('creates all 18 expected tables', async () => {
    const rows = await rawQuery<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
    )
    const names = new Set(rows.map((r) => r.table_name))
    for (const t of [
      'user',
      'session',
      'account',
      'verification',
      'team',
      'user_team',
      'role',
      'role_right',
      'user_team_role',
      'app_setting',
      'library',
      'specification',
      'image_blob',
      'image',
      'image_reference',
      'proxy_reference',
      'library_environment',
      'specification_environment',
    ]) {
      expect(names.has(t), `missing table ${t}`).toBe(true)
    }
  })

  it('enforces an immutability trigger (RAISE EXCEPTION)', async () => {
    const now = Date.now()
    await rawQuery(`INSERT INTO "team"("id","name","createdAt","updatedAt") VALUES ('t1','T',$1,$1)`, [now])
    await rawQuery(
      `INSERT INTO "library"("id","name","entityType","teamId","createdAt","updatedAt") VALUES ('l1','L','step','t1',$1,$1)`,
      [now],
    )
    await expect(rawQuery(`UPDATE "library" SET "id"='l2' WHERE "id"='l1'`)).rejects.toThrow(/library\.id is immutable/)
  })

  it('round-trips a bytea image blob', async () => {
    const buf = Buffer.from([1, 2, 3, 4])
    await rawQuery(
      `INSERT INTO "image_blob"("contentHash","data","mimeType","byteSize","createdAt") VALUES ('h1',$1,'image/png',4,$2)`,
      [buf, Date.now()],
    )
    const [row] = await rawQuery<{ data: Buffer }>(`SELECT "data" FROM "image_blob" WHERE "contentHash"='h1'`)
    expect(Buffer.from(row.data)).toEqual(buf)
  })
})
