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

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestFixture, resetAndSeedFixture, rawQuery, type TestFixture } from '../../routes/v2/__tests__/testSeed'
import { buildEnvSpecLookup } from '../envSpecLookup'
import { GLOBAL_TEAM_ID } from '@/lib/global-team'

let f: TestFixture
const q = <R>(sql: string, params?: unknown[]) => rawQuery<R>(sql, params)

beforeAll(async () => {
  f = await setupTestFixture()
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
  const now = Date.now()
  for (const [id, name] of [
    ['team-other', 'Other Team'],
    [GLOBAL_TEAM_ID, 'GLOBAL'],
  ]) {
    await rawQuery(
      `INSERT INTO "team" ("id","name","createdAt","updatedAt") VALUES ($1,$2,$3,$3) ON CONFLICT DO NOTHING`,
      [id, name, now],
    )
  }
})

async function seedEnv(libId: string, teamId: string, specId: string) {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "library" ("id","teamId","name","entityType","version","createdAt","updatedAt")
     VALUES ($1,$2,'Plant Env','environment','1.0.0',$3,$3)`,
    [libId, teamId, now],
  )
  await rawQuery(
    `INSERT INTO "specification" ("id","libraryId","name","version","state","data",
       "rootSpecificationId","parentSpecificationId","dataSchemaVersion","createdAt","updatedAt")
     VALUES ($1,$2,'Line 1','1.0.0','Draft','{}',$1,NULL,3,$3,$3)`,
    [specId, libId, now],
  )
}

describe('buildEnvSpecLookup — same-named environment libraries in several teams', () => {
  it("prefers the import's target team over GLOBAL and other teams, whatever the row order", async () => {
    await seedEnv('env-main', f.teamMainId, 'spec-main')
    await seedEnv('env-global', GLOBAL_TEAM_ID, 'spec-global')
    await seedEnv('env-other', 'team-other', 'spec-other')
    const lookup = await buildEnvSpecLookup(q, f.teamMainId)
    expect(lookup.get('Plant Env')?.get('Line 1')).toBe('spec-main')
  })

  it("prefers GLOBAL over another team's library when the target team has none", async () => {
    await seedEnv('env-global', GLOBAL_TEAM_ID, 'spec-global')
    await seedEnv('env-other', 'team-other', 'spec-other')
    const lookup = await buildEnvSpecLookup(q, f.teamMainId)
    expect(lookup.get('Plant Env')?.get('Line 1')).toBe('spec-global')
  })
})
