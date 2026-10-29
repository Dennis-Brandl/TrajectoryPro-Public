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

// Spec 2026-09-04 §5.3: binding derivation generalized from GATE to every step. GATE keeps
// gate_config.action_property_bindings; any other step gets step-level action_property_bindings.
import { describe, it, expect } from 'vitest'
import { applyActionPropertyBindings } from '../action-property-bindings'
import type { MasterWorkflowSpecification, MasterWorkflowStep, MasterEnvironmentSpecification } from '../export-types'

const NOW = '2026-09-04T00:00:00.000Z'

function env(
  oid: string,
  name: string,
  propNames: string[],
  valuePropNames: string[] = [],
): MasterEnvironmentSpecification {
  return {
    local_id: name,
    oid,
    version: '1.0.0',
    last_modified_date: NOW,
    included_actions: [],
    action_property_specifications: propNames.map((n) => ({ name: n, entries: [] })),
    value_property_specifications: valuePropNames.map((n) => ({ name: n, entries: [] })),
  }
}

function scriptStep(oid: string, group: string): MasterWorkflowStep {
  return {
    local_id: oid,
    oid,
    version: '1.0.0',
    last_modified_date: NOW,
    step_type: 'SCRIPT',
    input_parameter_specifications: [{ id: 'Trigger', default_value: `${group}.Value`, value_type: 'property' }],
  }
}

function gateStep(oid: string, group: string): MasterWorkflowStep {
  return { ...scriptStep(oid, group), step_type: 'GATE' }
}

function proxyStep(oid: string, environmentOid: string, group?: string): MasterWorkflowStep {
  return {
    local_id: oid,
    oid,
    version: '1.0.0',
    last_modified_date: NOW,
    step_type: 'ACTION PROXY',
    action_proxy_config: { action_oid: 'act-1', environment_oid: environmentOid },
    ...(group
      ? { input_parameter_specifications: [{ id: 'Trigger', default_value: `${group}.Value`, value_type: 'property' }] }
      : {}),
  }
}

function start(): MasterWorkflowStep {
  return { local_id: 'Start', oid: 'st', version: '1.0.0', last_modified_date: NOW, step_type: 'START' }
}

function spec(
  steps: MasterWorkflowStep[],
  envs: MasterEnvironmentSpecification[],
  valuePropNames: string[] = [],
): MasterWorkflowSpecification {
  return {
    local_id: 'Flow',
    oid: 'wf-1',
    version: '1.0.0',
    last_modified_date: NOW,
    steps,
    connections: steps.slice(1).map((s, i) => ({ from_step_id: steps[i].oid, to_step_id: s.oid })),
    environment_specifications: envs,
    value_property_specifications: valuePropNames.map((n) => ({ name: n, entries: [] })),
  }
}

describe('applyActionPropertyBindings — non-GATE steps', () => {
  it('a SCRIPT reading a declared Action Property gets step-level bindings (no gate_config)', () => {
    const s = spec([start(), scriptStep('s1', 'Sensor')], [env('env-A', 'Alpha', ['Sensor'])])
    const warnings = applyActionPropertyBindings(s)
    expect(warnings).toEqual([])
    expect(s.steps[1].action_property_bindings).toEqual([
      { parameter_id: 'Trigger', environment_oid: 'env-A', environment_name: 'Alpha', property: 'Sensor.Value' },
    ])
    expect(s.steps[1].gate_config).toBeUndefined()
  })

  it('a GATE still binds in gate_config and never at step level', () => {
    const s = spec([start(), gateStep('g1', 'Sensor')], [env('env-A', 'Alpha', ['Sensor'])])
    applyActionPropertyBindings(s)
    expect(s.steps[1].gate_config?.action_property_bindings).toHaveLength(1)
    expect(s.steps[1].action_property_bindings).toBeUndefined()
  })

  it('timer-mode gate emits no bindings; condition_or_timer keeps them (spec 2026-10-13 §3.4)', () => {
    const timer = { ...gateStep('g1', 'Sensor'), gate_config: { mode: 'timer' as const, delay_seconds: 5 } }
    const t = spec([start(), timer], [env('env-A', 'Alpha', ['Sensor'])])
    applyActionPropertyBindings(t)
    expect(t.steps[1].gate_config?.action_property_bindings).toBeUndefined()
    expect(t.steps[1].gate_config?.mode).toBe('timer')
    const both = { ...gateStep('g2', 'Sensor'), gate_config: { mode: 'condition_or_timer' as const, delay_seconds: 5 } }
    const c = spec([start(), both], [env('env-A', 'Alpha', ['Sensor'])])
    applyActionPropertyBindings(c)
    expect(c.steps[1].gate_config?.action_property_bindings).toHaveLength(1)
  })

  it('rule 1: a workflow Value Property of the same group suppresses the binding', () => {
    const s = spec([start(), scriptStep('s1', 'Sensor')], [env('env-A', 'Alpha', ['Sensor'])], ['Sensor'])
    applyActionPropertyBindings(s)
    expect(s.steps[1].action_property_bindings).toBeUndefined()
  })

  it('an input naming no declared Action Property gets no binding (plain store lookup)', () => {
    const s = spec([start(), scriptStep('s1', 'Elsewhere')], [env('env-A', 'Alpha', ['Sensor'])])
    applyActionPropertyBindings(s)
    expect(s.steps[1].action_property_bindings).toBeUndefined()
  })

  it("rule 2 (D6): an ACTION PROXY's own environment disambiguates before the predecessor", () => {
    const envs = [env('env-A', 'Alpha', ['Sensor']), env('env-B', 'Beta', ['Sensor'])]
    const s = spec([start(), proxyStep('p0', 'env-A'), proxyStep('p1', 'env-B', 'Sensor')], envs)
    const warnings = applyActionPropertyBindings(s)
    expect(warnings).toEqual([])
    expect(s.steps[2].action_property_bindings?.[0]).toMatchObject({
      environment_oid: 'env-B',
      environment_name: 'Beta',
    })
  })

  it("rule 2: a SCRIPT after an ACTION PROXY binds to that proxy's environment", () => {
    const envs = [env('env-A', 'Alpha', ['Sensor']), env('env-B', 'Beta', ['Sensor'])]
    const s = spec([start(), proxyStep('p1', 'env-B'), scriptStep('s1', 'Sensor')], envs)
    expect(applyActionPropertyBindings(s)).toEqual([])
    expect(s.steps[2].action_property_bindings?.[0]).toMatchObject({ environment_oid: 'env-B' })
  })

  it('rule 4: ambiguity with no disambiguator binds to the first env and warns with the Step wording', () => {
    const envs = [env('env-A', 'Alpha', ['Sensor']), env('env-B', 'Beta', ['Sensor'])]
    const s = spec([start(), scriptStep('s1', 'Sensor')], envs)
    const warnings = applyActionPropertyBindings(s)
    expect(warnings).toEqual([
      'Step "s1" input "Trigger": property "Sensor" is declared by 2 environments — bound to "Alpha" (first in spec order)',
    ])
    expect(s.steps[1].action_property_bindings?.[0]).toMatchObject({ environment_oid: 'env-A' })
  })

  it('a stale step-level array is deleted when nothing binds any more', () => {
    const s = spec([start(), scriptStep('s1', 'Sensor')], [env('env-A', 'Alpha', ['Other'])])
    s.steps[1].action_property_bindings = [{ parameter_id: 'Trigger', property: 'Sensor.Value' }]
    applyActionPropertyBindings(s)
    expect(s.steps[1].action_property_bindings).toBeUndefined()
  })

  it('literal inputs are ignored', () => {
    const s = spec([start(), scriptStep('s1', 'Sensor')], [env('env-A', 'Alpha', ['Sensor'])])
    s.steps[1].input_parameter_specifications![0].value_type = 'literal'
    applyActionPropertyBindings(s)
    expect(s.steps[1].action_property_bindings).toBeUndefined()
  })

  it('rule 1 (D5 scope): an environment Value Property of the same name suppresses the binding', () => {
    const s = spec([start(), scriptStep('s1', 'Sensor')], [env('env-A', 'Alpha', ['Sensor'], ['Sensor'])])
    applyActionPropertyBindings(s)
    expect(s.steps[1].action_property_bindings).toBeUndefined()
  })

  it("rule 1 (D5 scope): a child step is suppressed by the ROOT workflow's Value Property", () => {
    const child = spec([start(), scriptStep('c1', 'Sensor')], [])
    const s = {
      ...spec([start()], [env('env-A', 'Alpha', ['Sensor'])], ['Sensor']),
      children: [{ ...child, parentChildSpecId: null, state: 'Draft' }],
    } as MasterWorkflowSpecification
    applyActionPropertyBindings(s)
    expect(s.children![0].steps[1].action_property_bindings).toBeUndefined()
  })
})
