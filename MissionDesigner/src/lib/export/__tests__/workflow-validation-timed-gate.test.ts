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
import type { Edge } from '@xyflow/react'
import type { WorkflowNode } from '@/types/nodes'
import { validateWorkflow } from '@/lib/export/workflow-validation'

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edges: Edge[] = [
  { id: 'e1', source: 's', target: 'g' },
  { id: 'e2', source: 'g', target: 'e' },
]
const messagesFor = (gateData: Record<string, unknown>) =>
  validateWorkflow([node('s', 'start'), node('g', 'gateStep', gateData), node('e', 'end')], edges)
    .filter((e) => e.nodeId === 'g')
    .map((e) => e.message)

describe('timed gate validation', () => {
  it('a timed gate needs a delay of at least 1 second', () => {
    expect(messagesFor({ gateMode: 'timer' })).toEqual(['Timed gate needs a delay of at least 1 second'])
    expect(messagesFor({ gateMode: 'condition_or_timer', gateDelay: { minutes: 0 } })).toEqual([
      'Timed gate needs a delay of at least 1 second',
    ])
  })
  it('a delay cannot exceed 52 weeks', () => {
    expect(messagesFor({ gateMode: 'timer', gateDelay: { weeks: 52, seconds: 1 } })).toEqual([
      'Timed gate delay cannot be longer than 52 weeks',
    ])
  })
  it('valid timed gates and plain gates pass', () => {
    expect(messagesFor({ gateMode: 'timer', gateDelay: { minutes: 4 } })).toEqual([])
    expect(messagesFor({ gateDelay: {} })).toEqual([])
  })
})
