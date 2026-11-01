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
const DEST = 'lib-dest'
const DEST_WF = 'lib-dest-wf'

beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetWithTeams(f)
  await insertLib(DEST, 'Dest', 'workflow', f.teamMainId)
  await insertLib(DEST_WF, 'Dest Workflows', 'workflow', DEST_TEAM)
  mockSessionAs(null)
})

const copyToLibrary = (specId: string, targetLibraryId = DEST) =>
  v2Req(f, 'POST', `/api/v2/specifications/${specId}/copy-to-library`, { json: { targetLibraryId } })
const copyToTeam = (specId: string, targetLibraryId = DEST_WF, targetTeamId = DEST_TEAM) =>
  v2Req(f, 'POST', `/api/v2/specifications/${specId}/copy-to-team`, { json: { targetTeamId, targetLibraryId } })

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

const links = async (specId: string) =>
  (
    await rawQuery<{ environmentLibraryId: string }>(
      'SELECT "environmentLibraryId" FROM specification_environment WHERE "specificationId" = $1',
      [specId],
    )
  ).map((l) => l.environmentLibraryId)

/** Two versions of W1 using environment env-x; version 1.0.0 embeds a child workflow. */
async function seedWorkflow() {
  await insertLib('lib-env-a', 'Env A', 'environment', f.teamMainId)
  await insertSpec('env-x', 'lib-env-a', 'EnvX', { state: 'Approved' })
  await insertSpec('w-1', f.libSharedId, 'W1', {
    state: 'Effective',
    history: [{ type: 'created', at: 'x', account: 'a', version: '1.0.0' }],
    data: {
      nodes: [{ id: 'n1', type: 'workflowProxy', data: { embeddedWorkflowSpecId: 'w-1-child' } }],
      environmentSpecIds: ['env-x'],
    },
  })
  await insertSpec('w-1-child', f.libSharedId, 'Child', { parent: 'w-1', data: { nodes: [] } })
  await insertSpec('w-2', f.libSharedId, 'W1', {
    version: '1.1.0',
    data: { nodes: [], environmentSpecIds: ['env-x'] },
  })
  await rawQuery(
    `INSERT INTO specification_environment ("specificationId","environmentLibraryId") VALUES ('w-1','lib-env-a'),('w-2','lib-env-a')`,
  )
}

describe('POST /api/v2/specifications/:id/copy-to-library', () => {
  it('copies every version and child with new ids; the source stays exactly as it was', async () => {
    await seedWorkflow()
    const before = await specById('w-1')
    mockSessionAs(await seedAdminUser(f))
    const res = await copyToLibrary('w-2')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { copiedRootIds: string[]; libraryId: string }
    expect(body.libraryId).toBe(DEST)

    const copies = await rootsIn(DEST, 'W1')
    expect(copies.map((c) => [c.version, c.state])).toEqual([
      ['1.0.0', 'Effective'],
      ['1.1.0', 'Draft'],
    ])
    expect(copies.map((c) => c.id).sort()).toEqual([...body.copiedRootIds].sort())
    expect(copies.some((c) => c.id === 'w-1' || c.id === 'w-2')).toBe(false)
    for (const c of copies) expect(c.rootSpecificationId).toBe(c.id)

    // The copied tree points at its own child, and still at the same environment.
    const data = JSON.parse(copies[0].data) as {
      nodes: { data: { embeddedWorkflowSpecId: string } }[]
      environmentSpecIds: string[]
    }
    const childId = data.nodes[0].data.embeddedWorkflowSpecId
    expect(childId).not.toBe('w-1-child')
    expect((await specById(childId)).parentSpecificationId).toBe(copies[0].id)
    expect((await specById(childId)).libraryId).toBe(DEST)
    expect(data.environmentSpecIds).toEqual(['env-x'])

    const hist = JSON.parse(copies[0].history) as Array<Record<string, unknown>>
    expect(hist).toHaveLength(2)
    expect(hist[1]).toMatchObject({ type: 'copied', fromSpecId: 'w-1', fromLibraryId: f.libSharedId })

    expect(await links(copies[0].id)).toEqual(['lib-env-a'])
    const libLinks = await rawQuery<{ environmentLibraryId: string }>(
      'SELECT "environmentLibraryId" FROM library_environment WHERE "libraryId" = $1',
      [DEST],
    )
    expect(libLinks.map((l) => l.environmentLibraryId)).toEqual(['lib-env-a'])

    expect(await specById('w-1')).toEqual(before)
    expect(await links('w-1')).toEqual(['lib-env-a'])
  })

  it('copying an action leaves references to the original alone', async () => {
    await insertLib('lib-act', 'Act', 'action', f.teamMainId)
    await insertLib('lib-act2', 'Act2', 'action', f.teamMainId)
    await insertLib('lib-env-a', 'Env A', 'environment', f.teamMainId)
    await insertSpec('a-1', 'lib-act', 'Mix')
    const envData = { included_actions: [{ action_library: 'Act', action_name: 'Mix' }] }
    await insertSpec('env-y', 'lib-env-a', 'EnvY', { state: 'Approved', data: envData })
    mockSessionAs(await seedAdminUser(f))
    expect((await copyToLibrary('a-1', 'lib-act2')).status).toBe(200)
    expect((await rootsIn('lib-act2', 'Mix')).length).toBe(1)
    expect((await specById('a-1')).libraryId).toBe('lib-act')
    expect(JSON.parse((await specById('env-y')).data)).toEqual(envData)
  })

  it('409 move_name_conflict when the destination already has that name; nothing is copied', async () => {
    await seedWorkflow()
    await insertSpec('other', DEST, 'W1', { version: '9.0.0' })
    mockSessionAs(await seedAdminUser(f))
    const res = await copyToLibrary('w-1')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'move_name_conflict', libraryName: 'Dest', name: 'W1' })
    expect((await rootsIn(DEST, 'W1')).map((r) => r.id)).toEqual(['other'])
  })

  it('403 naming workflow:create for a Librarian without create rights', async () => {
    await seedWorkflow()
    await addUser('wf-librarian', f.teamMainId, ['role-workflow-librarian'])
    mockSessionAs('wf-librarian')
    const res = await copyToLibrary('w-1')
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'forbidden', missing: ['workflow:create'] })
    expect(await rootsIn(DEST, 'W1')).toEqual([])
  })

  it('403 without the Librarian pair, same as a move', async () => {
    await seedWorkflow()
    await addUser('only-author', f.teamMainId, ['role-author'])
    mockSessionAs('only-author')
    expect((await copyToLibrary('w-1')).status).toBe(403)
  })

  it('422 when the destination is the source library', async () => {
    await seedWorkflow()
    mockSessionAs(await seedAdminUser(f))
    expect((await copyToLibrary('w-1', f.libSharedId)).status).toBe(422)
  })
})

describe('POST /api/v2/specifications/:id/copy-to-team', () => {
  it('copies the workflow and its missing dependencies; the source team keeps everything', async () => {
    await seedWorkflow()
    const before = await specById('w-1')
    mockSessionAs(await seedAdminUser(f))
    const res = await copyToTeam('w-2')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      copiedRootIds: string[]
      teamId: string
      elementsCopied: number
      librariesCreated: { id: string; name: string }[]
      touchedLibraryIds: string[]
    }
    expect(body.teamId).toBe(DEST_TEAM)
    expect(body.elementsCopied).toBe(1)
    expect(body.librariesCreated.map((l) => l.name)).toEqual(['Env A'])

    const copies = await rootsIn(DEST_WF, 'W1')
    expect(copies.map((c) => c.state)).toEqual(['Effective', 'Draft'])
    const envLib = body.librariesCreated[0].id
    const [envCopy] = await rootsIn(envLib, 'EnvX')
    expect(envCopy.id).not.toBe('env-x')
    for (const c of copies) {
      expect((JSON.parse(c.data) as { environmentSpecIds: string[] }).environmentSpecIds).toEqual([envCopy.id])
      expect(await links(c.id)).toEqual([envLib])
    }
    const libLinks = await rawQuery<{ environmentLibraryId: string }>(
      'SELECT "environmentLibraryId" FROM library_environment WHERE "libraryId" = $1',
      [DEST_WF],
    )
    expect(libLinks.map((l) => l.environmentLibraryId)).toEqual([envLib])

    expect(await specById('w-1')).toEqual(before)
    expect((await specById('w-2')).libraryId).toBe(f.libSharedId)
    expect((await specById('env-x')).libraryId).toBe('lib-env-a')
    expect(await links('w-1')).toEqual(['lib-env-a'])
  })

  it('403 naming workflow:create rolls back dependency copies', async () => {
    await insertSpec('w-solo', f.libSharedId, 'Solo')
    await addUser('both', f.teamMainId, ['role-librarian'])
    await addUser('both', DEST_TEAM, ['role-librarian'])
    mockSessionAs('both')
    const res = await copyToTeam('w-solo')
    expect(res.status).toBe(403)
    expect(((await res.json()) as { missing: string[] }).missing).toContain('workflow:create')
    expect(await rootsIn(DEST_WF, 'Solo')).toEqual([])
  })

  it('409 move_name_conflict on a clash', async () => {
    await seedWorkflow()
    await insertSpec('other', DEST_WF, 'W1')
    mockSessionAs(await seedAdminUser(f))
    expect((await copyToTeam('w-1')).status).toBe(409)
  })

  it('422 for the same team', async () => {
    await seedWorkflow()
    mockSessionAs(await seedAdminUser(f))
    expect((await copyToTeam('w-1', DEST, f.teamMainId)).status).toBe(422)
  })
})
