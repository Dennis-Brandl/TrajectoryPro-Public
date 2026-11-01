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

// Seed helpers shared by the cross-team move tests (collectDependencies, copyIntoTeam).

import { seedGlobalTeam } from '../../../lib/rbacSeed'
import { resetAndSeedFixture, rawQuery, type TestFixture } from '../../../routes/v2/__tests__/testSeed'

export const DEST_TEAM = 'team-dest'

/** Standard fixture plus GLOBAL and an empty `team-dest`. */
export async function resetWithTeams(f: TestFixture): Promise<void> {
  await resetAndSeedFixture(f)
  await seedGlobalTeam()
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "team" ("id","name","description","createdAt","updatedAt") VALUES ($1,'Dest Team','fixture',$2,$2)
     ON CONFLICT DO NOTHING`,
    [DEST_TEAM, now],
  )
}

export async function insertLib(id: string, name: string, entityType: string, teamId: string): Promise<void> {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "library" ("id","teamId","createdByUserId","name","entityType","version","description","createdAt","updatedAt")
     VALUES ($1,$2,'test-global',$3,$4,'2.3.0','about ' || $3,$5,$5)`,
    [id, teamId, name, entityType, now],
  )
}

export interface SpecSeed {
  version?: string
  state?: string
  data?: unknown
  parent?: string
  history?: unknown[]
}

/** Inserts a spec row; with `parent`, the row joins that parent's tree. */
export async function insertSpec(id: string, libraryId: string, name: string, o: SpecSeed = {}): Promise<void> {
  const now = Date.now()
  let root = id
  if (o.parent) {
    const [p] = await rawQuery<{ rootSpecificationId: string }>(
      'SELECT "rootSpecificationId" FROM specification WHERE id = $1',
      [o.parent],
    )
    root = p.rootSpecificationId
  }
  await rawQuery(
    `INSERT INTO specification
       (id,"libraryId",name,version,state,data,"rootSpecificationId","parentSpecificationId","dataSchemaVersion",
        history,"createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,3,$9,$10,$10)`,
    [
      id,
      libraryId,
      name,
      o.version ?? '1.0.0',
      o.state ?? 'Draft',
      JSON.stringify(o.data ?? { nodes: [] }),
      root,
      o.parent ?? null,
      JSON.stringify(o.history ?? []),
      now,
    ],
  )
}

export interface SpecRow {
  id: string
  libraryId: string
  name: string
  version: string
  state: string
  data: string
  history: string
  parentSpecificationId: string | null
  rootSpecificationId: string
}

export const rootsIn = (libraryId: string, name: string) =>
  rawQuery<SpecRow>(
    `SELECT * FROM specification WHERE "libraryId" = $1 AND name = $2 AND "parentSpecificationId" IS NULL
      ORDER BY version`,
    [libraryId, name],
  )

export const specById = async (id: string) =>
  (await rawQuery<SpecRow>('SELECT * FROM specification WHERE id = $1', [id]))[0]
