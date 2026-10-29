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

import { describe, it, expect } from 'vitest'
import type { Library, Specification } from '@/types/library'
import { exportEnvironmentLibrary, exportEnvironmentSpec } from '../library-exporters'

function actionLibrary(): Library {
  return {
    id: 'action-lib-1',
    name: 'Kitchen Actions',
    entityType: 'action',
    createdAt: 0,
    updatedAt: 1700000000000,
  }
}

function envLibrary(): Library {
  return {
    id: 'env-lib-1',
    name: 'Kitchen Env',
    entityType: 'environment',
    createdAt: 0,
    updatedAt: 1700000000000,
  }
}

function actionSpec(): Specification {
  return {
    id: 'action-spec-oid',
    libraryId: 'action-lib-1',
    name: 'Heat Oven',
    description: 'Brings the oven to a target temperature.',
    version: '1.2.3',
    state: 'Approved',
    data: {
      actionVisibility: 'observable',
      inputs: [{ id: 'in-oid-1', name: 'targetTemp', value: '180', description: 'Target °C' }],
      outputs: [{ id: 'out-oid-1', name: 'reachedTemp', target: 'reachedTemp', description: 'Actual °C' }],
      values: [{ id: 'val-oid-1', name: 'TempUnit', entries: [{ name: 'value', value: 'C' }] }],
    },
    history: [],
    createdAt: 0,
    updatedAt: 1700000005000,
  }
}

function envSpec(): Specification {
  return {
    id: 'env-spec-oid',
    libraryId: 'env-lib-1',
    name: 'Prod Kitchen',
    description: null,
    version: '1.0.0',
    state: 'Approved',
    data: {
      included_actions: [{ action_name: 'Heat Oven', action_library: 'Kitchen Actions' }],
    },
    history: [],
    createdAt: 0,
    updatedAt: 1700000010000,
  }
}

describe('included_actions[] inlining', () => {
  it('inlines full action body when allLibraries + allSpecsByLibrary are provided', () => {
    const allLibraries = [actionLibrary(), envLibrary()]
    const allSpecsByLibrary = new Map<string, Specification[]>([
      ['action-lib-1', [actionSpec()]],
      ['env-lib-1', [envSpec()]],
    ])

    const exported = exportEnvironmentLibrary(envLibrary(), [envSpec()], undefined, allLibraries, allSpecsByLibrary)

    const included = exported.environment_specifications[0].included_actions[0]
    // Join keys
    expect(included.action_name).toBe('Heat Oven')
    expect(included.action_library).toBe('Kitchen Actions')
    // Inlined MasterActionSpecification — same field names as .WFaction
    expect(included.local_id).toBe('Heat Oven')
    expect(included.oid).toBe('action-spec-oid')
    expect(included.description).toBe('Brings the oven to a target temperature.')
    expect(included.version).toBe('1.2.3')
    expect(included.last_modified_date).toBe(new Date(1700000005000).toISOString())
    expect(included.action_visibility).toBe('observable')
    expect(included.input_parameter_specifications?.[0]?.id).toBe('targetTemp')
    expect(included.output_parameter_specifications?.[0]?.id).toBe('reachedTemp')
    expect(included.property_specifications?.[0]?.name).toBe('TempUnit')
  })

  it('falls back to refs-only when resolver context is not provided', () => {
    const exported = exportEnvironmentLibrary(envLibrary(), [envSpec()])
    const included = exported.environment_specifications[0].included_actions[0]

    expect(included.action_name).toBe('Heat Oven')
    expect(included.action_library).toBe('Kitchen Actions')
    expect(included.local_id).toBeUndefined()
    expect(included.oid).toBeUndefined()
    expect(included.version).toBeUndefined()
    expect(included.last_modified_date).toBeUndefined()
    expect(included.description).toBeUndefined()
    expect(included.action_visibility).toBeUndefined()
    expect(included.input_parameter_specifications).toBeUndefined()
  })

  it('exportEnvironmentSpec inlines too when given resolver context', () => {
    const allLibraries = [actionLibrary(), envLibrary()]
    const allSpecsByLibrary = new Map<string, Specification[]>([
      ['action-lib-1', [actionSpec()]],
      ['env-lib-1', [envSpec()]],
    ])

    const exported = exportEnvironmentSpec(envSpec(), 'Kitchen Env', allLibraries, allSpecsByLibrary)

    expect(exported.library_name).toBe('Kitchen Env')
    const included = exported.included_actions[0]
    expect(included.oid).toBe('action-spec-oid')
    expect(included.version).toBe('1.2.3')
    expect(included.input_parameter_specifications?.[0]?.id).toBe('targetTemp')
  })

  it('drops resolution gracefully when the action name is unknown', () => {
    const allLibraries = [actionLibrary(), envLibrary()]
    const allSpecsByLibrary = new Map<string, Specification[]>([
      ['action-lib-1', [actionSpec()]],
      ['env-lib-1', [envSpec()]],
    ])
    const orphanEnvSpec: Specification = {
      ...envSpec(),
      data: {
        included_actions: [{ action_name: 'Nonexistent', action_library: 'Kitchen Actions' }],
      },
    }

    const exported = exportEnvironmentLibrary(envLibrary(), [orphanEnvSpec], undefined, allLibraries, allSpecsByLibrary)
    const included = exported.environment_specifications[0].included_actions[0]
    expect(included.action_name).toBe('Nonexistent')
    expect(included.oid).toBeUndefined()
    expect(included.local_id).toBeUndefined()
  })

  it('matches .WFaction action_specifications shape field-for-field', () => {
    const allLibraries = [actionLibrary(), envLibrary()]
    const allSpecsByLibrary = new Map<string, Specification[]>([
      ['action-lib-1', [actionSpec()]],
      ['env-lib-1', [envSpec()]],
    ])
    const exported = exportEnvironmentLibrary(envLibrary(), [envSpec()], undefined, allLibraries, allSpecsByLibrary)
    const included = exported.environment_specifications[0].included_actions[0]

    // Every MasterActionSpecification field present on the action library export
    // must also be present on the inlined included_actions[] entry.
    const actionSpecFields = [
      'local_id',
      'oid',
      'description',
      'version',
      'last_modified_date',
      'input_parameter_specifications',
      'output_parameter_specifications',
      'property_specifications',
      'action_visibility',
    ] as const

    for (const field of actionSpecFields) {
      expect(included).toHaveProperty(field)
    }
  })
})

describe('included_actions[] inlining — GLOBAL name clash (spec 2026-10-12 U4)', () => {
  // A GLOBAL environment names "Kitchen Actions"; GLOBAL and team-a both have one. The editor
  // resolves it preferring the environment's own team (GLOBAL); the export must agree.
  const teamLib = { ...actionLibrary(), id: 'team-actions', teamId: 'team-a' }
  const globalLib = { ...actionLibrary(), id: 'global-actions', teamId: 'team-global' }
  const teamAction = { ...actionSpec(), id: 'team-heat', libraryId: 'team-actions' }
  const globalAction = { ...actionSpec(), id: 'global-heat', libraryId: 'global-actions' }
  const specsByLib = new Map<string, Specification[]>([
    ['team-actions', [teamAction]],
    ['global-actions', [globalAction]],
  ])

  it("inlines the action from the environment's own team", () => {
    const env = { ...envLibrary(), teamId: 'team-global' }
    const out = exportEnvironmentSpec(envSpec(), env.name, [teamLib, globalLib, env], specsByLib)
    expect(out.included_actions?.[0]).toMatchObject({ oid: 'global-heat' })
  })

  it('a team environment still gets its team action', () => {
    const env = { ...envLibrary(), teamId: 'team-a' }
    const out = exportEnvironmentSpec(envSpec(), env.name, [globalLib, teamLib, env], specsByLib)
    expect(out.included_actions?.[0]).toMatchObject({ oid: 'team-heat' })
  })
})
