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
import { buildMasterRecipe } from '../pfc-builder'
import type { MasterWorkflowSpecification } from '@/lib/packageFormat/export-types'

describe('pfc-builder formula + header', () => {
  it('maps starting/output/value params to typed Formula parameters', () => {
    const spec: MasterWorkflowSpecification = {
      oid: 'wf',
      local_id: 'Mix Batch',
      version: '2.0.0',
      last_modified_date: '2026-01-01T00:00:00Z',
      state: 'Approved',
      steps: [],
      connections: [],
      starting_parameter_specifications: [{ id: 'Temperature', default_value: '350' }],
      output_parameter_specifications: [{ id: 'Yield' }],
      value_property_specifications: [{ name: 'Notes', entries: [{ name: 'Value', value: 'x' }] }],
    }
    const mr = buildMasterRecipe(spec)
    const params = mr.formula?.parameter ?? []
    expect(params.find((p) => p.id === 'Temperature')?.parameterType).toBe('ProcessInput')
    expect(params.find((p) => p.id === 'Yield')?.parameterType).toBe('ProcessOutput')
    expect(params.find((p) => p.id === 'Notes')?.parameterType).toBe('ProcessParameter')
    expect(params.find((p) => p.id === 'Temperature')?.value?.[0].valueString).toBe('350')
    expect(mr.header?.productName).toBe('Mix Batch')
  })
})
