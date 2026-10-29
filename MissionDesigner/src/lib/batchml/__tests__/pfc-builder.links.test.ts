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
import { buildMasterRecipe, linkTypeFor } from '../pfc-builder'
import type { MasterWorkflowSpecification, MasterWorkflowStep } from '@/lib/packageFormat/export-types'

function step(oid: string, step_type: MasterWorkflowStep['step_type']): MasterWorkflowStep {
  return { oid, local_id: oid, version: '1.0.0', last_modified_date: '2026-01-01T00:00:00Z', step_type }
}

describe('pfc-builder connections', () => {
  it('derives link types from source/target gateway kinds', () => {
    expect(linkTypeFor('PARALLEL', 'ACTION PROXY').from).toBe('ParallelDivergent')
    expect(linkTypeFor('ACTION PROXY', 'WAIT ALL').to).toBe('ParallelConvergent')
    expect(linkTypeFor('SELECT 1', 'ACTION PROXY').from).toBe('SerialDivergent')
    expect(linkTypeFor('ACTION PROXY', 'WAIT ANY').to).toBe('SerialConvergent')
    expect(linkTypeFor('ACTION PROXY', 'END').from).toBe('ControlLink')
  })

  it('emits one transition and two links per connection', () => {
    const spec: MasterWorkflowSpecification = {
      oid: 'wf',
      local_id: 'wf',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00Z',
      steps: [step('a', 'START'), step('b', 'ACTION PROXY')],
      connections: [{ from_step_id: 'a', to_step_id: 'b' }],
    }
    const mr = buildMasterRecipe(spec)
    expect(mr.procedureLogic?.transition).toHaveLength(1)
    expect(mr.procedureLogic?.link).toHaveLength(2)
    expect(mr.procedureLogic?.transition[0].condition).toBe('TRUE')
    const [l1, l2] = mr.procedureLogic!.link
    expect(l1.fromId[0].value).toBe('a')
    expect(l1.toId[0].type).toBe('Transition')
    expect(l2.toId[0].value).toBe('b')
  })

  it('skips connections that touch an omitted CATCH node', () => {
    const spec: MasterWorkflowSpecification = {
      oid: 'wf',
      local_id: 'wf',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00Z',
      steps: [step('a', 'ACTION PROXY'), step('c', 'CATCH')],
      connections: [{ from_step_id: 'c', to_step_id: 'a' }],
    }
    const mr = buildMasterRecipe(spec)
    expect(mr.procedureLogic?.transition).toHaveLength(0)
    expect(mr.procedureLogic?.link).toHaveLength(0)
  })

  it('splices a GATE (spec §8.4): START→GATE→END becomes one transition carrying the script', () => {
    const gate: MasterWorkflowStep = {
      ...step('g', 'GATE'),
      gate_config: { source: 'return level > 10;' },
    }
    const spec: MasterWorkflowSpecification = {
      oid: 'wf',
      local_id: 'wf',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00Z',
      steps: [step('a', 'START'), gate, step('b', 'END')],
      connections: [
        { from_step_id: 'a', to_step_id: 'g' },
        { from_step_id: 'g', to_step_id: 'b' },
      ],
    }
    const mr = buildMasterRecipe(spec)
    // The gate is a transition, not a Step/RecipeElement.
    expect(mr.procedureLogic?.step.map((s) => s.id)).toEqual(['a', 'b'])
    expect(mr.recipeElement?.map((r) => r.id)).toEqual(['a', 'b'])
    // Exactly one transition, carrying the gate's script as its condition.
    expect(mr.procedureLogic?.transition).toHaveLength(1)
    expect(mr.procedureLogic?.transition[0].condition).toBe('return level > 10;')
    expect(mr.procedureLogic?.transition[0].conditionAnnotation).toBe('g')
    // Begin → transition → End
    expect(mr.procedureLogic?.link).toHaveLength(2)
    const [l1, l2] = mr.procedureLogic!.link
    expect(l1.fromId[0].value).toBe('a')
    expect(l1.toId[0].type).toBe('Transition')
    expect(l2.fromId[0].type).toBe('Transition')
    expect(l2.toId[0].value).toBe('b')
  })

  it('a GATE with no script source produces condition TRUE', () => {
    const gate: MasterWorkflowStep = step('g', 'GATE')
    const spec: MasterWorkflowSpecification = {
      oid: 'wf',
      local_id: 'wf',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00Z',
      steps: [step('a', 'START'), gate, step('b', 'END')],
      connections: [
        { from_step_id: 'a', to_step_id: 'g' },
        { from_step_id: 'g', to_step_id: 'b' },
      ],
    }
    const mr = buildMasterRecipe(spec)
    expect(mr.procedureLogic?.transition).toHaveLength(1)
    expect(mr.procedureLogic?.transition[0].condition).toBe('TRUE')
  })

  it('splices a CHAIN of gates (post-review fix): P→G1→G2→S becomes ONE transition ANDing both scripts', () => {
    const g1: MasterWorkflowStep = {
      ...step('g1', 'GATE'),
      local_id: 'G1',
      gate_config: { source: 'return level > 10;' },
    }
    const g2: MasterWorkflowStep = {
      ...step('g2', 'GATE'),
      local_id: 'G2',
      gate_config: { source: 'return ready;' },
    }
    const spec: MasterWorkflowSpecification = {
      oid: 'wf',
      local_id: 'wf',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00Z',
      steps: [step('a', 'START'), g1, g2, step('b', 'END')],
      connections: [
        { from_step_id: 'a', to_step_id: 'g1' },
        { from_step_id: 'g1', to_step_id: 'g2' },
        { from_step_id: 'g2', to_step_id: 'b' },
      ],
    }
    const mr = buildMasterRecipe(spec)
    // Neither gate gets a Step/RecipeElement entry.
    expect(mr.procedureLogic?.step.map((s) => s.id)).toEqual(['a', 'b'])
    expect(mr.recipeElement?.map((r) => r.id)).toEqual(['a', 'b'])
    // Exactly one transition for the whole run — no other transitions for the 3 raw connections.
    expect(mr.procedureLogic?.transition).toHaveLength(1)
    expect(mr.procedureLogic?.transition[0].condition).toBe('(return level > 10;) AND (return ready;)')
    expect(mr.procedureLogic?.transition[0].conditionAnnotation).toBe('G1 + G2')
    // Begin → transition → End
    expect(mr.procedureLogic?.link).toHaveLength(2)
    const [l1, l2] = mr.procedureLogic!.link
    expect(l1.fromId[0].value).toBe('a')
    expect(l1.toId[0].type).toBe('Transition')
    expect(l2.fromId[0].type).toBe('Transition')
    expect(l2.toId[0].value).toBe('b')
  })

  it('a gate chain with one sourceless gate wraps its term as (TRUE) in the conjunction', () => {
    const g1: MasterWorkflowStep = {
      ...step('g1', 'GATE'),
      local_id: 'G1',
      gate_config: { source: 'return level > 10;' },
    }
    const g2: MasterWorkflowStep = { ...step('g2', 'GATE'), local_id: 'G2' } // no gate_config at all
    const spec: MasterWorkflowSpecification = {
      oid: 'wf',
      local_id: 'wf',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00Z',
      steps: [step('a', 'START'), g1, g2, step('b', 'END')],
      connections: [
        { from_step_id: 'a', to_step_id: 'g1' },
        { from_step_id: 'g1', to_step_id: 'g2' },
        { from_step_id: 'g2', to_step_id: 'b' },
      ],
    }
    const mr = buildMasterRecipe(spec)
    expect(mr.procedureLogic?.transition).toHaveLength(1)
    expect(mr.procedureLogic?.transition[0].condition).toBe('(return level > 10;) AND (TRUE)')
    expect(mr.procedureLogic?.transition[0].conditionAnnotation).toBe('G1 + G2')
  })

  it('a SELECT 1 branch entering a gate keeps its branch condition ANDed ahead of the gate script (follow-up item 4)', () => {
    const sel = {
      ...step('a', 'SELECT 1'),
      select1_config: {
        input_name: 'x',
        options: [
          { id: 'opt1', label: 'Foo', operator: '==', value: 'foo', value_type: 'literal', is_default: false },
          { id: 'optd', label: 'Otherwise', operator: '==', value: '', value_type: 'literal', is_default: true },
        ],
      },
    } as MasterWorkflowStep
    const gate = { ...step('g', 'GATE'), gate_config: { source: 'return ready;' } } as MasterWorkflowStep
    const spec: MasterWorkflowSpecification = {
      oid: 'wf',
      local_id: 'wf',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00Z',
      steps: [step('s', 'START'), sel, gate, step('b', 'END'), step('c', 'END')],
      connections: [
        { from_step_id: 's', to_step_id: 'a' },
        { from_step_id: 'a', to_step_id: 'g', source_handle_id: 'opt1' },
        { from_step_id: 'g', to_step_id: 'b' },
        { from_step_id: 'a', to_step_id: 'c', source_handle_id: 'optd' },
      ],
    }
    const mr = buildMasterRecipe(spec)
    const viaGate = mr.procedureLogic!.transition.find((t) => t.id.includes(':g'))!
    expect(viaGate.condition).toBe('(x == "foo") AND (return ready;)')
    expect(viaGate.conditionAnnotation).toBe('Foo + g')
    // The sibling default branch is an ordinary transition and keeps conditionFor's ELSE.
    const viaDefault = mr.procedureLogic!.transition.find((t) => t.condition === 'ELSE')!
    expect(viaDefault.conditionAnnotation).toBe('Otherwise')
  })

  it('an unconditioned entry leaves the gate-run condition exactly as before (bare single gate, ANDed chain)', () => {
    const g1 = { ...step('g1', 'GATE'), gate_config: { source: 'return a;' } } as MasterWorkflowStep
    const g2 = { ...step('g2', 'GATE'), gate_config: { source: 'return b;' } } as MasterWorkflowStep
    const spec: MasterWorkflowSpecification = {
      oid: 'wf',
      local_id: 'wf',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00Z',
      steps: [step('s', 'START'), g1, g2, step('e', 'END')],
      connections: [
        { from_step_id: 's', to_step_id: 'g1' },
        { from_step_id: 'g1', to_step_id: 'g2' },
        { from_step_id: 'g2', to_step_id: 'e' },
      ],
    }
    const t = buildMasterRecipe(spec).procedureLogic!.transition[0]
    expect(t.condition).toBe('(return a;) AND (return b;)')
    expect(t.conditionAnnotation).toBe('g1 + g2')
  })
})

describe('pfc-builder timed gate conditions (spec 2026-10-13 §4.4)', () => {
  function conditionFor(gateConfig: NonNullable<MasterWorkflowStep['gate_config']> | undefined): string | undefined {
    const gate: MasterWorkflowStep = { ...step('g', 'GATE'), gate_config: gateConfig }
    const spec: MasterWorkflowSpecification = {
      oid: 'wf',
      local_id: 'wf',
      version: '1.0.0',
      last_modified_date: '2026-01-01T00:00:00Z',
      steps: [step('a', 'START'), gate, step('b', 'END')],
      connections: [
        { from_step_id: 'a', to_step_id: 'g' },
        { from_step_id: 'g', to_step_id: 'b' },
      ],
    }
    return buildMasterRecipe(spec).procedureLogic?.transition?.[0]?.condition
  }

  it('a timer gate becomes Timer(N s) and ignores any script', () => {
    expect(conditionFor({ mode: 'timer', delay_seconds: 7820 })).toBe('Timer(7820 s)')
    expect(conditionFor({ mode: 'timer', delay_seconds: 7820, source: 'return x;' })).toBe('Timer(7820 s)')
  })

  it('a condition_or_timer gate ORs the script with the timer', () => {
    expect(conditionFor({ mode: 'condition_or_timer', delay_seconds: 240, source: 'x > 1' })).toBe(
      '(x > 1) OR Timer(240 s)',
    )
  })

  it('a plain or condition-mode gate is unchanged', () => {
    expect(conditionFor({ source: 'return level > 10;' })).toBe('return level > 10;')
    expect(conditionFor({ mode: 'condition', source: 'return level > 10;' })).toBe('return level > 10;')
    expect(conditionFor(undefined)).toBe('TRUE')
  })
})
