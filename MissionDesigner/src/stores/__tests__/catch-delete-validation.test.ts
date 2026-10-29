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
import { validateWorkflow } from '@/lib/export/workflow-validation'
import type { WorkflowNode } from '@/types/nodes'
import type { Edge } from '@xyflow/react'

const N = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, stepType: type, ...data } }) as unknown as WorkflowNode
const E = (s: string, t: string): Edge => ({ id: `${s}-${t}`, source: s, target: t }) as Edge

describe('deleting a referenced CATCH', () => {
  it('surfaces an unmatched-TRY validation error', () => {
    // workflow after the CATCH 'C1' was deleted; the action still TRYs ON ERROR -> C1
    const nodes = [
      N('s1', 'start'),
      N('s2', 'actionProxyWait', { trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      N('s3', 'end'),
    ]
    const messages = validateWorkflow(nodes, [E('s1', 's2'), E('s2', 's3')]).map((e) => e.message)
    expect(messages.some((m) => /unknown catch_id "C1"|unmatched/i.test(m))).toBe(true)
  })
})
