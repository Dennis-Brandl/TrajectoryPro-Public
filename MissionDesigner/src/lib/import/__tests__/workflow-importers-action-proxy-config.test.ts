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

// Regression coverage for the action_proxy_config round-trip.
//
// Before the fix, ACTION PROXY steps imported from a runtime workflow had their
// `action_proxy_config` (action_oid + environment_oid) silently dropped — neither
// the importer nor the exporter mentioned the field. Symptom: a workflow
// re-exported from the Editor would arrive at the Runtime missing all proxy
// targets, the runtime's `environmentsNeedingBinding()` would return [], no
// binding flow would fire, no network requests would be made, and every ACTION
// PROXY step would silently stall in EXECUTING state because
// `WorkflowCoordinator.sync()` skips on `if (!cfg) continue`.

import { describe, it, expect } from 'vitest'
import { importWorkflowSpecToInternal } from '@/lib/import/workflow-importers'
import { exportWorkflowSpec, exportWorkflow } from '@/lib/packageFormat/workflow-exporters'
import type { WorkflowNode } from '@/types/nodes'
import type { Library, Specification, ChildSpecification } from '@/types/library'

const NOW = Date.now()

function minimalImportSpec(): Record<string, unknown> {
  return {
    schemaVersion: '4.0',
    local_id: 'AP Round-trip',
    oid: 'wf-oid',
    version: '1.0.0',
    state: 'Draft',
    description: null,
    last_modified_date: '2026-05-29T00:00:00Z',
    connections: [],
    value_property_specifications: [],
    environment_specifications: [],
    children: [],
    steps: [
      {
        local_id: 'Run PreheatOven',
        oid: 'step-preheat-oid',
        version: '1.0.0',
        last_modified_date: '2026-05-29T00:00:00Z',
        step_type: 'ACTION PROXY',
        position: { x: 100, y: 200 },
        action_visibility: 'opaque',
        action_proxy_config: {
          action_oid: 'act-kitchen-preheat-001',
          environment_oid: 'env-kitchen-test-001',
          timeout_ms: 30000,
        },
      },
    ],
  }
}

function getNodes(spec: Record<string, unknown>): WorkflowNode[] {
  const result = importWorkflowSpecToInternal(spec as never, NOW)
  return (result.data as { nodes: WorkflowNode[] }).nodes
}

describe('ACTION PROXY action_proxy_config round-trip', () => {
  it('importer preserves action_proxy_config on actionProxyWait nodes', () => {
    const nodes = getNodes(minimalImportSpec())
    const proxy = nodes.find((n) => n.type === 'actionProxyWait')
    expect(proxy).toBeDefined()
    expect(proxy?.data?.actionProxyConfig).toEqual({
      action_oid: 'act-kitchen-preheat-001',
      environment_oid: 'env-kitchen-test-001',
      timeout_ms: 30000,
    })
  })

  it('importer passes action_name / environment_name through when present', () => {
    const spec = minimalImportSpec()
    const steps = spec.steps as Array<Record<string, unknown>>
    steps[0].action_proxy_config = {
      action_oid: 'act-kitchen-preheat-001',
      environment_oid: 'env-kitchen-test-001',
      timeout_ms: 30000,
      action_name: 'PreheatOven',
      environment_name: 'Kitchen',
    }
    const nodes = getNodes(spec)
    const proxy = nodes.find((n) => n.type === 'actionProxyWait')
    expect(proxy?.data?.actionProxyConfig).toEqual({
      action_oid: 'act-kitchen-preheat-001',
      environment_oid: 'env-kitchen-test-001',
      timeout_ms: 30000,
      action_name: 'PreheatOven',
      environment_name: 'Kitchen',
    })
  })

  it('importer ignores action_proxy_config on non-actionProxy steps', () => {
    const spec = minimalImportSpec()
    const steps = spec.steps as Array<Record<string, unknown>>
    steps[0].step_type = 'USER_INTERACTION'
    // Even if the field somehow appears on a USER_INTERACTION step, the importer
    // must not propagate it — only actionProxyWait nodes carry the runtime contract.
    const nodes = getNodes(spec)
    const ui = nodes.find((n) => n.type === 'userInteractionStep')
    expect(ui?.data?.actionProxyConfig).toBeUndefined()
  })

  it('importer drops malformed action_proxy_config (missing required oids)', () => {
    const spec = minimalImportSpec()
    const steps = spec.steps as Array<Record<string, unknown>>
    steps[0].action_proxy_config = { timeout_ms: 30000 } // no action_oid / environment_oid
    const nodes = getNodes(spec)
    const proxy = nodes.find((n) => n.type === 'actionProxyWait')
    expect(proxy?.data?.actionProxyConfig).toBeUndefined()
  })

  it('exporter emits action_proxy_config on actionProxyWait steps when present on node data', () => {
    // Build a minimal in-memory spec the way the editor stores it post-import:
    // root workflow with one actionProxyWait node carrying actionProxyConfig.
    const libId = 'lib-1'
    const specId = 'spec-1'
    const node: WorkflowNode = {
      id: 'node-preheat',
      type: 'actionProxyWait',
      position: { x: 100, y: 200 },
      data: {
        label: 'Run PreheatOven',
        stepType: 'actionProxyWait',
        actionVisibility: 'opaque',
        actionProxyConfig: {
          action_oid: 'act-kitchen-preheat-001',
          environment_oid: 'env-kitchen-test-001',
          timeout_ms: 30000,
        },
      },
    }
    const spec: Specification = {
      id: specId,
      libraryId: libId,
      name: 'AP Round-trip',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [node], edges: [] },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }
    const lib: Library = {
      id: libId,

      parentLibraryId: null,
      name: 'WF Lib',
      entityType: 'workflow',
      description: null,
      author: null,
      changeHistory: null,
      version: '1.0.0',
      createdAt: NOW,
      updatedAt: NOW,
    }

    const result = exportWorkflowSpec(spec, [spec], [lib])
    expect(result.steps).toBeDefined()
    const step = result.steps?.find((s) => s.local_id === 'Run PreheatOven')
    expect(step).toBeDefined()
    expect(step?.action_proxy_config).toEqual({
      action_oid: 'act-kitchen-preheat-001',
      environment_oid: 'env-kitchen-test-001',
      timeout_ms: 30000,
    })
    expect(step?.action_visibility).toBe('opaque')
  })

  it('full round-trip: importer → node data → exporter preserves the proxy target', () => {
    // The end-to-end guarantee that motivated this fix. If this test ever fails,
    // re-exported workflows will load into the runtime but every ACTION PROXY
    // step will silently no-op.
    const original = minimalImportSpec()
    const importResult = importWorkflowSpecToInternal(original as never, NOW)

    const specId = 'spec-rt'
    const libId = 'lib-rt'
    const spec: Specification = {
      id: specId,
      libraryId: libId,
      name: original.local_id as string,
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: importResult.data,
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }
    const lib: Library = {
      id: libId,

      parentLibraryId: null,
      name: 'WF Lib',
      entityType: 'workflow',
      description: null,
      author: null,
      changeHistory: null,
      version: '1.0.0',
      createdAt: NOW,
      updatedAt: NOW,
    }

    const exported = exportWorkflowSpec(spec, [spec], [lib])
    const step = exported.steps?.find((s) => s.local_id === 'Run PreheatOven')
    expect(step?.action_proxy_config).toEqual({
      action_oid: 'act-kitchen-preheat-001',
      environment_oid: 'env-kitchen-test-001',
      timeout_ms: 30000,
    })
  })

  it('exporter fallback: derives action_proxy_config from bound env when nodeData.actionProxyConfig is missing', () => {
    // The recovery path for workflows imported BEFORE the import-side
    // preservation was added (or that went through an export-import cycle
    // while the fix wasn't deployed). Without this fallback every such
    // workflow keeps re-exporting with null action_proxy_config and stalling
    // in the runtime. The fix derives the missing config from the env spec
    // the workflow is bound to.
    const NOW2 = NOW
    const wfLibId = 'wf-lib-fallback'
    const wfSpecId = 'wf-spec-fallback'
    const envLibId = 'env-lib-fallback'
    const envSpecId = 'env-spec-fallback'
    const actionLibId = 'action-lib-fallback'
    const actionSpecId = 'action-spec-bakeitem'

    // Node has NO actionProxyConfig — mirrors what a pre-fix import would
    // produce. Only the step label tells us which action it targets.
    const node: WorkflowNode = {
      id: 'node-bakeitem',
      type: 'actionProxyWait',
      position: { x: 0, y: 0 },
      data: {
        label: 'BakeItem',
        stepType: 'actionProxyWait',
        actionVisibility: 'opaque',
      },
    }

    const wfSpec: Specification = {
      id: wfSpecId,
      libraryId: wfLibId,
      name: 'Fallback WF',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {
        nodes: [node],
        edges: [],
        // Bound env — this is what the workflow imported FROM has linked.
        environmentSpecIds: [envSpecId],
      },
      history: [],
      createdAt: NOW2,
      updatedAt: NOW2,
    }
    const envSpec: Specification = {
      id: envSpecId,
      libraryId: envLibId,
      name: 'Kitchen',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {
        included_actions: [
          { action_name: 'BakeItem', action_library: 'Kitchen Action Library' },
          { action_name: 'PreheatOven', action_library: 'Kitchen Action Library' },
        ],
      },
      history: [],
      createdAt: NOW2,
      updatedAt: NOW2,
    }
    const actionSpec: Specification = {
      id: actionSpecId,
      libraryId: actionLibId,
      name: 'BakeItem',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {},
      history: [],
      createdAt: NOW2,
      updatedAt: NOW2,
    }
    const wfLib: Library = {
      id: wfLibId,

      parentLibraryId: null,
      name: 'WF Lib',
      entityType: 'workflow',
      description: null,
      author: null,
      changeHistory: null,
      version: '1.0.0',
      createdAt: NOW2,
      updatedAt: NOW2,
    }
    const envLib: Library = {
      id: envLibId,

      parentLibraryId: null,
      name: 'Kitchen Library',
      entityType: 'environment',
      description: null,
      author: null,
      changeHistory: null,
      version: '1.0.0',
      createdAt: NOW2,
      updatedAt: NOW2,
    }
    const actionLib: Library = {
      id: actionLibId,

      parentLibraryId: null,
      name: 'Kitchen Action Library',
      entityType: 'action',
      description: null,
      author: null,
      changeHistory: null,
      version: '1.0.0',
      createdAt: NOW2,
      updatedAt: NOW2,
    }

    const exported = exportWorkflowSpec(wfSpec, [wfSpec, envSpec, actionSpec], [wfLib, envLib, actionLib])

    const step = exported.steps?.find((s) => s.local_id === 'BakeItem')
    expect(step?.action_proxy_config).toEqual({
      action_oid: actionSpecId,
      environment_oid: envSpecId,
      action_name: 'BakeItem',
      environment_name: 'Kitchen',
    })
  })

  it('exporter fallback: matches "Run <ActionName>" labels and is case-insensitive', () => {
    // The canonical step-naming convention for ACTION PROXY steps is
    // "Run <ActionName>". The fallback must handle that and case
    // differences so labels imported from any reasonable source resolve.
    const NOW2 = NOW
    const wfSpec: Specification = {
      id: 'wf',
      libraryId: 'wfl',
      name: 'WF',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {
        nodes: [
          {
            id: 'n',
            type: 'actionProxyWait',
            position: { x: 0, y: 0 },
            data: { label: 'Run BAKEITEM', stepType: 'actionProxyWait' },
          } as WorkflowNode,
        ],
        edges: [],
        environmentSpecIds: ['env'],
      },
      history: [],
      createdAt: NOW2,
      updatedAt: NOW2,
    }
    const envSpec: Specification = {
      id: 'env',
      libraryId: 'envl',
      name: 'Kitchen',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {
        included_actions: [{ action_name: 'BakeItem', action_library: 'AL' }],
      },
      history: [],
      createdAt: NOW2,
      updatedAt: NOW2,
    }
    const actionSpec: Specification = {
      id: 'act',
      libraryId: 'al',
      name: 'BakeItem',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {},
      history: [],
      createdAt: NOW2,
      updatedAt: NOW2,
    }
    const mkLib = (id: string, name: string, entityType: Library['entityType']): Library => ({
      id,

      parentLibraryId: null,
      name,
      entityType,
      description: null,
      author: null,
      changeHistory: null,
      version: '1.0.0',
      createdAt: NOW2,
      updatedAt: NOW2,
    })

    const exported = exportWorkflowSpec(
      wfSpec,
      [wfSpec, envSpec, actionSpec],
      [
        mkLib('wfl', 'WF Lib', 'workflow'),
        mkLib('envl', 'Kitchen Library', 'environment'),
        mkLib('al', 'AL', 'action'),
      ],
    )

    const step = exported.steps?.[0]
    expect(step?.action_proxy_config).toEqual({
      action_oid: 'act',
      environment_oid: 'env',
      action_name: 'BakeItem',
      environment_name: 'Kitchen',
    })
  })
})

describe('export derives action_proxy_config by name (2026-08-21 self-healing export)', () => {
  const actionLib: Library = {
    id: 'action-lib-1',
    parentLibraryId: null,
    name: 'First Action Library',
    entityType: 'action',
    description: null,
    author: null,
  } as unknown as Library
  const actionSpec: Specification = {
    id: 'act-fresh-001',
    libraryId: 'action-lib-1',
    name: 'PreheatOven',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: { inputs: [], outputs: [] },
    history: [],
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as Specification
  const envSpec: Specification = {
    id: 'env-spec-001',
    libraryId: 'env-lib-1',
    name: 'Kitchen',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: { included_actions: [{ action_name: 'PreheatOven', action_library: 'First Action Library' }] },
    history: [],
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as Specification
  const envLib: Library = {
    id: 'env-lib-1',
    parentLibraryId: null,
    name: 'First Environment Library',
    entityType: 'environment',
    description: null,
    author: null,
  } as unknown as Library

  const proxyNode = (config?: Record<string, unknown>): WorkflowNode =>
    ({
      id: 'node-1',
      type: 'actionProxyWait',
      position: { x: 0, y: 0 },
      data: {
        label: 'Run PreheatOven',
        stepType: 'actionProxyWait',
        actionName: 'PreheatOven',
        actionLibraryName: 'First Action Library',
        ...(config ? { actionProxyConfig: config } : {}),
      },
    }) as unknown as WorkflowNode

  const wfSpec = (node: WorkflowNode): Specification =>
    ({
      id: 'wf-1',
      libraryId: 'wf-lib-1',
      name: 'WF',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [node], edges: [], environmentSpecIds: ['env-spec-001'] },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }) as unknown as Specification

  const allSpecs = () => [envSpec, actionSpec]
  const allLibs = () => [actionLib, envLib]

  it('REGRESSION: a stale stored action_oid is replaced by the name-derived oid + names', () => {
    const node = proxyNode({ action_oid: 'act-stale-june', environment_oid: 'env-spec-001', timeout_ms: 45000 })
    const result = exportWorkflowSpec(wfSpec(node), [wfSpec(node), ...allSpecs()], allLibs())
    const step = result.steps.find((s) => s.step_type === 'ACTION PROXY')
    expect(step?.action_proxy_config).toEqual({
      action_oid: 'act-fresh-001',
      environment_oid: 'env-spec-001',
      action_name: 'PreheatOven',
      environment_name: 'Kitchen',
      timeout_ms: 45000,
    })
  })

  it('emitted names exactly equal the emitted roster identity', () => {
    const node = proxyNode({ action_oid: 'act-stale-june', environment_oid: 'env-spec-001' })
    const result = exportWorkflowSpec(wfSpec(node), [wfSpec(node), ...allSpecs()], allLibs())
    const step = result.steps.find((s) => s.step_type === 'ACTION PROXY')
    const env = result.environment_specifications?.[0]
    expect(step?.action_proxy_config?.environment_name).toBe(env?.local_id)
    expect(step?.action_proxy_config?.environment_oid).toBe(env?.oid)
    expect(step?.action_proxy_config?.action_name).toBe(env?.included_actions?.[0]?.action_name)
    expect(step?.action_proxy_config?.action_oid).toBe(
      (env?.included_actions?.[0] as { oid?: string } | undefined)?.oid,
    )
  })

  it('falls back to the stored config verbatim when the name cannot be resolved', () => {
    const node = proxyNode({ action_oid: 'act-stale-june', environment_oid: 'env-old', timeout_ms: 10000 })
    ;(node.data as { actionName?: string; label?: string }).actionName = 'NoSuchAction'
    ;(node.data as { label?: string }).label = 'NoSuchAction'
    const result = exportWorkflowSpec(wfSpec(node), [wfSpec(node), ...allSpecs()], allLibs())
    const step = result.steps.find((s) => s.step_type === 'ACTION PROXY')
    expect(step?.action_proxy_config).toEqual({
      action_oid: 'act-stale-june',
      environment_oid: 'env-old',
      timeout_ms: 10000,
    })
  })

  it('derivation supplies no timeout_ms when the node stored no config', () => {
    const node = proxyNode(undefined)
    const result = exportWorkflowSpec(wfSpec(node), [wfSpec(node), ...allSpecs()], allLibs())
    const step = result.steps.find((s) => s.step_type === 'ACTION PROXY')
    expect(step?.action_proxy_config).toEqual({
      action_oid: 'act-fresh-001',
      environment_oid: 'env-spec-001',
      action_name: 'PreheatOven',
      environment_name: 'Kitchen',
    })
  })

  it('exportWorkflow (single-spec path) also derives by name over a stale stored oid', () => {
    const node = proxyNode({ action_oid: 'act-stale-june', environment_oid: 'env-spec-001' })
    const spec = wfSpec(node)
    const result = exportWorkflow(spec, [node], [], undefined, [spec, ...allSpecs()], allLibs())
    const step = result.steps.find((s) => s.step_type === 'ACTION PROXY')
    expect(step?.action_proxy_config).toMatchObject({
      action_oid: 'act-fresh-001',
      action_name: 'PreheatOven',
      environment_name: 'Kitchen',
    })
  })

  it('child workflow steps derive against the ROOT workflow attached envs', () => {
    const childNode = proxyNode({ action_oid: 'act-stale-june', environment_oid: 'env-spec-001' })
    const rootNode = {
      id: 'n-root',
      type: 'start',
      position: { x: 0, y: 0 },
      data: { label: 'START', stepType: 'start' },
    } as unknown as WorkflowNode
    const root = wfSpec(rootNode)
    const child = {
      id: 'child-1',
      name: 'Child WF',
      description: null,
      parentChildSpecId: null,
      parentSpecificationId: root.id,
      depth: 1,
      data: { nodes: [childNode], edges: [] },
      createdAt: NOW,
      updatedAt: NOW,
    } as unknown as ChildSpecification
    const result = exportWorkflowSpec(root, [root, ...allSpecs()], allLibs(), undefined, [child])
    const childStep = result.children?.[0]?.steps.find((s) => s.step_type === 'ACTION PROXY')
    expect(childStep?.action_proxy_config).toMatchObject({
      action_oid: 'act-fresh-001',
      action_name: 'PreheatOven',
      environment_name: 'Kitchen',
    })
  })

  it('pair-filters on the node actionLibraryName when two libraries roster the same action name', () => {
    const secondLib: Library = {
      id: 'action-lib-2',
      parentLibraryId: null,
      name: 'Second Action Library',
      entityType: 'action',
      description: null,
      author: null,
    } as unknown as Library
    const secondAction: Specification = {
      id: 'act-second-001',
      libraryId: 'action-lib-2',
      name: 'PreheatOven',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { inputs: [], outputs: [] },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    } as unknown as Specification
    const dualEnv: Specification = {
      id: 'env-dual-001',
      libraryId: 'env-lib-1',
      name: 'Dual Kitchen',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: {
        included_actions: [
          { action_name: 'PreheatOven', action_library: 'First Action Library' },
          { action_name: 'PreheatOven', action_library: 'Second Action Library' },
        ],
      },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    } as unknown as Specification
    const node = proxyNode(undefined)
    ;(node.data as { actionLibraryName?: string }).actionLibraryName = 'Second Action Library'
    const spec = {
      ...(wfSpec(node) as unknown as Record<string, unknown>),
      data: { nodes: [node], edges: [], environmentSpecIds: ['env-dual-001'] },
    } as unknown as Specification
    const result = exportWorkflowSpec(spec, [spec, dualEnv, actionSpec, secondAction], [...allLibs(), secondLib])
    const step = result.steps.find((s) => s.step_type === 'ACTION PROXY')
    expect(step?.action_proxy_config).toMatchObject({
      action_oid: 'act-second-001',
      environment_oid: 'env-dual-001',
      action_name: 'PreheatOven',
      environment_name: 'Dual Kitchen',
    })
  })

  it('tries the stored config environment_oid as an env candidate before the attached-env scan', () => {
    const secondEnv: Specification = {
      id: 'env-spec-002',
      libraryId: 'env-lib-1',
      name: 'Bakery',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { included_actions: [{ action_name: 'PreheatOven', action_library: 'First Action Library' }] },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    } as unknown as Specification
    // No environmentSpecId on the node; stored config points at the SECOND attached env.
    const node = proxyNode({ action_oid: 'act-stale-june', environment_oid: 'env-spec-002' })
    const spec = {
      ...(wfSpec(node) as unknown as Record<string, unknown>),
      data: { nodes: [node], edges: [], environmentSpecIds: ['env-spec-001', 'env-spec-002'] },
    } as unknown as Specification
    const result = exportWorkflowSpec(spec, [spec, envSpec, secondEnv, actionSpec], allLibs())
    const step = result.steps.find((s) => s.step_type === 'ACTION PROXY')
    expect(step?.action_proxy_config).toMatchObject({
      action_oid: 'act-fresh-001',
      environment_oid: 'env-spec-002',
      environment_name: 'Bakery',
    })
  })
})
