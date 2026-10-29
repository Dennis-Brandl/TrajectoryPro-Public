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
  { id: 'e1', source: 's', target: 'sc' },
  { id: 'e2', source: 'sc', target: 'e' },
]
const messagesFor = (data: Record<string, unknown>) =>
  validateWorkflow(
    [node('s', 'start'), node('sc', 'scriptStep', { scriptSource: 'return false;', ...data }), node('e', 'end')],
    edges,
  )
    .filter((e) => e.nodeId === 'sc')
    .map((e) => e.message)

describe('repeating script validation', () => {
  it('no time limit, or one within 52 weeks, is fine', () => {
    expect(messagesFor({ scriptRepeat: true })).toEqual([])
    expect(messagesFor({ scriptRepeat: true, scriptTimeLimit: { weeks: 52 } })).toEqual([])
  })
  it('a time limit cannot exceed 52 weeks', () => {
    expect(messagesFor({ scriptRepeat: true, scriptTimeLimit: { weeks: 52, seconds: 1 } })).toEqual([
      'Script time limit cannot be longer than 52 weeks',
    ])
  })
  it('a one-shot script ignores leftover limit boxes', () => {
    expect(messagesFor({ scriptRepeat: false, scriptTimeLimit: { weeks: 99 } })).toEqual([])
  })
})
