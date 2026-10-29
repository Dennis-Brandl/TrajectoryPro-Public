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
import { extractGateConfig } from '../step-extractors'
import { applyGateBindings } from '../action-property-bindings'
import { exportWorkflowSpec } from '../workflow-exporters'
import type { MasterWorkflowSpecification, MasterWorkflowStep, MasterEnvironmentSpecification } from '../export-types'
import type { Specification } from '@/types/library'
import type { WorkflowNode } from '@/types/nodes'

describe('extractGateConfig', () => {
  it('returns undefined for an empty node (optionality)', () => {
    expect(extractGateConfig({})).toBeUndefined()
  })

  it('drops absent fields — only cycle_seconds present', () => {
    const result = extractGateConfig({ gateCycleSeconds: 5 })
    expect(result).toEqual({ cycle_seconds: 5 })
    expect(Object.keys(result ?? {})).toEqual(['cycle_seconds'])
  })

  it('drops absent fields — only the script fields present', () => {
    const result = extractGateConfig({ scriptLanguage: 'javascript', scriptSource: 'return true;' })
    expect(result).toEqual({ language: 'javascript', source: 'return true;' })
    expect('cycle_seconds' in (result ?? {})).toBe(false)
  })

  it('emits control_previous_action: true only when the node value is exactly true', () => {
    const result = extractGateConfig({ gateCycleSeconds: 5, gateControlPreviousAction: true })
    expect(result).toEqual({ cycle_seconds: 5, control_previous_action: true })
  })

  it('a lone control_previous_action: true is enough to produce a config (no other fields needed)', () => {
    const result = extractGateConfig({ gateControlPreviousAction: true })
    expect(result).toEqual({ control_previous_action: true })
  })

  it('never emits control_previous_action: false — absence semantics preserved', () => {
    const resultFalse = extractGateConfig({ gateCycleSeconds: 5, gateControlPreviousAction: false })
    expect(resultFalse).toEqual({ cycle_seconds: 5 })
    expect('control_previous_action' in (resultFalse ?? {})).toBe(false)

    const resultUnset = extractGateConfig({ gateCycleSeconds: 5 })
    expect(resultUnset).toEqual({ cycle_seconds: 5 })
    expect('control_previous_action' in (resultUnset ?? {})).toBe(false)

    // Unset alone (no other fields) must still return undefined (optionality preserved).
    expect(extractGateConfig({ gateControlPreviousAction: false })).toBeUndefined()
  })
})

const NOW = '2026-08-29T00:00:00.000Z'

function env(oid: string, name: string, propNames: string[]): MasterEnvironmentSpecification {
  return {
    local_id: name,
    oid,
    version: '1.0.0',
    last_modified_date: NOW,
    included_actions: [],
    action_property_specifications: propNames.map((n) => ({ name: n, entries: [] })),
  }
}

function gateStep(oid: string, group: string): MasterWorkflowStep {
  return {
    local_id: oid,
    oid,
    version: '1.0.0',
    last_modified_date: NOW,
    step_type: 'GATE',
    input_parameter_specifications: [{ id: 'Trigger', default_value: `${group}.Value`, value_type: 'property' }],
  }
}

function proxyStep(oid: string, environmentOid: string): MasterWorkflowStep {
  return {
    local_id: oid,
    oid,
    version: '1.0.0',
    last_modified_date: NOW,
    step_type: 'ACTION PROXY',
    action_proxy_config: { action_oid: 'act-1', environment_oid: environmentOid },
  }
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

describe('applyGateBindings', () => {
  it('rule 1: a workflow Value Property of the same group suppresses the binding', () => {
    const gate = gateStep('gate-1', 'Sensor')
    const s = spec([gate], [env('env-1', 'Bakery', ['Sensor'])], ['Sensor'])
    const warnings = applyGateBindings(s)
    expect(warnings).toEqual([])
    expect(gate.gate_config?.action_property_bindings).toBeUndefined()
  })

  it('rule 2: the immediately preceding ACTION PROXY environment wins among multiple declaring envs', () => {
    const proxy = proxyStep('proxy-1', 'env-B')
    const gate = gateStep('gate-1', 'Sensor')
    const s = spec([proxy, gate], [env('env-A', 'Alpha', ['Sensor']), env('env-B', 'Beta', ['Sensor'])])
    const warnings = applyGateBindings(s)
    expect(warnings).toEqual([])
    expect(gate.gate_config?.action_property_bindings).toEqual([
      { parameter_id: 'Trigger', environment_oid: 'env-B', environment_name: 'Beta', property: 'Sensor.Value' },
    ])
  })

  it('rule 3: a single declaring environment binds without ambiguity', () => {
    const gate = gateStep('gate-1', 'Sensor')
    const s = spec([gate], [env('env-1', 'Bakery', ['Sensor'])])
    const warnings = applyGateBindings(s)
    expect(warnings).toEqual([])
    expect(gate.gate_config?.action_property_bindings).toEqual([
      { parameter_id: 'Trigger', environment_oid: 'env-1', environment_name: 'Bakery', property: 'Sensor.Value' },
    ])
  })

  it('rule 4: multiple declaring envs with no applicable preceding proxy — first in spec order + warning', () => {
    const gate = gateStep('gate-1', 'Sensor')
    const s = spec([gate], [env('env-A', 'Alpha', ['Sensor']), env('env-B', 'Beta', ['Sensor'])])
    const warnings = applyGateBindings(s)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('declared by 2 environments')
    expect(warnings[0]).toContain('Alpha')
    expect(gate.gate_config?.action_property_bindings).toEqual([
      { parameter_id: 'Trigger', environment_oid: 'env-A', environment_name: 'Alpha', property: 'Sensor.Value' },
    ])
  })

  it('exportWorkflowSpec pushes gate-binding warnings into opts.warnings (follow-up item 5)', () => {
    // VERIFY: the rule-4 test above builds a POST-export MasterWorkflowSpecification fixture
    // (via the env()/gateStep()/spec() helpers above) and calls applyGateBindings directly — it
    // does not go through exportWorkflowSpec, whose input is the PRE-export Specification /
    // WorkflowNode shape, so those helpers can't be reused verbatim here. This builds an
    // equivalent pre-export fixture with the same rule-4 semantics (two environments both
    // declaring the "Sensor" Action Property group, one GATE step bound to "Sensor.Value", no
    // preceding ACTION PROXY) using the same pattern as this directory's other exporter tests
    // (value-types-export.test.ts, try-catch-child-export.test.ts).
    const envA: Specification = {
      id: 'env-A',
      libraryId: 'lib-env',
      name: 'Alpha',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { included_actions: [], actionProperties: [{ id: 'p-1', name: 'Sensor', entries: [] }] },
      history: [],
      createdAt: 0,
      updatedAt: 0,
    }
    const envB: Specification = { ...envA, id: 'env-B', name: 'Beta' }
    const gateNode: WorkflowNode = {
      id: 'gate-1',
      type: 'gateStep',
      position: { x: 0, y: 0 },
      data: {
        label: 'Gate 1',
        stepType: 'gateStep',
        inputs: [{ id: 'trig-1', name: 'Trigger', value: 'Sensor.Value', valueType: 'property' }],
      },
    } as WorkflowNode
    const workflowSpec: Specification = {
      id: 'wf-1',
      libraryId: 'lib-wf',
      name: 'Flow',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [gateNode], edges: [], environmentSpecIds: ['env-A', 'env-B'] },
      history: [],
      createdAt: 0,
      updatedAt: 0,
    }

    const warnings: string[] = []
    exportWorkflowSpec(
      workflowSpec,
      [workflowSpec, envA, envB],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { warnings },
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/is declared by 2 environments — bound to/)
  })

  it('a legacy-path child export does not double-report its gate warning into a shared sink (fix round 1)', () => {
    // Legacy library export path (childTree === undefined): _findChildSpecsByParentId scans
    // allSpecs for spec.data.parentSpecificationId === parent.id and exports each match via a
    // recursive exportWorkflowSpec call. That call used to forward the SAME opts object, so the
    // child's own applyGateBindings(childResult) pushed its warning into opts.warnings — then the
    // parent's top-level applyGateBindings(result) walked into result.children (the same
    // already-processed child) and pushed the identical warning a second time. The ambiguity here
    // lives entirely in the CHILD (env-A/env-B are only referenced by the child's environmentSpecIds).
    const envA: Specification = {
      id: 'env-A',
      libraryId: 'lib-env',
      name: 'Alpha',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { included_actions: [], actionProperties: [{ id: 'p-1', name: 'Sensor', entries: [] }] },
      history: [],
      createdAt: 0,
      updatedAt: 0,
    }
    const envB: Specification = { ...envA, id: 'env-B', name: 'Beta' }
    const gateNode: WorkflowNode = {
      id: 'gate-1',
      type: 'gateStep',
      position: { x: 0, y: 0 },
      data: {
        label: 'Gate 1',
        stepType: 'gateStep',
        inputs: [{ id: 'trig-1', name: 'Trigger', value: 'Sensor.Value', valueType: 'property' }],
      },
    } as WorkflowNode
    const childSpec: Specification = {
      id: 'child-1',
      libraryId: 'lib-wf',
      name: 'Child',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {
        nodes: [gateNode],
        edges: [],
        environmentSpecIds: ['env-A', 'env-B'],
        parentSpecificationId: 'wf-1',
      },
      history: [],
      createdAt: 0,
      updatedAt: 0,
    }
    const parentSpec: Specification = {
      id: 'wf-1',
      libraryId: 'lib-wf',
      name: 'Parent',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [], edges: [] },
      history: [],
      createdAt: 0,
      updatedAt: 0,
    }

    const warnings: string[] = []
    // childTree deliberately omitted (undefined) — forces the legacy parentSpecificationId scan path.
    exportWorkflowSpec(
      parentSpec,
      [parentSpec, childSpec, envA, envB],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { warnings },
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/is declared by 2 environments — bound to/)
  })

  it('rule 4 variant: a preceding proxy env that does NOT declare the property still falls to ambiguity', () => {
    const proxy = proxyStep('proxy-1', 'env-C') // env-C declares nothing
    const gate = gateStep('gate-1', 'Sensor')
    const s = spec(
      [proxy, gate],
      [env('env-A', 'Alpha', ['Sensor']), env('env-B', 'Beta', ['Sensor']), env('env-C', 'Gamma', [])],
    )
    const warnings = applyGateBindings(s)
    expect(warnings).toHaveLength(1)
    expect(gate.gate_config?.action_property_bindings).toEqual([
      { parameter_id: 'Trigger', environment_oid: 'env-A', environment_name: 'Alpha', property: 'Sensor.Value' },
    ])
  })

  it('no input references a property — gate_config is left untouched', () => {
    const gate: MasterWorkflowStep = {
      local_id: 'gate-1',
      oid: 'gate-1',
      version: '1.0.0',
      last_modified_date: NOW,
      step_type: 'GATE',
      gate_config: { cycle_seconds: 5 },
    }
    const s = spec([gate], [env('env-1', 'Bakery', ['Sensor'])])
    const warnings = applyGateBindings(s)
    expect(warnings).toEqual([])
    expect(gate.gate_config).toEqual({ cycle_seconds: 5 })
  })

  it('a stale action_property_bindings entry is removed when no input binds anymore', () => {
    const gate: MasterWorkflowStep = {
      local_id: 'gate-1',
      oid: 'gate-1',
      version: '1.0.0',
      last_modified_date: NOW,
      step_type: 'GATE',
      gate_config: {
        cycle_seconds: 5,
        action_property_bindings: [
          { parameter_id: 'Trigger', environment_oid: 'env-1', environment_name: 'Bakery', property: 'Sensor.Value' },
        ],
      },
    }
    const s = spec([gate], [])
    applyGateBindings(s)
    expect(gate.gate_config).toEqual({ cycle_seconds: 5 })
  })

  it('non-GATE steps are untouched', () => {
    const proxy = proxyStep('proxy-1', 'env-1')
    const s = spec([proxy], [env('env-1', 'Bakery', ['Sensor'])])
    const warnings = applyGateBindings(s)
    expect(warnings).toEqual([])
    expect(proxy.gate_config).toBeUndefined()
  })
})
