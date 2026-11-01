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
import { withTransaction } from '../../../lib/db'
import { loadElement, type Querier } from '../../../actions/moveSpecs/loadElement'
import { seedGlobalTeam } from '../../../lib/rbacSeed'
import {
  setupTestFixture,
  resetAndSeedFixture,
  mockSessionAs,
  seedAdminUser,
  v2Req,
  rawQuery,
  type TestFixture,
} from './testSeed'

let f: TestFixture
const DEST = 'lib-dest'

beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetAndSeedFixture(f)
  await seedGlobalTeam()
  mockSessionAs(null)
})

async function insertLib(id: string, name: string, entityType: string, teamId: string) {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO "library" ("id","teamId","createdByUserId","name","entityType","version","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,'1.0.0',$6,$6)`,
    [id, teamId, f.userIdGlobal, name, entityType, now],
  )
}

async function insertSpec(
  id: string,
  libraryId: string,
  name: string,
  version: string,
  state: string,
  parent: string | null = null,
  root: string = id,
) {
  const now = Date.now()
  await rawQuery(
    `INSERT INTO specification
       (id,"libraryId",name,version,state,data,"rootSpecificationId","parentSpecificationId","dataSchemaVersion","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,'{"nodes":[]}',$6,$7,3,$8,$8)`,
    [id, libraryId, name, version, state, root, parent, now],
  )
}

const libOf = async (id: string) =>
  (await rawQuery<{ libraryId: string }>('SELECT "libraryId" FROM specification WHERE id = $1', [id]))[0]?.libraryId

const move = (specId: string, targetLibraryId: string) =>
  v2Req(f, 'POST', `/api/v2/specifications/${specId}/move-to-library`, { json: { targetLibraryId } })

async function addUser(id: string, teamId: string, roleIds: string[]) {
  await rawQuery(
    `INSERT INTO "user" ("id","email","emailVerified","createdAt","updatedAt") VALUES ($1,$2,false,now(),now())`,
    [id, `${id}@example.com`],
  )
  await rawQuery(`INSERT INTO "user_team" ("userId","teamId") VALUES ($1,$2)`, [id, teamId])
  for (const r of roleIds) {
    await rawQuery(`INSERT INTO "user_team_role" ("userId","teamId","roleId") VALUES ($1,$2,$3)`, [id, teamId, r])
  }
}

describe('POST /api/v2/specifications/:id/move-to-library', () => {
  it('moves every version and child, keeping ids, states and history', async () => {
    await insertLib(DEST, 'Dest Lib', 'workflow', f.teamMainId)
    await insertSpec('a-1', f.libSharedId, 'A', '1.0.0', 'Effective')
    await insertSpec('a-2', f.libSharedId, 'A', '1.1.0', 'Draft')
    await insertSpec('a-2-child', f.libSharedId, 'A Child', '1.0.0', 'Draft', 'a-2', 'a-2')
    mockSessionAs(f.userIdGlobal)

    const res = await move('a-2-child', DEST) // a child id resolves to its element
    expect(res.status).toBe(200)
    const body = (await res.json()) as { movedRootIds: string[]; referencesUpdated: number; libraryId: string }
    expect(body.movedRootIds.sort()).toEqual(['a-1', 'a-2'])
    expect(body.referencesUpdated).toBe(0)
    expect(body.libraryId).toBe(DEST)

    for (const id of ['a-1', 'a-2', 'a-2-child']) expect(await libOf(id)).toBe(DEST)
    const rows = await rawQuery<{ id: string; state: string; rootSpecificationId: string; history: string }>(
      `SELECT id, state, "rootSpecificationId", history FROM specification WHERE id IN ('a-1','a-2')`,
    )
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(by['a-1'].state).toBe('Effective')
    expect(by['a-2'].state).toBe('Draft')
    expect(by['a-2'].rootSpecificationId).toBe('a-2')
    for (const id of ['a-1', 'a-2']) {
      const hist = JSON.parse(by[id].history) as Array<Record<string, unknown>>
      expect(hist[hist.length - 1]).toMatchObject({
        type: 'moved',
        fromLibraryId: f.libSharedId,
        toLibraryId: DEST,
      })
    }
  })

  it('leaves other elements in the source library alone', async () => {
    await insertLib(DEST, 'Dest Lib', 'workflow', f.teamMainId)
    await insertSpec('a-1', f.libSharedId, 'A', '1.0.0', 'Draft')
    mockSessionAs(f.userIdGlobal)
    expect((await move('a-1', DEST)).status).toBe(200)
    expect(await libOf(f.rootSpecId)).toBe(f.libSharedId)
    const hist = await rawQuery<{ history: string }>('SELECT history FROM specification WHERE id = $1', [f.rootSpecId])
    expect(JSON.parse(hist[0].history)).toEqual([])
  })

  it('409 move_name_conflict when the destination has a root of the same name (any version)', async () => {
    await insertLib(DEST, 'Dest Lib', 'workflow', f.teamMainId)
    await insertSpec('a-1', f.libSharedId, 'A', '1.0.0', 'Draft')
    await insertSpec('a-dest', DEST, 'A', '9.0.0', 'Obsolete')
    mockSessionAs(f.userIdGlobal)
    const res = await move('a-1', DEST)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      code: 'move_name_conflict',
      libraryName: 'Dest Lib',
      name: 'A',
    })
    expect(await libOf('a-1')).toBe(f.libSharedId)
  })

  describe('422 move_target_invalid', () => {
    it('same library', async () => {
      mockSessionAs(f.userIdGlobal)
      const res = await move(f.rootSpecId, f.libSharedId)
      expect(res.status).toBe(422)
      expect(((await res.json()) as { code: string }).code).toBe('move_target_invalid')
    })
    it('different entity type', async () => {
      mockSessionAs(f.userIdGlobal)
      const res = await move(f.rootSpecId, f.libEnvSharedId)
      expect(res.status).toBe(422)
      expect(((await res.json()) as { code: string }).code).toBe('move_target_invalid')
    })
    it('step-library elements cannot be moved', async () => {
      await insertLib('step-a', 'Steps A', 'step', f.teamMainId)
      await insertLib('step-b', 'Steps B', 'step', f.teamMainId)
      await insertSpec('step-1', 'step-a', 'Step1', '1.0.0', 'Draft')
      mockSessionAs(f.userIdGlobal)
      const res = await move('step-1', 'step-b')
      expect(res.status).toBe(422)
      expect(await res.json()).toMatchObject({ code: 'move_target_invalid', reason: 'unsupported_type' })
      expect(await libOf('step-1')).toBe('step-a')
    })
    it('library in another non-GLOBAL team', async () => {
      await rawQuery(
        `INSERT INTO "team" ("id","name","description","createdAt","updatedAt") VALUES ('team-two','Two','x',1,1)`,
      )
      await insertLib('lib-two', 'Two Lib', 'workflow', 'team-two')
      mockSessionAs(f.userIdGlobal)
      const res = await move(f.rootSpecId, 'lib-two')
      expect(res.status).toBe(422)
      expect(((await res.json()) as { code: string }).code).toBe('move_target_invalid')
      expect(await libOf(f.rootSpecId)).toBe(f.libSharedId)
    })
    it('workflow into GLOBAL (the database forbids GLOBAL workflow libraries, so the only GLOBAL target is another type)', async () => {
      await insertLib('lib-global-wf', 'Global Env', 'environment', GLOBAL_TEAM_ID)
      const admin = await seedAdminUser(f)
      mockSessionAs(admin)
      const res = await move(f.rootSpecId, 'lib-global-wf')
      expect(res.status).toBe(422)
      expect(((await res.json()) as { code: string }).code).toBe('move_target_invalid')
    })
  })

  describe('environment into a GLOBAL environment library', () => {
    beforeEach(async () => {
      await insertLib('lib-global-env', 'Global Env', 'environment', GLOBAL_TEAM_ID)
      await insertSpec('env-1', f.libEnvSharedId, 'Env One', '1.0.0', 'Draft')
    })
    it('200 for an administrator', async () => {
      mockSessionAs(await seedAdminUser(f))
      expect((await move('env-1', 'lib-global-env')).status).toBe(200)
      expect(await libOf('env-1')).toBe('lib-global-env')
    })
    it('403 for a team Librarian without GLOBAL rights', async () => {
      mockSessionAs(f.userIdGlobal)
      const res = await move('env-1', 'lib-global-env')
      expect(res.status).toBe(403)
      expect(await libOf('env-1')).toBe(f.libEnvSharedId)
    })
  })

  describe('rights', () => {
    beforeEach(async () => {
      await insertLib(DEST, 'Dest Lib', 'workflow', f.teamMainId)
    })
    it('403 for an Author without Librarian', async () => {
      await addUser('only-author', f.teamMainId, ['role-author'])
      mockSessionAs('only-author')
      expect((await move(f.rootSpecId, DEST)).status).toBe(403)
      expect(await libOf(f.rootSpecId)).toBe(f.libSharedId)
    })
    it('200 for a user with role-workflow-librarian only', async () => {
      await addUser('wf-librarian', f.teamMainId, ['role-workflow-librarian'])
      mockSessionAs('wf-librarian')
      expect((await move(f.rootSpecId, DEST)).status).toBe(200)
    })
    it('200 for an administrator who is not a team member', async () => {
      mockSessionAs(await seedAdminUser(f))
      expect((await move(f.rootSpecId, DEST)).status).toBe(200)
    })
  })

  it('404 for a spec the caller cannot see', async () => {
    await insertLib(DEST, 'Dest Lib', 'workflow', f.teamMainId)
    mockSessionAs(f.userIdOther)
    expect((await move(f.rootSpecId, DEST)).status).toBe(404)
  })

  it('422 schema_mismatch for a bad body', async () => {
    mockSessionAs(f.userIdGlobal)
    const res = await v2Req(f, 'POST', `/api/v2/specifications/${f.rootSpecId}/move-to-library`, { json: {} })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('schema_mismatch')
  })
})

async function setData(id: string, data: unknown) {
  await rawQuery('UPDATE specification SET data = $1 WHERE id = $2', [JSON.stringify(data), id])
}
const dataOf = async (id: string) =>
  JSON.parse((await rawQuery<{ data: string }>('SELECT data FROM specification WHERE id = $1', [id]))[0].data)
const specEnvLibs = async (specId: string) =>
  (
    await rawQuery<{ environmentLibraryId: string }>(
      'SELECT "environmentLibraryId" FROM specification_environment WHERE "specificationId" = $1 ORDER BY 1',
      [specId],
    )
  ).map((r) => r.environmentLibraryId)
const libEnvLibs = async (libId: string) =>
  (
    await rawQuery<{ environmentLibraryId: string }>(
      'SELECT "environmentLibraryId" FROM library_environment WHERE "libraryId" = $1 ORDER BY 1',
      [libId],
    )
  ).map((r) => r.environmentLibraryId)
const historyOf = async (id: string) =>
  JSON.parse(
    (await rawQuery<{ history: string }>('SELECT history FROM specification WHERE id = $1', [id]))[0].history,
  ) as Array<Record<string, unknown>>
const lastOf = <T>(a: T[]): T => a[a.length - 1]
const linkSpecEnv = (specId: string, envLibId: string) =>
  rawQuery('INSERT INTO specification_environment ("specificationId","environmentLibraryId") VALUES ($1,$2)', [
    specId,
    envLibId,
  ])
const linkLibEnv = (libId: string, envLibId: string) =>
  rawQuery('INSERT INTO library_environment ("libraryId","environmentLibraryId") VALUES ($1,$2)', [libId, envLibId])
const insertTeam = (id: string) =>
  rawQuery(
    `INSERT INTO "team" ("id","name","description","createdAt","updatedAt") VALUES ($1,$1,'x',1,1) ON CONFLICT DO NOTHING`,
    [id],
  )

describe('reference fixing on same-team moves', () => {
  it('environment move keeps workflows resolving', async () => {
    await insertLib('env-lib-a', 'Env A', 'environment', f.teamMainId)
    await insertLib('env-lib-b', 'Env B', 'environment', f.teamMainId)
    await insertSpec('env-x', 'env-lib-a', 'EnvX', '1.0.0', 'Approved')
    await insertSpec('env-y', 'env-lib-a', 'EnvY', '1.0.0', 'Approved')
    await insertSpec('w-1', f.libSharedId, 'W1', '1.0.0', 'Effective') // uses only envX
    await insertSpec('w-2', f.libSharedId, 'W2', '1.0.0', 'Effective') // also uses envY, which stays in A
    const wData1 = { nodes: [], environmentSpecIds: ['env-x'] }
    const wData2 = { nodes: [], environmentSpecIds: ['env-x', 'env-y'] }
    await setData('w-1', wData1)
    await setData('w-2', wData2)
    await linkSpecEnv('w-1', 'env-lib-a')
    await linkSpecEnv('w-2', 'env-lib-a')
    await linkLibEnv(f.libSharedId, 'env-lib-a')
    mockSessionAs(f.userIdGlobal)
    expect((await move('env-x', 'env-lib-b')).status).toBe(200)

    expect(await specEnvLibs('w-1')).toEqual(['env-lib-b'])
    expect(await specEnvLibs('w-2')).toEqual(['env-lib-a', 'env-lib-b'])
    // w-2 still uses envY in lib A, so the library-level link stays too.
    expect(await libEnvLibs(f.libSharedId)).toEqual(['env-lib-a', 'env-lib-b'])
    expect(await dataOf('w-1')).toEqual(wData1)
    expect(await dataOf('w-2')).toEqual(wData2)
  })

  it('environment move keeps the library-level link, drops the spec-level one', async () => {
    await insertLib('env-lib-a', 'Env A', 'environment', f.teamMainId)
    await insertLib('env-lib-b', 'Env B', 'environment', f.teamMainId)
    await insertSpec('env-x', 'env-lib-a', 'EnvX', '1.0.0', 'Approved')
    await insertSpec('w-1', f.libSharedId, 'W1', '1.0.0', 'Effective')
    await setData('w-1', { nodes: [], environmentSpecIds: ['env-x'] })
    await linkSpecEnv('w-1', 'env-lib-a')
    await linkLibEnv(f.libSharedId, 'env-lib-a')
    mockSessionAs(f.userIdGlobal)
    expect((await move('env-x', 'env-lib-b')).status).toBe(200)
    expect(await specEnvLibs('w-1')).toEqual(['env-lib-b'])
    expect(await libEnvLibs(f.libSharedId)).toEqual(['env-lib-a', 'env-lib-b'])
  })

  it('action move rewrites released environments and ACTION PROXY nodes', async () => {
    await insertLib('act-lib-a', 'Lib A', 'action', f.teamMainId)
    await insertLib('act-lib-b', 'Lib B', 'action', f.teamMainId)
    await insertSpec('act-heat', 'act-lib-a', 'Heat', '1.0.0', 'Approved')
    await insertSpec('env-e', f.libEnvSharedId, 'EnvE', '1.0.0', 'Approved')
    await insertSpec('w-1', f.libSharedId, 'W1', '1.0.0', 'Effective')
    await setData('env-e', {
      included_actions: [
        { action_library: 'Lib A', action_name: 'Heat' },
        { action_library: 'Lib A', action_name: 'Cool' },
      ],
    })
    await setData('w-1', { nodes: [{ id: 'n', data: { actionName: 'Heat', actionLibraryName: 'Lib A' } }] })
    mockSessionAs(f.userIdGlobal)
    const res = await move('act-heat', 'act-lib-b')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { referencesUpdated: number }).referencesUpdated).toBe(2)

    expect((await dataOf('env-e')).included_actions).toEqual([
      { action_library: 'Lib B', action_name: 'Heat' },
      { action_library: 'Lib A', action_name: 'Cool' },
    ])
    expect((await dataOf('w-1')).nodes[0].data.actionLibraryName).toBe('Lib B')
    expect(lastOf(await historyOf('env-e'))).toMatchObject({
      type: 'reference_updated',
      field: 'action_library',
      from: 'Lib A',
      to: 'Lib B',
    })
    expect(lastOf(await historyOf('w-1'))).toMatchObject({
      type: 'reference_updated',
      field: 'actionLibraryName',
      from: 'Lib A',
      to: 'Lib B',
    })
  })

  it('GLOBAL action library move rewrites environments in every team', async () => {
    await insertTeam('team-two')
    await insertLib('glob-act-a', 'Global Acts', 'action', GLOBAL_TEAM_ID)
    await insertLib('glob-act-b', 'Global Acts 2', 'action', GLOBAL_TEAM_ID)
    await insertLib('two-env', 'Two Env', 'environment', 'team-two')
    await insertSpec('act-heat', 'glob-act-a', 'Heat', '1.0.0', 'Approved')
    await insertSpec('env-main', f.libEnvSharedId, 'EnvMain', '1.0.0', 'Approved')
    await insertSpec('env-two', 'two-env', 'EnvTwo', '1.0.0', 'Approved')
    const inc = { included_actions: [{ action_library: 'Global Acts', action_name: 'Heat' }] }
    await setData('env-main', inc)
    await setData('env-two', inc)
    mockSessionAs(await seedAdminUser(f))
    const res = await move('act-heat', 'glob-act-b')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { referencesUpdated: number }).referencesUpdated).toBe(2)
    for (const id of ['env-main', 'env-two']) {
      expect((await dataOf(id)).included_actions[0].action_library).toBe('Global Acts 2')
    }
  })

  it('GLOBAL action move skips teams whose own same-named action library shadows it', async () => {
    await insertTeam('team-two')
    await insertTeam('team-three')
    await insertLib('glob-act-a', 'Shared Acts', 'action', GLOBAL_TEAM_ID)
    await insertLib('glob-act-b', 'Shared Acts 2', 'action', GLOBAL_TEAM_ID)
    await insertLib('two-act', 'Shared Acts', 'action', 'team-two')
    await insertLib('two-env', 'Two Env', 'environment', 'team-two')
    await insertLib('three-env', 'Three Env', 'environment', 'team-three')
    await insertSpec('act-heat', 'glob-act-a', 'Heat', '1.0.0', 'Approved')
    await insertSpec('env-two', 'two-env', 'EnvTwo', '1.0.0', 'Approved')
    await insertSpec('env-three', 'three-env', 'EnvThree', '1.0.0', 'Approved')
    const inc = { included_actions: [{ action_library: 'Shared Acts', action_name: 'Heat' }] }
    await setData('env-two', inc)
    await setData('env-three', inc)
    mockSessionAs(await seedAdminUser(f))
    expect((await move('act-heat', 'glob-act-b')).status).toBe(200)
    expect((await dataOf('env-two')).included_actions[0].action_library).toBe('Shared Acts')
    expect((await dataOf('env-three')).included_actions[0].action_library).toBe('Shared Acts 2')
  })

  it('a team action library move leaves other teams alone', async () => {
    await insertTeam('team-two')
    await insertLib('act-lib-a', 'Lib A', 'action', f.teamMainId)
    await insertLib('act-lib-b', 'Lib B', 'action', f.teamMainId)
    await insertLib('two-env', 'Two Env', 'environment', 'team-two')
    await insertSpec('act-heat', 'act-lib-a', 'Heat', '1.0.0', 'Approved')
    await insertSpec('env-two', 'two-env', 'EnvTwo', '1.0.0', 'Approved')
    await setData('env-two', { included_actions: [{ action_library: 'Lib A', action_name: 'Heat' }] })
    mockSessionAs(f.userIdGlobal)
    const res = await move('act-heat', 'act-lib-b')
    expect(((await res.json()) as { referencesUpdated: number }).referencesUpdated).toBe(0)
    expect((await dataOf('env-two')).included_actions[0].action_library).toBe('Lib A')
  })

  it('workflow move adds library_environment links to the destination library', async () => {
    await insertLib(DEST, 'Dest Lib', 'workflow', f.teamMainId)
    await insertLib('env-lib-a', 'Env A', 'environment', f.teamMainId)
    await insertSpec('w-1', f.libSharedId, 'W1', '1.0.0', 'Draft')
    await linkSpecEnv('w-1', 'env-lib-a')
    mockSessionAs(f.userIdGlobal)
    expect((await move('w-1', DEST)).status).toBe(200)
    expect(await libEnvLibs(DEST)).toEqual(['env-lib-a'])
  })
})

describe('loadElement locking', () => {
  // PGlite has one connection, so a second-connection NOWAIT probe is not
  // possible; assert the SQL issued instead.
  async function recorded(lock: boolean): Promise<string[]> {
    const sql: string[] = []
    await withTransaction(async (q) => {
      const rec = (async (text: string, params?: unknown[]) => {
        sql.push(text)
        return q(text, params)
      }) as Querier
      const el = await loadElement(rec, f.rootSpecId, { lock })
      expect(el?.rootIds).toEqual([f.rootSpecId])
    })
    return sql
  }
  it('takes FOR UPDATE with lock: true', async () => {
    const sql = await recorded(true)
    expect(sql.filter((s) => s.includes('FOR UPDATE'))).toHaveLength(2)
  })
  it('does not lock with lock: false', async () => {
    const sql = await recorded(false)
    expect(sql.some((s) => s.includes('FOR UPDATE'))).toBe(false)
  })
})
