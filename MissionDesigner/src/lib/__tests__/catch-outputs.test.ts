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
import {
  defaultCatchOutputs,
  withCanonicalCatchOutputs,
  normalizeCatchOutputsInNodes,
  CATCH_OUTPUT_NAMES,
} from '../catch-outputs'
import type { WorkflowNode } from '@/types/nodes'

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, stepType: type, ...data } } as WorkflowNode
}

describe('defaultCatchOutputs', () => {
  it('returns the four canonical CATCH outputs in order with unique ids', () => {
    const outs = defaultCatchOutputs()
    expect(outs.map((o) => o.name)).toEqual(['Message', 'Reason', 'Step', 'StepID'])
    expect(CATCH_OUTPUT_NAMES).toEqual(['Message', 'Reason', 'Step', 'StepID'])
    expect(new Set(outs.map((o) => o.id)).size).toBe(4)
    expect(outs.every((o) => typeof o.id === 'string' && o.id.length > 0)).toBe(true)
    expect(outs.every((o) => !!o.description && o.description.length > 0)).toBe(true)
  })
})

describe('withCanonicalCatchOutputs', () => {
  it('returns the four canonical outputs for undefined or empty input', () => {
    expect(withCanonicalCatchOutputs(undefined).map((o) => o.name)).toEqual(['Message', 'Reason', 'Step', 'StepID'])
    expect(withCanonicalCatchOutputs([]).map((o) => o.name)).toEqual(['Message', 'Reason', 'Step', 'StepID'])
  })

  it('preserves existing rows (including explicit targets) and appends only the missing names', () => {
    const existing = [{ id: 'x1', name: 'Message', target: 'Catch.Message', description: 'user desc' }]
    const result = withCanonicalCatchOutputs(existing)
    expect(result.map((o) => o.name)).toEqual(['Message', 'Reason', 'Step', 'StepID'])
    expect(result[0]).toBe(existing[0])
    expect(result[0].target).toBe('Catch.Message')
    expect(result.slice(1).every((o) => o.target === undefined)).toBe(true)
  })

  it('returns the same array reference when all four are already present', () => {
    const full = defaultCatchOutputs()
    expect(withCanonicalCatchOutputs(full)).toBe(full)
  })
})

describe('normalizeCatchOutputsInNodes', () => {
  it('backfills the four canonical outputs on catch nodes missing them', () => {
    const nodes = [node('s1', 'start'), node('c1', 'catch', { catchId: 'C1' })]
    const result = normalizeCatchOutputsInNodes(nodes)
    const outs = (result[1].data as { outputs: { name: string }[] }).outputs
    expect(outs.map((o) => o.name)).toEqual(['Message', 'Reason', 'Step', 'StepID'])
    expect(result[0]).toBe(nodes[0])
  })

  it('returns the same array reference when no catch node needs backfill', () => {
    const nodes = [node('s1', 'start'), node('c1', 'catch', { catchId: 'C1', outputs: defaultCatchOutputs() })]
    expect(normalizeCatchOutputsInNodes(nodes)).toBe(nodes)
  })

  it('leaves existing catch output rows untouched when appending', () => {
    const row = { id: 'x1', name: 'Message', target: 'Catch.Message' }
    const nodes = [node('c1', 'catch', { catchId: 'C1', outputs: [row] })]
    const outs = (normalizeCatchOutputsInNodes(nodes)[0].data as { outputs: unknown[] }).outputs
    expect(outs[0]).toBe(row)
    expect((outs as { name: string }[]).map((o) => o.name)).toEqual(['Message', 'Reason', 'Step', 'StepID'])
  })
})
