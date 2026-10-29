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
import { exportWorkflowSpec } from '../workflow-exporters'
import type { Library, Specification } from '@/types/library'
import type { WorkflowNode } from '@/types/nodes'

const lib = (id: string, name: string, entityType: Library['entityType']): Library =>
  ({ id, name, entityType, parentLibraryId: null, createdAt: 0, updatedAt: 0 }) as unknown as Library

const spec = (id: string, libraryId: string, name: string, data: Record<string, unknown>): Specification => ({
  id,
  libraryId,
  name,
  description: null,
  version: '1.0.0',
  state: 'Draft',
  data,
  history: [],
  createdAt: 0,
  updatedAt: 0,
})

const actionLib = lib('al-1', 'Distributed Workflow Action Library', 'action')
const waitAction = spec('act-wait', 'al-1', 'Wait for Runtime Workflow', { inputs: [], outputs: [] })
const statusAction = spec('act-status', 'al-1', 'Get Runtime Workflow Status', { inputs: [], outputs: [] })
const env = spec('env-1', 'el-1', 'Distributed Workflow Management', {
  included_actions: [
    { action_name: 'Wait for Runtime Workflow', action_library: 'Distributed Workflow Action Library' },
    { action_name: 'Get Runtime Workflow Status', action_library: 'Distributed Workflow Action Library' },
  ],
})

function proxyNode(id: string, actionName: string, timeout?: number): WorkflowNode {
  return {
    id,
    type: 'actionProxyWait',
    position: { x: 0, y: 0 },
    data: {
      label: actionName,
      stepType: 'actionProxyWait',
      actionName,
      ...(timeout !== undefined
        ? { actionProxyConfig: { action_oid: 'stale', environment_oid: 'env-1', timeout_ms: timeout } }
        : {}),
    },
  } as WorkflowNode
}

function exportConfigs(nodes: WorkflowNode[]) {
  const wf = spec('wf-1', 'lib-wf', 'Flow', { nodes, edges: [], environmentSpecIds: ['env-1'] })
  const out = exportWorkflowSpec(wf, [wf, waitAction, statusAction, env], [actionLib])
  return new Map(out.steps.map((s) => [s.oid, s.action_proxy_config]))
}

describe('ACTION PROXY timeout_ms on export', () => {
  it('omits timeout_ms when none was authored', () => {
    const cfgs = exportConfigs([
      proxyNode('wait', 'Wait for Runtime Workflow'),
      proxyNode('status', 'Get Runtime Workflow Status'),
    ])
    for (const id of ['wait', 'status']) {
      const cfg = cfgs.get(id)
      expect(cfg?.action_oid).toBeDefined()
      expect(cfg && 'timeout_ms' in cfg).toBe(false)
    }
  })

  it('keeps an authored timeout_ms on Wait for Runtime Workflow', () => {
    const cfg = exportConfigs([proxyNode('wait', 'Wait for Runtime Workflow', 600000)]).get('wait')
    expect(cfg?.timeout_ms).toBe(600000)
  })

  it('keeps an authored 30000 (deliberate from now on)', () => {
    const cfg = exportConfigs([proxyNode('status', 'Get Runtime Workflow Status', 30000)]).get('status')
    expect(cfg?.action_oid).toBe('act-status')
    expect(cfg?.timeout_ms).toBe(30000)
  })
})
