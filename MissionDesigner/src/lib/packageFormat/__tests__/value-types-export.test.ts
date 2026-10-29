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
import { exportEnvironmentSpec, exportEnvironmentLibrary } from '../library-exporters'
import { exportWorkflowSpec, exportWorkflow } from '../workflow-exporters'
import type { Library, Specification } from '@/types/library'

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
      values: [{ id: 'p-1', name: 'Temp', entries: [{ id: 'pe-1', name: 'Value', value: '22' }] }],
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

function makeWorkflowSpec(): Specification {
  return {
    id: 'wf-1',
    libraryId: 'lib-wf',
    name: 'Flow',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: { nodes: [], edges: [], environmentSpecIds: ['env-1'] },
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

describe('value_type_specifications export', () => {
  it('is emitted by exportEnvironmentSpec only with includeValueTypes', () => {
    const withFlag = exportEnvironmentSpec(makeEnvSpec(), undefined, undefined, undefined, undefined, {
      includeValueTypes: true,
    })
    expect(withFlag.value_type_specifications).toEqual([
      {
        name: 'CustomerInfo',
        oid: 'vt-1',
        description: 'Standard customer record',
        entries: [{ name: 'Name' }, { name: 'Country', value: 'USA' }],
      },
    ])
    // properties themselves are untouched
    expect(withFlag.value_property_specifications?.[0]?.name).toBe('Temp')
  })

  it('DEFAULT excludes the key entirely (runtime packages stay byte-identical)', () => {
    const noFlag = exportEnvironmentSpec(makeEnvSpec())
    expect('value_type_specifications' in noFlag).toBe(false)
  })

  it('threads through exportEnvironmentLibrary', () => {
    const lib = exportEnvironmentLibrary(envLib, [makeEnvSpec()], undefined, undefined, undefined, {
      includeValueTypes: true,
    })
    expect(lib.environment_specifications[0].value_type_specifications?.[0]?.name).toBe('CustomerInfo')
  })

  it('deep scan: a workflow export without the flag contains NO trace anywhere', () => {
    const result = exportWorkflowSpec(makeWorkflowSpec(), [makeWorkflowSpec(), makeEnvSpec()], [envLib])
    expect(JSON.stringify(result)).not.toContain('value_type_specifications')
  })

  it('deep scan: exportWorkflow (canvas path) without the flag contains NO trace anywhere', () => {
    const result = exportWorkflow(makeWorkflowSpec(), [], [], undefined, [makeWorkflowSpec(), makeEnvSpec()], [envLib])
    expect(JSON.stringify(result)).not.toContain('value_type_specifications')
  })

  it('deep scan: a workflow export WITH the flag embeds it in environment_specifications', () => {
    const result = exportWorkflowSpec(
      makeWorkflowSpec(),
      [makeWorkflowSpec(), makeEnvSpec()],
      [envLib],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { includeValueTypes: true },
    )
    expect(JSON.stringify(result)).toContain('value_type_specifications')
  })
})
