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
import { exportEnvironmentLibrary } from '@/lib/packageFormat/library-exporters'
import { importEnvironmentLibrary } from '../library-importers'
import { extractPendingEnvSpecs } from '../pending-extraction'
import type { MasterWorkflowSpecification } from '@/lib/packageFormat/export-types'
import type { Library, Specification } from '@/types/library'
import type { ValueTypeSpec } from '@/types/nodes'

function makeEnvSpec(): Specification {
  return {
    id: 'env-1',
    libraryId: 'lib-env',
    name: 'Bakery',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: {
      included_actions: [],
      valueTypes: [
        {
          id: 'vt-1',
          name: 'CustomerInfo',
          description: 'Standard customer record',
          entries: [
            { id: 'e-1', name: 'Name' },
            { id: 'e-2', name: 'Country', defaultValue: 'USA' },
          ],
        },
      ],
    },
    history: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

const envLib = {
  id: 'lib-env',
  name: 'Plant Environments',
  entityType: 'environment',
  createdAt: 0,
  updatedAt: 0,
} as unknown as Library

describe('Value Types import round-trip', () => {
  it('survives export → importEnvironmentLibrary (.WFenvirLibX path)', () => {
    const exported = exportEnvironmentLibrary(envLib, [makeEnvSpec()], undefined, undefined, undefined, {
      includeValueTypes: true,
    })
    const result = importEnvironmentLibrary(exported)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const valueTypes = result.specifications[0].data.valueTypes as ValueTypeSpec[]
    expect(valueTypes).toHaveLength(1)
    expect(valueTypes[0].name).toBe('CustomerInfo')
    expect(valueTypes[0].description).toBe('Standard customer record')
    expect(valueTypes[0].entries.map((e) => ({ name: e.name, defaultValue: e.defaultValue }))).toEqual([
      { name: 'Name', defaultValue: undefined },
      { name: 'Country', defaultValue: 'USA' },
    ])
    // fresh entry ids are fine; the type keeps its oid as its id
    expect(valueTypes[0].id).toBe('vt-1')
  })

  it('absence of the field imports cleanly (runtime packages / old exports)', () => {
    const exported = exportEnvironmentLibrary(envLib, [makeEnvSpec()])
    const result = importEnvironmentLibrary(exported)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.specifications[0].data.valueTypes).toBeUndefined()
  })

  it('survives the workflow-embedded env path (extractPendingEnvSpecs)', () => {
    const wf = {
      local_id: 'Flow',
      oid: 'wf-1',
      version: '1.0.0',
      last_modified_date: '2026-08-24T00:00:00.000Z',
      steps: [],
      connections: [],
      environment_specifications: [
        {
          local_id: 'Bakery',
          oid: 'env-1',
          version: '1.0.0',
          last_modified_date: '2026-08-24T00:00:00.000Z',
          included_actions: [],
          value_type_specifications: [
            { name: 'CustomerInfo', oid: 'vt-1', entries: [{ name: 'Name' }, { name: 'Country', value: 'USA' }] },
          ],
        },
      ],
    } as unknown as MasterWorkflowSpecification
    const pending = extractPendingEnvSpecs(wf)
    expect(pending).toHaveLength(1)
    expect(pending![0].valueTypes.map((vt) => vt.name)).toEqual(['CustomerInfo'])
    expect(pending![0].valueTypes[0].entries.find((e) => e.name === 'Country')?.defaultValue).toBe('USA')
  })
})
