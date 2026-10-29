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
import type { Node } from '@xyflow/react'
import { planWorkflowButtonConversion } from '../convert-workflow-buttons'

const emptyForm = { version: 2, sections: [{ id: 's', role: 'content', rows: [] }] }
let n = 0
const newId = () => 'id' + ++n

const node = (id: string, type: string, data: Record<string, unknown>): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data,
})

describe('planWorkflowButtonConversion', () => {
  it('plans only form steps whose form changes, with the step name', () => {
    const plan = planWorkflowButtonConversion(
      [
        node('a', 'userInteractionStep', { label: 'Check', formDocument: emptyForm }),
        node('b', 'yesNoStep', { formDocument: emptyForm }),
      ],
      newId,
    )
    expect(plan.map((p) => [p.nodeId, p.nodeName])).toEqual([
      ['a', 'Check'],
      ['b', 'b'],
    ])
    expect(plan[0].result.changed).toBe(true)
  })

  it('skips doc-less nodes, other node types and already-converted forms', () => {
    const converted = planWorkflowButtonConversion(
      [node('a', 'userInteractionStep', { formDocument: emptyForm })],
      newId,
    )[0].result.document
    const plan = planWorkflowButtonConversion(
      [
        node('a', 'userInteractionStep', { label: 'x' }),
        node('b', 'scriptStep', { formDocument: emptyForm }),
        node('c', 'userInteractionStep', { formDocument: converted }),
      ],
      newId,
    )
    expect(plan).toEqual([])
  })
})
