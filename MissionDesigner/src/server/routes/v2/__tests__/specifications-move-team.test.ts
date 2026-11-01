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
import { GLOBAL_TEAM_ID } from '@/lib/global-team'
import { setupTestFixture, mockSessionAs, seedAdminUser, v2Req, rawQuery, type TestFixture } from './testSeed'
import {
  DEST_TEAM,
  insertLib,
  insertSpec,
  resetWithTeams,
  rootsIn,
  specById,
} from '../../../actions/moveSpecs/__tests__/moveSeed'

let f: TestFixture
const DEST_WF = 'lib-dest-wf'

beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetWithTeams(f)
  await insertLib(DEST_WF, 'Dest Workflows', 'workflow', DEST_TEAM)
  mockSessionAs(null)
})

const moveTo = (specId: string, targetLibraryId = DEST_WF, targetTeamId = DEST_TEAM) =>
  v2Req(f, 'POST', `/api/v2/specifications/${specId}/move-to-team`, { json: { targetTeamId, targetLibraryId } })

async function addUser(id: string, teamId: string, roleIds: string[]) {
  await rawQuery(
    `INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt") VALUES ($1,$2,false,now(),now())
     ON CONFLICT DO NOTHING`,
    [id, `${id}@example.com`],
  )
  await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, teamId])
  for (const r of roleIds) {
    await rawQuery(`INSERT INTO "user_team_role" ("userId","teamId","roleId") VALUES ($1,$2,$3)`, [id, teamId, r])
  }
}

const dataOf = async (id: string) => JSON.parse((await specById(id)).data)
const libraryTeam = async (specId: string) =>
  (
    await rawQuery<{ teamId: string }>(
      'SELECT l."teamId" FROM specification s JOIN library l ON l.id = s."libraryId" WHERE s.id = $1',
      [specId],
    )
  )[0]?.teamId
const count = async (table: string) =>
  Number((await rawQuery<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0].n)

/** Two versions of W1 in the source team, both using environment env-x (library Env A). */
async function seedWorkflowWithEnv() {
  await insertLib('lib-env-a', 'Env A', 'environment', f.teamMainId)
  await insertSpec('env-x', 'lib-env-a', 'EnvX', { state: 'Approved' })
  await insertSpec('w-1', f.libSharedId, 'W1', {
    state: 'Effective',
    data: {
      nodes: [{ id: 'n1', data: { environmentSpecId: 'env-x' } }],
      environmentSpecIds: ['env-x'],
    },
  })
  await insertSpec('w-2', f.libSharedId, 'W1', {
    version: '1.1.0',
    state: 'Draft',
    data: { nodes: [], environmentSpecIds: ['env-x'] },
  })
  await rawQuery(
    `INSERT INTO specification_environment ("specificationId","environmentLibraryId") VALUES ('w-1','lib-env-a'),('w-2','lib-env-a')`,
  )
  await rawQuery(`INSERT INTO library_environment ("libraryId","environmentLibraryId") VALUES ($1,'lib-env-a')`, [
    f.libSharedId,
  ])
}

describe('POST /api/v2/specifications/:id/move-to-team', () => {
  it('moves every version to the other team keeping ids, states and history', async () => {
    await seedWorkflowWithEnv()
    await addUser(f.userIdGlobal, DEST_TEAM, ['role-librarian', 'role-author'])
    mockSessionAs(f.userIdGlobal)
    const res = await moveTo('w-2')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body.movedRootIds as string[]).sort()).toEqual(['w-1', 'w-2'])
    expect(body).toMatchObject({ libraryId: DEST_WF, teamId: DEST_TEAM, elementsCopied: 1 })
    expect(await libraryTeam('w-1')).toBe(DEST_TEAM)
    expect((await specById('w-1')).state).toBe('Effective')
    expect((await specById('w-2')).state).toBe('Draft')
    const hist = JSON.parse((await specById('w-1')).history) as Array<Record<string, unknown>>
    expect(hist[hist.length - 1]).toMatchObject({
      type: 'moved',
      fromTeamId: f.teamMainId,
      toTeamId: DEST_TEAM,
    })
  })

  it('copies missing environments and points the workflow at them; the source team keeps its own', async () => {
    await seedWorkflowWithEnv()
    mockSessionAs(await seedAdminUser(f))
    const res = await moveTo('w-1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { librariesCreated: { id: string; name: string }[]; touchedLibraryIds: string[] }
    expect(body.librariesCreated.map((l) => l.name)).toEqual(['Env A'])
    expect(body.touchedLibraryIds).toEqual(body.librariesCreated.map((l) => l.id))

    const [copied] = await rawQuery<{ id: string; libraryId: string }>(
      `SELECT s.id, s."libraryId" FROM specification s JOIN library l ON l.id = s."libraryId"
        WHERE s.name = 'EnvX' AND l."teamId" = $1`,
      [DEST_TEAM],
    )
    expect(copied.id).not.toBe('env-x')
    for (const id of ['w-1', 'w-2']) {
      const d = await dataOf(id)
      expect(d.environmentSpecIds).toEqual([copied.id])
      for (const n of d.nodes as { data: { environmentSpecId: string } }[]) {
        expect(n.data.environmentSpecId).toBe(copied.id)
      }
      const links = await rawQuery<{ environmentLibraryId: string }>(
        'SELECT "environmentLibraryId" FROM specification_environment WHERE "specificationId" = $1',
        [id],
      )
      expect(links.map((l) => l.environmentLibraryId)).toEqual([copied.libraryId])
    }
    const libLinks = await rawQuery<{ environmentLibraryId: string }>(
      'SELECT "environmentLibraryId" FROM library_environment WHERE "libraryId" = $1',
      [DEST_WF],
    )
    expect(libLinks.map((l) => l.environmentLibraryId)).toEqual([copied.libraryId])

    // The source team keeps its environment, its library and the old library link.
    expect((await specById('env-x')).libraryId).toBe('lib-env-a')
    expect(await libraryTeam('env-x')).toBe(f.teamMainId)
    expect(await count('library_environment')).toBe(2)
  })

  it('copies a sub-workflow and remaps the reference to it', async () => {
    await insertLib('lib-sub', 'Subs', 'step', f.teamMainId)
    await insertSpec('sub-1', 'lib-sub', 'Sub')
    await insertSpec('w-1', f.libSharedId, 'W1', {
      data: { nodes: [{ id: 'n1', data: { referencedStepSpecId: 'sub-1', referencedStepLibraryId: 'lib-sub' } }] },
    })
    mockSessionAs(await seedAdminUser(f))
    expect((await moveTo('w-1')).status).toBe(200)
    const d = await dataOf('w-1')
    const [sub] = await rawQuery<{ id: string; libraryId: string }>(
      `SELECT s.id, s."libraryId" FROM specification s JOIN library l ON l.id = s."libraryId"
        WHERE s.name = 'Sub' AND l."teamId" = $1`,
      [DEST_TEAM],
    )
    expect(d.nodes[0].data.referencedStepSpecId).toBe(sub.id)
    expect(d.nodes[0].data.referencedStepLibraryId).toBe(sub.libraryId)
  })

  it('reuses an existing same-named destination library without changing its contents', async () => {
    await seedWorkflowWithEnv()
    await insertLib('dest-env-a', 'Env A', 'environment', DEST_TEAM)
    await insertSpec('dest-other', 'dest-env-a', 'Other')
    mockSessionAs(await seedAdminUser(f))
    const res = await moveTo('w-1')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { librariesCreated: unknown[] }).librariesCreated).toEqual([])
    const names = await rawQuery<{ name: string }>(
      'SELECT name FROM specification WHERE "libraryId" = $1 AND "parentSpecificationId" IS NULL ORDER BY name',
      ['dest-env-a'],
    )
    // EnvX is added (it was missing there); the existing element is untouched.
    expect(names.map((n) => n.name)).toEqual(['EnvX', 'Other'])
    expect((await specById('dest-other')).data).toBe('{"nodes":[]}')
    const copied = (await rootsIn('dest-env-a', 'EnvX'))[0]
    expect((await dataOf('w-1')).environmentSpecIds).toEqual([copied.id])
  })

  describe('rights', () => {
    it('403 when the user is Librarian in only one team', async () => {
      await seedWorkflowWithEnv()
      mockSessionAs(f.userIdGlobal) // Librarian in team-main only
      const res = await moveTo('w-1')
      expect(res.status).toBe(403)
      expect(((await res.json()) as { missing: string[] }).missing).toContain('workflow:library.create')
      expect(await libraryTeam('w-1')).toBe(f.teamMainId)
    })

    it('200 for a Librarian in both teams', async () => {
      await seedWorkflowWithEnv()
      await addUser('both', f.teamMainId, ['role-librarian'])
      await addUser('both', DEST_TEAM, ['role-librarian', 'role-author'])
      mockSessionAs('both')
      expect((await moveTo('w-1')).status).toBe(200)
    })

    it('200 for an administrator', async () => {
      await seedWorkflowWithEnv()
      mockSessionAs(await seedAdminUser(f))
      expect((await moveTo('w-1')).status).toBe(200)
    })

    it('403 with missing when the destination needs an environment library the user cannot create; nothing changes', async () => {
      await seedWorkflowWithEnv()
      await addUser('wf-only', f.teamMainId, ['role-librarian'])
      await addUser('wf-only', DEST_TEAM, ['role-workflow-librarian'])
      mockSessionAs('wf-only')
      const libsBefore = await count('library')
      const specsBefore = await count('specification')
      const res = await moveTo('w-1')
      expect(res.status).toBe(403)
      const body = (await res.json()) as { code: string; missing: string[] }
      expect(body.code).toBe('forbidden')
      expect(body.missing).toContain('environment:library.create')
      expect(await count('library')).toBe(libsBefore)
      expect(await count('specification')).toBe(specsBefore)
      expect(await libraryTeam('w-1')).toBe(f.teamMainId)
      expect(JSON.parse((await specById('w-1')).history)).toEqual([])
      expect((await dataOf('w-1')).environmentSpecIds).toEqual(['env-x'])
    })
  })

  describe('validation', () => {
    it('409 move_name_conflict in the destination library', async () => {
      await insertSpec('w-1', f.libSharedId, 'W1')
      await insertSpec('dest-w', DEST_WF, 'W1', { version: '9.0.0' })
      mockSessionAs(await seedAdminUser(f))
      const res = await moveTo('w-1')
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ code: 'move_name_conflict', libraryName: 'Dest Workflows', name: 'W1' })
      expect(await libraryTeam('w-1')).toBe(f.teamMainId)
    })

    it('422 move_target_invalid for the same team', async () => {
      await insertLib('lib-same', 'Same', 'workflow', f.teamMainId)
      mockSessionAs(await seedAdminUser(f))
      const res = await moveTo(f.rootSpecId, 'lib-same', f.teamMainId)
      expect(res.status).toBe(422)
      expect(((await res.json()) as { code: string }).code).toBe('move_target_invalid')
    })

    it('422 for a non-workflow element', async () => {
      await insertSpec('env-1', f.libEnvSharedId, 'E1')
      mockSessionAs(await seedAdminUser(f))
      const res = await moveTo('env-1')
      expect(res.status).toBe(422)
      expect(((await res.json()) as { code: string }).code).toBe('move_target_invalid')
    })

    it('422 for a non-workflow target library', async () => {
      await insertLib('dest-env', 'Dest Env', 'environment', DEST_TEAM)
      mockSessionAs(await seedAdminUser(f))
      const res = await moveTo(f.rootSpecId, 'dest-env')
      expect(res.status).toBe(422)
      expect(((await res.json()) as { code: string }).code).toBe('move_target_invalid')
    })

    it('422 for GLOBAL as the target team', async () => {
      mockSessionAs(await seedAdminUser(f))
      const res = await moveTo(f.rootSpecId, DEST_WF, GLOBAL_TEAM_ID)
      expect(res.status).toBe(422)
    })

    it('422 schema_mismatch for a bad body', async () => {
      mockSessionAs(await seedAdminUser(f))
      const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/move-to-team`, { json: {} })
      expect(res.status).toBe(422)
      expect(((await res.json()) as { code: string }).code).toBe('schema_mismatch')
    })
  })
})
