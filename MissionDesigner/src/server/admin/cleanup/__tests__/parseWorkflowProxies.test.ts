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
import { parseWorkflowProxies } from '../parseWorkflowProxies'

describe('parseWorkflowProxies', () => {
  it('returns [] for empty/invalid data', () => {
    expect(parseWorkflowProxies('spec-1', '')).toEqual([])
    expect(parseWorkflowProxies('spec-1', '{}')).toEqual([])
    expect(parseWorkflowProxies('spec-1', 'not-json')).toEqual([])
  })

  it('extracts embedded proxy nodes', () => {
    const data = JSON.stringify({
      nodes: [
        {
          id: 'n1',
          type: 'workflowProxy',
          data: { subWorkflowMode: 'embedded', embeddedWorkflowSpecId: 'child-1' },
        },
      ],
    })
    expect(parseWorkflowProxies('parent-1', data)).toEqual([
      {
        nodeId: 'n1',
        ownerSpecId: 'parent-1',
        subWorkflowMode: 'embedded',
        embeddedWorkflowSpecId: 'child-1',
        referencedStepSpecId: undefined,
      },
    ])
  })

  it('extracts reference proxy nodes', () => {
    const data = JSON.stringify({
      nodes: [
        {
          id: 'n2',
          type: 'workflowProxy',
          data: { subWorkflowMode: 'reference', referencedStepSpecId: 'step-7' },
        },
      ],
    })
    expect(parseWorkflowProxies('parent-2', data)).toEqual([
      {
        nodeId: 'n2',
        ownerSpecId: 'parent-2',
        subWorkflowMode: 'reference',
        embeddedWorkflowSpecId: undefined,
        referencedStepSpecId: 'step-7',
      },
    ])
  })

  it('ignores non-workflowProxy nodes', () => {
    const data = JSON.stringify({
      nodes: [
        { id: 'n1', type: 'instructionStep', data: {} },
        { id: 'n2', type: 'workflowProxy', data: { subWorkflowMode: 'embedded', embeddedWorkflowSpecId: 'c' } },
        { id: 'n3', type: 'start', data: {} },
      ],
    })
    expect(parseWorkflowProxies('p', data)).toHaveLength(1)
  })
})
