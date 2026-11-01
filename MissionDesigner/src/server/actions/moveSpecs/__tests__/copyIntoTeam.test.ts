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
import { copyIntoTeam, remapSpecRefs } from '../copyIntoTeam'
import type { Dependencies, DepRef } from '../collectDependencies'
import { setupTestFixture, rawQuery, type TestFixture } from '../../../routes/v2/__tests__/testSeed'
import { DEST_TEAM, insertLib, insertSpec, resetWithTeams, rootsIn, specById } from './moveSeed'

let f: TestFixture
beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetWithTeams(f)
})

const ACCOUNT = 'test-global'

function dep(specId: string, libraryId: string, libraryName: string, name: string, version = '1.0.0'): DepRef {
  return { specId, libraryId, libraryName, teamId: 'team-main', entityType: 'environment', name, version }
}
const envDeps = (...environments: DepRef[]): Dependencies => ({ environments, actions: [], steps: [] })
const copy = (deps: Dependencies) => withTransaction((q) => copyIntoTeam(q, deps, DEST_TEAM, ACCOUNT))

async function seedSourceEnvA() {
  await insertLib('lib-env-a', 'Env A', 'environment', f.teamMainId)
  await insertSpec('x-1', 'lib-env-a', 'X', {
    version: '1.0.0',
    state: 'Effective',
    history: [{ type: 'created', at: '2026-01-01T00:00:00.000Z', account: 'someone', version: '1.0.0' }],
  })
  await insertSpec('x-2', 'lib-env-a', 'X', { version: '1.1.0', state: 'Draft' })
  await insertSpec('x-2-child', 'lib-env-a', 'X Part', { parent: 'x-2' })
  await insertSpec('y-1', 'lib-env-a', 'Y')
}

describe('copyIntoTeam', () => {
  it('creates a missing library with every version, state and history kept', async () => {
    await seedSourceEnvA()
    const r = await copy(envDeps(dep('x-1', 'lib-env-a', 'Env A', 'X')))

    expect(r.librariesCreated).toHaveLength(1)
    const created = r.librariesCreated[0]
    expect(created).toMatchObject({ name: 'Env A', entityType: 'environment' })
    const [lib] = await rawQuery<{ teamId: string; version: string; description: string; parentLibraryId: null }>(
      'SELECT * FROM library WHERE id = $1',
      [created.id],
    )
    expect(lib).toMatchObject({
      teamId: DEST_TEAM,
      version: '2.3.0',
      description: 'about Env A',
      parentLibraryId: null,
    })

    const roots = await rootsIn(created.id, 'X')
    expect(roots.map((s) => [s.version, s.state])).toEqual([
      ['1.0.0', 'Effective'],
      ['1.1.0', 'Draft'],
    ])
    for (const s of roots) {
      expect(['x-1', 'x-2']).not.toContain(s.id)
      expect(s.rootSpecificationId).toBe(s.id)
    }
    const h1 = JSON.parse(roots[0].history) as Array<Record<string, unknown>>
    expect(h1.map((e) => e.type)).toEqual(['created', 'copied'])
    expect(h1[1]).toMatchObject({ account: ACCOUNT, version: '1.0.0', fromSpecId: 'x-1', fromLibraryId: 'lib-env-a' })

    // The child came along under the copied 1.1.0 root.
    const child = await specById(r.idMap.get('x-2-child')!)
    expect(child).toMatchObject({
      libraryId: created.id,
      parentSpecificationId: roots[1].id,
      rootSpecificationId: roots[1].id,
    })

    expect(r.idMap.get('x-1')).toBe(roots[0].id)
    expect(r.idMap.get('x-2')).toBe(roots[1].id)
    expect(r.elementsCopied).toBe(1)
    expect(r.neededRights.sort()).toEqual(['environment:create', 'environment:library.create'])
    expect(r.neededGlobalRights).toEqual([])
    expect(r.libraryMap.get('lib-env-a')).toBe(created.id)
    // Y was not a dependency: not copied. The source is untouched.
    expect(await rootsIn(created.id, 'Y')).toEqual([])
    expect((await specById('x-1')).libraryId).toBe('lib-env-a')
  })

  it('uses an existing same-named library as is and adds only missing elements', async () => {
    await seedSourceEnvA()
    await insertLib('dest-env-a', 'Env A', 'environment', DEST_TEAM)
    await insertSpec('dx-1', 'dest-env-a', 'X', { version: '1.0.0', data: { mine: true } })

    const r = await copy(envDeps(dep('x-1', 'lib-env-a', 'Env A', 'X'), dep('y-1', 'lib-env-a', 'Env A', 'Y')))

    expect(r.librariesCreated).toEqual([])
    const xs = await rootsIn('dest-env-a', 'X')
    expect(xs.map((s) => [s.id, s.data])).toEqual([['dx-1', '{"mine":true}']])
    const ys = await rootsIn('dest-env-a', 'Y')
    expect(ys).toHaveLength(1)

    expect(r.idMap.get('x-1')).toBe('dx-1') // same version
    expect(r.idMap.get('x-2')).toBe('dx-1') // 1.1.0 absent → the destination's latest
    expect(r.idMap.get('y-1')).toBe(ys[0].id)
    expect(r.elementsCopied).toBe(1)
    expect(r.neededRights).toEqual(['environment:create'])
  })

  it("prefers the destination team's library over GLOBAL's of the same name", async () => {
    await seedSourceEnvA()
    await insertLib('dest-env-a', 'Env A', 'environment', DEST_TEAM)
    await insertLib('g-env-a', 'Env A', 'environment', GLOBAL_TEAM_ID)

    const r = await copy(envDeps(dep('y-1', 'lib-env-a', 'Env A', 'Y')))
    expect(await rootsIn('dest-env-a', 'Y')).toHaveLength(1)
    expect(await rootsIn('g-env-a', 'Y')).toEqual([])
    expect(r.libraryMap.get('lib-env-a')).toBe('dest-env-a')
    expect(r.neededRights).toEqual(['environment:create'])
  })

  it("uses GLOBAL's when the team has none", async () => {
    await seedSourceEnvA()
    await insertLib('g-env-a', 'Env A', 'environment', GLOBAL_TEAM_ID)

    const r = await copy(envDeps(dep('y-1', 'lib-env-a', 'Env A', 'Y')))
    expect(await rootsIn('g-env-a', 'Y')).toHaveLength(1)
    expect(r.librariesCreated).toEqual([])
    expect(r.neededRights).toEqual([])
    expect(r.neededGlobalRights).toEqual(['environment:create'])
  })

  it('copies images with new image ids and the same content hash', async () => {
    await seedSourceEnvA()
    const now = Date.now()
    await rawQuery(
      `INSERT INTO image_blob ("contentHash", data, "mimeType", "byteSize", "createdAt") VALUES ('h1', '\\x00', 'image/png', 1, $1)`,
      [now],
    )
    await rawQuery(
      `INSERT INTO image (id, "specificationId", filename, "mimeType", "contentHash", "createdAt")
       VALUES ('img-1', 'y-1', 'pic.png', 'image/png', 'h1', $1)`,
      [now],
    )
    await rawQuery(`INSERT INTO image_reference ("specificationId", "imageId") VALUES ('y-1', 'img-1')`)

    const r = await copy(envDeps(dep('y-1', 'lib-env-a', 'Env A', 'Y')))
    const newY = r.idMap.get('y-1')!
    const imgs = await rawQuery<{ id: string; filename: string; contentHash: string }>(
      'SELECT id, filename, "contentHash" FROM image WHERE "specificationId" = $1',
      [newY],
    )
    expect(imgs).toHaveLength(1)
    expect(imgs[0].id).not.toBe('img-1')
    expect(imgs[0]).toMatchObject({ filename: 'pic.png', contentHash: 'h1' })
    const refs = await rawQuery<{ imageId: string }>(
      'SELECT "imageId" FROM image_reference WHERE "specificationId" = $1',
      [newY],
    )
    expect(refs.map((x) => x.imageId)).toEqual([imgs[0].id])
    const [blob] = await rawQuery<{ refCount: number }>(`SELECT "refCount" FROM image_blob WHERE "contentHash" = 'h1'`)
    expect(blob.refCount).toBe(2)
  })

  it('points copies at each other, copies proxy references and environment links', async () => {
    await seedSourceEnvA()
    await insertLib('lib-steps', 'Steps', 'step', f.teamMainId)
    await insertSpec('s-1', 'lib-steps', 'S', { data: { environmentSpecIds: ['y-1'], nodes: [] } })
    await insertSpec('s-1-emb', 'lib-steps', 'S Emb', { parent: 's-1' })
    await insertSpec('s-1-emb-2', 'lib-steps', 'S Emb 2', { parent: 's-1-emb' })
    await rawQuery(
      `INSERT INTO proxy_reference ("parentSpecificationId","nodeId","targetSpecificationId") VALUES ('s-1-emb','n1','s-1-emb-2')`,
    )
    await rawQuery(
      `INSERT INTO specification_environment ("specificationId","environmentLibraryId") VALUES ('s-1','lib-env-a')`,
    )
    await rawQuery(`UPDATE specification SET data = $1 WHERE id = 's-1-emb'`, [
      JSON.stringify({ nodes: [{ id: 'n1', type: 'workflowProxy', data: { embeddedWorkflowSpecId: 's-1-emb-2' } }] }),
    ])

    const deps: Dependencies = {
      environments: [dep('y-1', 'lib-env-a', 'Env A', 'Y')],
      actions: [],
      steps: [{ ...dep('s-1', 'lib-steps', 'Steps', 'S'), entityType: 'step' }],
    }
    const r = await copy(deps)
    const newS = await specById(r.idMap.get('s-1')!)
    expect(JSON.parse(newS.data).environmentSpecIds).toEqual([r.idMap.get('y-1')])
    const emb = await specById(r.idMap.get('s-1-emb')!)
    expect(JSON.parse(emb.data).nodes[0].data.embeddedWorkflowSpecId).toBe(r.idMap.get('s-1-emb-2'))

    const proxies = await rawQuery<{ parentSpecificationId: string; targetSpecificationId: string }>(
      'SELECT * FROM proxy_reference WHERE "parentSpecificationId" = $1',
      [emb.id],
    )
    expect(proxies).toEqual([
      { parentSpecificationId: emb.id, nodeId: 'n1', targetSpecificationId: r.idMap.get('s-1-emb-2') },
    ])
    const destEnvLib = r.libraryMap.get('lib-env-a')!
    const destStepLib = r.libraryMap.get('lib-steps')!
    const specEnv = await rawQuery('SELECT * FROM specification_environment WHERE "specificationId" = $1', [newS.id])
    expect(specEnv).toEqual([{ specificationId: newS.id, environmentLibraryId: destEnvLib }])
    const libEnv = await rawQuery('SELECT * FROM library_environment WHERE "libraryId" = $1', [destStepLib])
    expect(libEnv).toEqual([{ libraryId: destStepLib, environmentLibraryId: destEnvLib }])
    expect(r.neededRights.sort()).toEqual([
      'environment:create',
      'environment:library.create',
      'workflow:create',
      'workflow:library.create',
    ])
  })

  it('follows the dependencies of what it copies, through every copied version', async () => {
    await seedSourceEnvA()
    await insertLib('lib-act-a', 'Act A', 'action', f.teamMainId)
    await insertSpec('heat', 'lib-act-a', 'Heat')
    await rawQuery(`UPDATE specification SET data = $1 WHERE id = 'x-1'`, [
      JSON.stringify({ included_actions: [{ action_library: 'Act A', action_name: 'Heat' }] }),
    ])
    await insertLib('lib-steps', 'Steps', 'step', f.teamMainId)
    await insertSpec('s-1', 'lib-steps', 'S', { version: '1.0.0', data: { environmentSpecIds: ['y-1'] } })
    await insertSpec('s-2', 'lib-steps', 'S', { version: '2.0.0', data: { environmentSpecIds: ['x-1'] } })

    const r = await copy({ environments: [], actions: [], steps: [stepDep('s-1')] })
    // S (both versions) → Y and X → X's Heat: all copied.
    for (const id of ['s-1', 's-2', 'y-1', 'x-1', 'x-2', 'heat']) expect(r.idMap.has(id)).toBe(true)
    expect(r.elementsCopied).toBe(4)
    const s2 = await specById(r.idMap.get('s-2')!)
    expect(JSON.parse(s2.data).environmentSpecIds).toEqual([r.idMap.get('x-1')])
    expect(r.neededRights).toContain('action:library.create')
  })

  it('does not follow the dependencies of an element the destination already has', async () => {
    await seedSourceEnvA()
    await insertLib('lib-steps', 'Steps', 'step', f.teamMainId)
    await insertSpec('s-1', 'lib-steps', 'S', { data: { environmentSpecIds: ['y-1'] } })
    await insertLib('dest-steps', 'Steps', 'step', DEST_TEAM)
    await insertSpec('ds-1', 'dest-steps', 'S')

    const r = await copy({ environments: [], actions: [], steps: [stepDep('s-1')] })
    expect(r.idMap.get('s-1')).toBe('ds-1')
    expect(r.idMap.has('y-1')).toBe(false)
    expect(r.librariesCreated).toEqual([])
    expect(r.elementsCopied).toBe(0)
    expect(r.neededRights).toEqual([])
    const envLibs = await rawQuery(`SELECT id FROM library WHERE "teamId" = $1 AND "entityType" = 'environment'`, [
      DEST_TEAM,
    ])
    expect(envLibs).toEqual([])
  })

  it('maps a dependency on a child row to the same name path under the destination root, else to the root', async () => {
    await insertLib('lib-steps', 'Steps', 'step', f.teamMainId)
    await insertSpec('s-1', 'lib-steps', 'S')
    await insertSpec('s-1-a', 'lib-steps', 'Part A', { parent: 's-1' })
    await insertSpec('s-1-a-b', 'lib-steps', 'Part B', { parent: 's-1-a' })
    await insertSpec('s-1-c', 'lib-steps', 'Part C', { parent: 's-1' })
    await insertLib('dest-steps', 'Steps', 'step', DEST_TEAM)
    await insertSpec('ds-1', 'dest-steps', 'S')
    await insertSpec('ds-1-a', 'dest-steps', 'Part A', { parent: 'ds-1' })
    await insertSpec('ds-1-a-b', 'dest-steps', 'Part B', { parent: 'ds-1-a' })

    const r = await copy({ environments: [], actions: [], steps: [stepDep('s-1-a-b'), stepDep('s-1-c')] })
    expect(r.idMap.get('s-1-a-b')).toBe('ds-1-a-b')
    expect(r.idMap.get('s-1-c')).toBe('ds-1') // no "Part C" in the destination
    expect(r.idMap.get('s-1')).toBe('ds-1')
  })
})

const stepDep = (specId: string): DepRef => ({ ...dep(specId, 'lib-steps', 'Steps', 'S'), entityType: 'step' })

describe('remapSpecRefs', () => {
  it('remaps spec ids and library ids at every reference site, leaving unknown ids alone', () => {
    const idMap = new Map([
      ['e1', 'E1'],
      ['a1', 'A1'],
      ['s1', 'S1'],
      ['w1', 'W1'],
    ])
    const libMap = new Map([['L1', 'LL1']])
    const data = JSON.stringify({
      environmentSpecIds: ['e1', 'keep'],
      nodes: [
        {
          id: 'n',
          data: {
            environmentSpecId: 'e1',
            actionProxyConfig: { action_oid: 'a1', environment_oid: 'e1', timeout_ms: 5 },
            referencedStepSpecId: 's1',
            referencedStepLibraryId: 'L1',
            embeddedWorkflowSpecId: 'w1',
            resourceCommands: [{ resourceSourceOid: 'e1' }, { resourceSourceOid: 'keep' }],
          },
        },
      ],
    })
    const out = JSON.parse(remapSpecRefs(data, idMap, libMap))
    expect(out.environmentSpecIds).toEqual(['E1', 'keep'])
    expect(out.nodes[0].data).toEqual({
      environmentSpecId: 'E1',
      actionProxyConfig: { action_oid: 'A1', environment_oid: 'E1', timeout_ms: 5 },
      referencedStepSpecId: 'S1',
      referencedStepLibraryId: 'LL1',
      embeddedWorkflowSpecId: 'W1',
      resourceCommands: [{ resourceSourceOid: 'E1' }, { resourceSourceOid: 'keep' }],
    })
    expect(remapSpecRefs('{"nodes":[]}', idMap, libMap)).toBe('{"nodes":[]}')
    expect(remapSpecRefs('nope', idMap, libMap)).toBe('nope')
  })
})
