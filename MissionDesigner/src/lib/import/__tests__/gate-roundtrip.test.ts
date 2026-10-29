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
import { exportWorkflow } from '@/lib/packageFormat/workflow-exporters'
import { importWorkflow } from '../workflow-importers'
import type { Edge } from '@xyflow/react'
import type { ConditionalEdgeData } from '@/types/edges'
import type { WorkflowNode } from '@/types/nodes'
import type { Specification } from '@/types/library'

const NOW = Date.now()

describe('GATE step export → import round-trip', () => {
  it('exports gate_config (no bindings, no script_config, no output_parameter_specifications) and re-imports cleanly', () => {
    const gateNode: WorkflowNode = {
      id: 'gate-1',
      type: 'gateStep',
      position: { x: 0, y: 0 },
      data: {
        label: 'Gate',
        stepType: 'gateStep',
        gateCycleSeconds: 3,
        scriptSource: 'return true;',
        scriptLanguage: 'javascript',
        // Bound to a group that no attached environment declares — must NOT
        // produce a binding (there is no environment at all in this spec).
        inputs: [{ id: 'in-1', name: 'Trigger', valueType: 'property', value: 'Sensor.Value' }],
      },
    } as unknown as WorkflowNode

    const spec: Specification = {
      id: 'wf-1',
      libraryId: 'lib-1',
      name: 'Gate Flow',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [gateNode], edges: [] },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }

    const exported = exportWorkflow(spec, [gateNode], [], undefined, [spec])
    const step = exported.steps.find((s) => s.local_id === 'Gate')
    expect(step).toBeDefined()
    expect(step?.step_type).toBe('GATE')
    expect(step?.gate_config).toEqual({
      cycle_seconds: 3,
      language: 'javascript',
      source: 'return true;',
    })
    // No declaring environment exists, so no binding was derived.
    expect(step?.gate_config?.action_property_bindings).toBeUndefined()

    const serialized = JSON.stringify(step)
    expect(serialized).not.toContain('script_config')
    expect(serialized).not.toContain('output_parameter_specifications')

    const result = importWorkflow(exported)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const node = result.nodes.find((n) => n.id === 'gate-1')
    expect(node?.type).toBe('gateStep')
    expect(node?.data.gateCycleSeconds).toBe(3)
    expect(node?.data.scriptSource).toBe('return true;')
    expect(node?.data.scriptLanguage).toBe('javascript')
  })

  it('derives action_property_bindings from the preceding ACTION PROXY environment', () => {
    const proxyNode: WorkflowNode = {
      id: 'proxy-1',
      type: 'actionProxyWait',
      position: { x: 0, y: 0 },
      data: {
        label: 'Run CheckSensor',
        stepType: 'actionProxyWait',
        actionVisibility: 'opaque',
        actionProxyConfig: {
          action_oid: 'act-1',
          environment_oid: 'env-1',
          environment_name: 'Bakery',
        },
      },
    } as unknown as WorkflowNode

    const gateNode: WorkflowNode = {
      id: 'gate-1',
      type: 'gateStep',
      position: { x: 0, y: 0 },
      data: {
        label: 'Gate',
        stepType: 'gateStep',
        gateCycleSeconds: 5,
        inputs: [{ id: 'in-1', name: 'Trigger', valueType: 'property', value: 'Sensor.Value' }],
      },
    } as unknown as WorkflowNode

    const edge = { id: 'e1', source: 'proxy-1', target: 'gate-1' } as Edge<ConditionalEdgeData>

    const envSpec: Specification = {
      id: 'env-1',
      libraryId: 'env-lib-1',
      name: 'Bakery',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {
        included_actions: [],
        actionProperties: [{ id: 'ap-1', name: 'Sensor', entries: [{ name: 'Value', value: '0' }] }],
      },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }

    const spec: Specification = {
      id: 'wf-2',
      libraryId: 'lib-1',
      name: 'Gate Flow With Binding',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [proxyNode, gateNode], edges: [edge], environmentSpecIds: ['env-1'] },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }

    const exported = exportWorkflow(spec, [proxyNode, gateNode], [edge], undefined, [spec, envSpec])
    const step = exported.steps.find((s) => s.local_id === 'Gate')
    expect(step?.gate_config).toEqual({
      cycle_seconds: 5,
      action_property_bindings: [
        {
          parameter_id: 'Trigger',
          environment_oid: 'env-1',
          environment_name: 'Bakery',
          property: 'Sensor.Value',
        },
      ],
    })
  })

  it('rule 1: a same-named workflow Value Property suppresses the binding', () => {
    const proxyNode: WorkflowNode = {
      id: 'proxy-1',
      type: 'actionProxyWait',
      position: { x: 0, y: 0 },
      data: {
        label: 'Run CheckSensor',
        stepType: 'actionProxyWait',
        actionVisibility: 'opaque',
        actionProxyConfig: {
          action_oid: 'act-1',
          environment_oid: 'env-1',
          environment_name: 'Bakery',
        },
      },
    } as unknown as WorkflowNode

    const gateNode: WorkflowNode = {
      id: 'gate-1',
      type: 'gateStep',
      position: { x: 0, y: 0 },
      data: {
        label: 'Gate',
        stepType: 'gateStep',
        gateCycleSeconds: 5,
        inputs: [{ id: 'in-1', name: 'Trigger', valueType: 'property', value: 'Sensor.Value' }],
      },
    } as unknown as WorkflowNode

    const edge = { id: 'e1', source: 'proxy-1', target: 'gate-1' } as Edge<ConditionalEdgeData>

    const envSpec: Specification = {
      id: 'env-1',
      libraryId: 'env-lib-1',
      name: 'Bakery',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {
        included_actions: [],
        actionProperties: [{ id: 'ap-1', name: 'Sensor', entries: [{ name: 'Value', value: '0' }] }],
      },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }

    const spec: Specification = {
      id: 'wf-3',
      libraryId: 'lib-1',
      name: 'Gate Flow With Value Property',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {
        nodes: [proxyNode, gateNode],
        edges: [edge],
        environmentSpecIds: ['env-1'],
        // A workflow-level Value Property of the SAME name as the Action
        // Property group ('Sensor') wins per rule 1 — no binding is derived.
        workflowValues: [{ id: 'wv-1', name: 'Sensor', entries: [] }],
      },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }

    const exported = exportWorkflow(spec, [proxyNode, gateNode], [edge], undefined, [spec, envSpec])
    const step = exported.steps.find((s) => s.local_id === 'Gate')
    expect(step?.gate_config).toEqual({ cycle_seconds: 5 })
    expect(step?.gate_config?.action_property_bindings).toBeUndefined()
  })

  const NOW_ISO = new Date(NOW).toISOString()

  it('a stray script_config on a GATE step is ignored — gate_config is the sole source of truth', () => {
    // Adversarial / hand-edited package: step_type GATE carries BOTH a stray script_config
    // (e.g. left over from a step-type swap) and a gate_config that omits source entirely.
    // Fix for review finding: scriptFields must be gated off for gateStep, or this would
    // hydrate scriptSource from the WRONG wire field (one-source-of-truth violation).
    const raw = {
      schemaVersion: '5.0',
      local_id: 'Adversarial Gate',
      oid: 'wf-adversarial',
      version: '1.0.0',
      state: 'Draft',
      last_modified_date: NOW_ISO,
      connections: [],
      steps: [
        {
          local_id: 'Gate',
          oid: 'gate-1',
          version: '1.0.0',
          last_modified_date: NOW_ISO,
          step_type: 'GATE',
          script_config: { language: 'python', source: 'WRONG' },
          gate_config: { cycle_seconds: 3 },
        },
      ],
    }

    const result = importWorkflow(raw)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const node = result.nodes.find((n) => n.id === 'gate-1')
    expect(node?.type).toBe('gateStep')
    expect(node?.data.gateCycleSeconds).toBe(3)
    expect(node?.data.scriptSource).toBeUndefined()
    expect(node?.data.scriptLanguage).toBeUndefined()
    // The stray script_config is called out, not silently dropped.
    expect(result.warnings?.some((w) => w.includes('script_config') && w.includes('GATE'))).toBe(true)
  })

  it('control_previous_action: true round-trips through export and re-import', () => {
    const gateNode: WorkflowNode = {
      id: 'gate-1',
      type: 'gateStep',
      position: { x: 0, y: 0 },
      data: {
        label: 'Gate',
        stepType: 'gateStep',
        gateCycleSeconds: 5,
        gateControlPreviousAction: true,
      },
    } as unknown as WorkflowNode

    const spec: Specification = {
      id: 'wf-cpa-true',
      libraryId: 'lib-1',
      name: 'Gate Flow Armed',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [gateNode], edges: [] },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }

    const exported = exportWorkflow(spec, [gateNode], [], undefined, [spec])
    const step = exported.steps.find((s) => s.local_id === 'Gate')
    expect(step?.gate_config).toEqual({ cycle_seconds: 5, control_previous_action: true })

    const result = importWorkflow(exported)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const node = result.nodes.find((n) => n.id === 'gate-1')
    expect(node?.data.gateControlPreviousAction).toBe(true)
  })

  it('control_previous_action false/unset emits no key at all and re-imports to undefined', () => {
    const gateNodeFalse: WorkflowNode = {
      id: 'gate-1',
      type: 'gateStep',
      position: { x: 0, y: 0 },
      data: {
        label: 'Gate',
        stepType: 'gateStep',
        gateCycleSeconds: 5,
        gateControlPreviousAction: false,
      },
    } as unknown as WorkflowNode

    const specFalse: Specification = {
      id: 'wf-cpa-false',
      libraryId: 'lib-1',
      name: 'Gate Flow Unarmed',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [gateNodeFalse], edges: [] },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }

    const exportedFalse = exportWorkflow(specFalse, [gateNodeFalse], [], undefined, [specFalse])
    const stepFalse = exportedFalse.steps.find((s) => s.local_id === 'Gate')
    expect(stepFalse?.gate_config).toEqual({ cycle_seconds: 5 })
    expect(JSON.stringify(stepFalse)).not.toContain('control_previous_action')

    const resultFalse = importWorkflow(exportedFalse)
    expect('error' in resultFalse).toBe(false)
    if ('error' in resultFalse) return
    expect(resultFalse.nodes.find((n) => n.id === 'gate-1')?.data.gateControlPreviousAction).toBeUndefined()

    // Unset (field absent entirely on the node) behaves identically.
    const gateNodeUnset: WorkflowNode = {
      id: 'gate-1',
      type: 'gateStep',
      position: { x: 0, y: 0 },
      data: { label: 'Gate', stepType: 'gateStep', gateCycleSeconds: 5 },
    } as unknown as WorkflowNode

    const specUnset: Specification = { ...specFalse, id: 'wf-cpa-unset', data: { nodes: [gateNodeUnset], edges: [] } }
    const exportedUnset = exportWorkflow(specUnset, [gateNodeUnset], [], undefined, [specUnset])
    const stepUnset = exportedUnset.steps.find((s) => s.local_id === 'Gate')
    expect(stepUnset?.gate_config).toEqual({ cycle_seconds: 5 })
    expect(JSON.stringify(stepUnset)).not.toContain('control_previous_action')
  })

  it('absent gate_config end-to-end: import hydrates nothing, re-export omits both gate_config and script_config', () => {
    const raw = {
      schemaVersion: '5.0',
      local_id: 'No Config Gate',
      oid: 'wf-noconfig',
      version: '1.0.0',
      state: 'Draft',
      last_modified_date: NOW_ISO,
      connections: [],
      steps: [
        {
          local_id: 'Gate',
          oid: 'gate-1',
          version: '1.0.0',
          last_modified_date: NOW_ISO,
          step_type: 'GATE',
          // No gate_config key at all — defaultStepData's gateCycleSeconds:5 seed is a
          // palette-create-time default only; it must NOT apply on import.
        },
      ],
    }

    const result = importWorkflow(raw)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const node = result.nodes.find((n) => n.id === 'gate-1')
    expect(node?.type).toBe('gateStep')
    expect(node?.data.gateCycleSeconds).toBeUndefined()
    expect(node?.data.scriptSource).toBeUndefined()
    expect(node?.data.scriptLanguage).toBeUndefined()

    const spec: Specification = {
      id: 'spec-noconfig',
      libraryId: 'lib-1',
      name: 'No Config Gate',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: result.nodes, edges: result.edges },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }

    const exported = exportWorkflow(spec, result.nodes, result.edges, undefined, [spec])
    const step = exported.steps.find((s) => s.local_id === 'Gate')
    expect(step?.gate_config).toBeUndefined()
    const serialized = JSON.stringify(step)
    expect(serialized).not.toContain('gate_config')
    expect(serialized).not.toContain('script_config')
  })

  it('timed gate: plain gate exports no mode/delay keys; timed gate exports joined seconds and import splits them back', () => {
    const mk = (data: Record<string, unknown>): WorkflowNode =>
      ({
        id: 'gate-1',
        type: 'gateStep',
        position: { x: 0, y: 0 },
        data: { label: 'Gate', stepType: 'gateStep', ...data },
      }) as unknown as WorkflowNode
    const run = (gateNode: WorkflowNode) => {
      const spec: Specification = {
        id: 'wf-t',
        libraryId: 'lib-1',
        name: 'Timed Gate Flow',
        description: null,
        version: '1.0.0',
        state: 'Draft',
        data: { nodes: [gateNode], edges: [] },
        history: [],
        createdAt: NOW,
        updatedAt: NOW,
      }
      return exportWorkflow(spec, [gateNode], [], undefined, [spec])
    }

    // Plain condition gate (even with a stale stored delay) keeps today's exact bytes.
    const plain = run(mk({ gateCycleSeconds: 3, gateMode: 'condition', gateDelay: { minutes: 4 } }))
    const plainStep = plain.steps.find((s) => s.local_id === 'Gate')
    expect(JSON.stringify(plainStep?.gate_config)).toBe('{"cycle_seconds":3}')

    // Timed gate exports mode + joined seconds, and import splits them back into parts.
    const timed = run(mk({ gateMode: 'timer', gateDelay: { hours: 2, minutes: 10, seconds: 20 } }))
    const timedStep = timed.steps.find((s) => s.local_id === 'Gate')
    expect(timedStep?.gate_config).toEqual({ mode: 'timer', delay_seconds: 7820 })

    const result = importWorkflow(timed)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const node = result.nodes.find((n) => n.id === 'gate-1')
    expect(node?.data.gateMode).toBe('timer')
    expect(node?.data.gateDelay).toEqual({ weeks: 0, days: 0, hours: 2, minutes: 10, seconds: 20 })

    // A plain gate imports with no timed fields.
    const plainResult = importWorkflow(plain)
    if ('error' in plainResult) throw new Error('import failed')
    const plainNode = plainResult.nodes.find((n) => n.id === 'gate-1')
    expect(plainNode?.data.gateMode).toBeUndefined()
    expect(plainNode?.data.gateDelay).toBeUndefined()
  })
})
