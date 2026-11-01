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
import { collectDependencies } from '../collectDependencies'
import { setupTestFixture, type TestFixture } from '../../../routes/v2/__tests__/testSeed'
import { DEST_TEAM, insertLib, insertSpec, resetWithTeams } from './moveSeed'

let f: TestFixture
beforeAll(async () => {
  f = await setupTestFixture()
})
beforeEach(async () => {
  await resetWithTeams(f)
})

const ids = (refs: { specId: string }[]) => refs.map((r) => r.specId).sort()

describe('collectDependencies', () => {
  it('collects direct environments, ACTION PROXY actions and referenced steps, not what those need; GLOBAL is left out', async () => {
    const team = f.teamMainId
    await insertLib('lib-env-a', 'Env A', 'environment', team)
    await insertLib('lib-act-a', 'Act A', 'action', team)
    await insertLib('lib-act-b', 'Act B', 'action', team)
    await insertLib('lib-steps', 'Steps', 'step', team)
    await insertLib('g-env', 'G Env', 'environment', GLOBAL_TEAM_ID)
    await insertLib('g-act-a', 'Act A', 'action', GLOBAL_TEAM_ID) // same name as the team's: the team's wins
    await insertLib('g-act', 'G Act', 'action', GLOBAL_TEAM_ID)

    await insertSpec('heat', 'lib-act-a', 'Heat')
    await insertSpec('g-heat', 'g-act-a', 'Heat')
    await insertSpec('spin', 'g-act', 'Spin')
    await insertSpec('cool-1', 'lib-act-b', 'Cool', { version: '1.0.0' })
    await insertSpec('cool-2', 'lib-act-b', 'Cool', { version: '1.2.0' })
    await insertSpec('env-x', 'lib-env-a', 'X', {
      data: {
        included_actions: [
          { action_library: 'Act A', action_name: 'Heat' },
          { action_library: 'G Act', action_name: 'Spin' },
        ],
      },
    })
    await insertSpec('env-y', 'lib-env-a', 'Y')
    await insertSpec('env-g', 'g-env', 'G')
    await insertSpec('s-1', 'lib-steps', 'S', { data: { environmentSpecIds: ['env-y'], nodes: [] } })

    // The workflow: root + an embedded child that holds the ACTION PROXY and the step reference.
    await insertSpec('wf', f.libSharedId, 'WF', { data: { environmentSpecIds: ['env-x', 'env-g'], nodes: [] } })
    await insertSpec('wf-child', f.libSharedId, 'WF Child', {
      parent: 'wf',
      data: {
        nodes: [
          { id: 'n1', type: 'step', data: { actionName: 'Heat', actionLibraryName: 'Act A' } },
          { id: 'n2', type: 'step', data: { actionName: 'Cool', actionLibraryName: 'Act B' } },
          {
            id: 'n3',
            type: 'workflowProxy',
            data: { subWorkflowMode: 'reference', referencedStepSpecId: 's-1', referencedStepLibraryId: 'lib-steps' },
          },
        ],
      },
    })

    const deps = await withTransaction((q) => collectDependencies(q, ['wf', 'wf-child']))

    // env-y is S's own dependency: copyIntoTeam follows it only when S is copied.
    expect(ids(deps.environments)).toEqual(['env-x'])
    // By-name action references resolve to the element's latest version.
    expect(ids(deps.actions)).toEqual(['cool-2', 'heat'])
    expect(ids(deps.steps)).toEqual(['s-1'])
    expect(deps.environments.find((d) => d.specId === 'env-x')).toEqual({
      specId: 'env-x',
      libraryId: 'lib-env-a',
      libraryName: 'Env A',
      teamId: team,
      entityType: 'environment',
      name: 'X',
      version: '1.0.0',
    })
  })

  it('follows node environment ids and ACTION PROXY oids, skipping dangling ids', async () => {
    const team = f.teamMainId
    await insertLib('lib-env-a', 'Env A', 'environment', team)
    await insertLib('lib-act-a', 'Act A', 'action', team)
    await insertLib('lib-steps', 'Steps', 'step', team)
    await insertSpec('act-1', 'lib-act-a', 'Mix')
    await insertSpec('env-p', 'lib-env-a', 'P')
    await insertSpec('env-q', 'lib-env-a', 'Q')
    await insertSpec('env-r', 'lib-env-a', 'R')
    await insertSpec('s-1', 'lib-steps', 'S', { version: '1.0.0' })
    // Another version of S uses env R: not a direct dependency of the workflow.
    await insertSpec('s-2', 'lib-steps', 'S', { version: '2.0.0', data: { environmentSpecIds: ['env-r'] } })
    await insertSpec('wf', f.libSharedId, 'WF', {
      data: {
        nodes: [
          { id: 'n1', data: { environmentSpecId: 'env-p' } },
          { id: 'n2', data: { actionProxyConfig: { action_oid: 'act-1', environment_oid: 'env-q' } } },
          { id: 'n3', type: 'workflowProxy', data: { referencedStepSpecId: 's-1' } },
          { id: 'n4', data: { environmentSpecId: 'missing-id' } },
        ],
      },
    })

    const deps = await withTransaction((q) => collectDependencies(q, ['wf']))
    expect(ids(deps.environments)).toEqual(['env-p', 'env-q'])
    expect(ids(deps.actions)).toEqual(['act-1'])
    expect(ids(deps.steps)).toEqual(['s-1'])
  })

  it('ignores a by-id reference into another team', async () => {
    await insertLib('lib-env-own', 'Env Own', 'environment', f.teamMainId)
    await insertLib('lib-env-other', 'Env Other', 'environment', DEST_TEAM)
    await insertSpec('env-own', 'lib-env-own', 'Own')
    await insertSpec('env-other', 'lib-env-other', 'Other')
    await insertSpec('wf', f.libSharedId, 'WF', { data: { environmentSpecIds: ['env-own', 'env-other'], nodes: [] } })

    const deps = await withTransaction((q) => collectDependencies(q, ['wf']))

    expect(ids(deps.environments)).toEqual(['env-own'])
  })
})
