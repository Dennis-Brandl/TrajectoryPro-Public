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
import { findCatchTriggers } from '../findCatchTriggers'
import type { WorkflowNode } from '@/types/nodes'

const node = (id: string, data: Record<string, unknown>) =>
  ({ id, type: 'actionProxyWait', position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode

describe('findCatchTriggers', () => {
  it('returns [] for a blank catch id', () => {
    expect(findCatchTriggers([], '')).toEqual([])
    expect(findCatchTriggers([node('a', { trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] })], '   ')).toEqual(
      [],
    )
  })

  it('returns [] when no TRY references the id', () => {
    const nodes = [node('a', { trySpecifications: [{ mode: 'ERROR', catch_id: 'OTHER' }] })]
    expect(findCatchTriggers(nodes, 'C1')).toEqual([])
  })

  it('finds a single referencing TRY', () => {
    const nodes = [node('s2', { label: 'Pump Start', trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] })]
    expect(findCatchTriggers(nodes, 'C1')).toEqual([{ stepId: 's2', stepLabel: 'Pump Start', mode: 'ERROR' }])
  })

  it('emits one row per (step, mode) when a step catches the id on multiple modes', () => {
    const nodes = [
      node('s2', {
        label: 'Pump',
        trySpecifications: [
          { mode: 'TIMEOUT', catch_id: 'C1' },
          { mode: 'ERROR', catch_id: 'C1' },
        ],
      }),
    ]
    expect(findCatchTriggers(nodes, 'C1')).toEqual([
      { stepId: 's2', stepLabel: 'Pump', mode: 'ERROR' },
      { stepId: 's2', stepLabel: 'Pump', mode: 'TIMEOUT' },
    ])
  })

  it('sorts by step label then mode order (ERROR, ABORT, TIMEOUT)', () => {
    const nodes = [
      node('b', { label: 'Valve', trySpecifications: [{ mode: 'ABORT', catch_id: 'C1' }] }),
      node('a', { label: 'Heater', trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
    ]
    expect(findCatchTriggers(nodes, 'C1').map((t) => t.stepLabel)).toEqual(['Heater', 'Valve'])
  })

  it('falls back to stepId when label is empty', () => {
    const nodes = [node('s9', { label: '', trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] })]
    expect(findCatchTriggers(nodes, 'C1')[0].stepLabel).toBe('s9')
  })

  it('ignores nodes without trySpecifications', () => {
    const nodes = [node('c', { catchId: 'C1' }), node('s', { trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] })]
    expect(findCatchTriggers(nodes, 'C1')).toHaveLength(1)
  })
})
