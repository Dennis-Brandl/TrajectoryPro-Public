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
import { resolveDisplayState, colorFor, glyphFor, humaniseState, findSpecByOid, IDLE_STATE, LEGEND } from '../state'
import type { DiagramSpec } from '../../../api/types'

function spec(over: Partial<DiagramSpec> = {}): DiagramSpec {
  return {
    oid: 'rt_0', name: 'WF', version: null, state: null, notation: 'flowchart',
    steps: [
      { oid: 's1', name: 'A', stepType: 'START', x: 0, y: 0, childSpecOid: null },
      { oid: 's2', name: 'B', stepType: 'USER_INTERACTION', x: 0, y: 100, childSpecOid: null },
    ],
    connections: [], children: [], ...over,
  }
}

describe('resolveDisplayState', () => {
  it('defaults every spec step to IDLE, overlays live entries (Runtime resolveStepStates pass)', () => {
    const m = resolveDisplayState(spec(), { s2: { state: 'WAITING_USER', nodeOid: 'rt_0', error: null, assignment: null } })
    expect(m.get('s1')).toBe(IDLE_STATE)
    expect(m.get('s2')).toBe('WAITING_USER')
    expect(m.has('unknown')).toBe(false)
  })
})

describe('colorFor', () => {
  it('maps the DB vocabulary onto the Runtime palette', () => {
    expect(colorFor('COMPLETED')).toEqual({ fill: 'var(--pilot-state-completed)', opacity: 0.9 })
    expect(colorFor('EXECUTING')).toEqual({ fill: 'var(--pilot-state-executing)', stroke: 'var(--pilot-state-executing-ring)', strokeWidth: 3 })
    for (const s of ['WAITING_USER', 'WAITING_ACTION', 'READY']) expect(colorFor(s)).toEqual({ fill: 'var(--pilot-state-waiting)' })
    expect(colorFor('PAUSED')).toEqual({ fill: 'var(--pilot-state-paused)' })
    expect(colorFor('WAITING_GATE')).toEqual({ fill: 'var(--pilot-state-gate)' }) // distinct token from PAUSED
    expect(colorFor('WAITING_PROPERTIES')).toEqual({ fill: 'var(--pilot-state-properties)' }) // reading action properties (spec 2026-09-04 §5.5)
    expect(colorFor('ERRORED')).toEqual({ fill: 'var(--pilot-state-errored)' })
    expect(colorFor('ABORTED')).toEqual({ fill: 'var(--pilot-state-errored)', opacity: 0.45 })
    expect(colorFor('CANCELLED')).toEqual({ fill: 'var(--pilot-state-cancelled)', opacity: 0.5, dashed: true })
    expect(colorFor(IDLE_STATE)).toEqual({ fill: 'var(--pilot-state-idle)', opacity: 0.7 })
    expect(colorFor('SOMETHING_NEW')).toEqual({ fill: 'var(--pilot-state-idle)', opacity: 0.7 })
  })
})

describe('humaniseState', () => {
  it('waiting variants stay distinguishable', () => {
    expect(humaniseState('WAITING_USER')).toBe('Waiting for operator')
    expect(humaniseState('WAITING_ACTION')).toBe('Waiting for action')
    expect(humaniseState('READY')).toBe('Ready')
    expect(humaniseState('WAITING_GATE')).toBe('Waiting on gate')
    expect(humaniseState('WAITING_PROPERTIES')).toBe('Reading action properties')
    expect(humaniseState('IDLE')).toBe('Not started')
    expect(humaniseState('UNKNOWN_X')).toBe('UNKNOWN_X')
  })
})

describe('findSpecByOid', () => {
  it('finds root and nested children', () => {
    const child: DiagramSpec = spec({ oid: 'c1', steps: [], children: [spec({ oid: 'c2', steps: [] })] })
    const root = spec({ children: [child] })
    expect(findSpecByOid(root, 'rt_0')).toBe(root)
    expect(findSpecByOid(root, 'c2')?.oid).toBe('c2')
    expect(findSpecByOid(root, 'nope')).toBeNull()
  })
})

describe('glyphFor (spec §5.7: never colour alone)', () => {
  it('gives each state family its own glyph', () => {
    expect(glyphFor('COMPLETED')).toBe('✓')
    expect(glyphFor('EXECUTING')).toBe('▶')
    expect(glyphFor('WAITING_USER')).toBe('◐')
    expect(glyphFor('WAITING_ACTION')).toBe('◐')
    expect(glyphFor('READY')).toBe('◐')
    expect(glyphFor('WAITING_PROPERTIES')).toBe('◐')
    expect(glyphFor('WAITING_GATE')).toBe('◇')
    expect(glyphFor('PAUSED')).toBe('‖')
    expect(glyphFor('ERRORED')).toBe('✕')
    expect(glyphFor('ABORTED')).toBe('✕')
    expect(glyphFor('CANCELLED')).toBe('–')
    expect(glyphFor('IDLE')).toBe('○')
    expect(glyphFor('SOMETHING_NEW')).toBe('○')
  })

  it('the legend covers every distinct fill colorFor draws, each with a distinct glyph', () => {
    const fills = new Set(['IDLE', 'READY', 'EXECUTING', 'PAUSED', 'WAITING_GATE', 'COMPLETED', 'ERRORED', 'CANCELLED']
      .map((s) => colorFor(s).fill))
    expect(new Set(LEGEND.map(([s]) => colorFor(s).fill))).toEqual(fills)
    expect(new Set(LEGEND.map(([s]) => glyphFor(s))).size).toBe(LEGEND.length)
  })
})

describe('WAITING_SCRIPT (spec 2026-10-13 §6.7)', () => {
  it('reads "Running script", is drawn like EXECUTING and shares its glyph', () => {
    expect(humaniseState('WAITING_SCRIPT')).toBe('Running script')
    expect(colorFor('WAITING_SCRIPT')).toEqual(colorFor('EXECUTING'))
    expect(glyphFor('WAITING_SCRIPT')).toBe(glyphFor('EXECUTING'))
  })
})
