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
import { importWorkflowSpecToInternal } from '@/lib/import/workflow-importers'
import type { WorkflowNode } from '@/types/nodes'

const minimalSpec = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: '4.0',
  local_id: 'Root Workflow',
  oid: 'root-oid',
  version: '1.0.0',
  state: 'Draft',
  description: null,
  last_modified_date: '2026-05-02T00:00:00Z',
  steps: [],
  connections: [],
  value_property_specifications: [],
  environment_specifications: [],
  children: [],
  ...overrides,
})

function getNodes(spec: Record<string, unknown>): WorkflowNode[] {
  const result = importWorkflowSpecToInternal(spec as never, Date.now())
  return (result.data as { nodes: WorkflowNode[] }).nodes
}

describe('importWorkflowSpecToInternal — workflowProxy linkage', () => {
  it('reconstructs subWorkflowMode and embeddedWorkflowSpecId from children placement', () => {
    const spec = minimalSpec({
      steps: [
        {
          local_id: 'Sub A',
          oid: 'step-a-oid',
          version: '1.0.0',
          last_modified_date: '2026-05-02T00:00:00Z',
          step_type: 'WORKFLOW PROXY',
          position: { x: 0, y: 0 },
        },
      ],
      children: [
        {
          schemaVersion: '4.0',
          local_id: 'Sub A', // matches step.local_id
          oid: 'child-a-oid', // becomes embeddedWorkflowSpecId
          version: '1.0.0',
          state: 'Draft',
          last_modified_date: '2026-05-02T00:00:00Z',
          steps: [],
          connections: [],
        },
      ],
    })
    const nodes = getNodes(spec)
    const proxyNode = nodes.find((n) => n.type === 'workflowProxy')
    expect(proxyNode).toBeDefined()
    expect(proxyNode?.data?.subWorkflowMode).toBe('embedded')
    expect(proxyNode?.data?.embeddedWorkflowSpecId).toBe('child-a-oid')
  })

  it('leaves a workflowProxy step alone if no matching child exists (orphan proxy)', () => {
    const spec = minimalSpec({
      steps: [
        {
          local_id: 'Sub Orphan',
          oid: 'step-x-oid',
          version: '1.0.0',
          last_modified_date: '2026-05-02T00:00:00Z',
          step_type: 'WORKFLOW PROXY',
          position: { x: 0, y: 0 },
        },
      ],
      children: [],
    })
    const nodes = getNodes(spec)
    const proxyNode = nodes.find((n) => n.type === 'workflowProxy')
    expect(proxyNode?.data?.subWorkflowMode).toBeUndefined()
    expect(proxyNode?.data?.embeddedWorkflowSpecId).toBeUndefined()
  })

  it('leaves a non-proxy step alone even if a child shares the same local_id', () => {
    const spec = minimalSpec({
      steps: [
        {
          local_id: 'Same Name',
          oid: 'step-ui-oid',
          version: '1.0.0',
          last_modified_date: '2026-05-02T00:00:00Z',
          step_type: 'USER_INTERACTION',
          position: { x: 0, y: 0 },
        },
      ],
      children: [
        {
          schemaVersion: '4.0',
          local_id: 'Same Name',
          oid: 'child-y-oid',
          version: '1.0.0',
          state: 'Draft',
          last_modified_date: '2026-05-02T00:00:00Z',
          steps: [],
          connections: [],
        },
      ],
    })
    const nodes = getNodes(spec)
    const userInteractionNode = nodes.find((n) => n.type === 'userInteractionStep')
    expect(userInteractionNode?.data?.subWorkflowMode).toBeUndefined()
    expect(userInteractionNode?.data?.embeddedWorkflowSpecId).toBeUndefined()
  })

  it('handles multiple workflowProxy steps each matched to its own child', () => {
    const spec = minimalSpec({
      steps: [
        {
          local_id: 'Sub A',
          oid: 'step-a-oid',
          version: '1.0.0',
          last_modified_date: '2026-05-02T00:00:00Z',
          step_type: 'WORKFLOW PROXY',
          position: { x: 0, y: 0 },
        },
        {
          local_id: 'Sub B',
          oid: 'step-b-oid',
          version: '1.0.0',
          last_modified_date: '2026-05-02T00:00:00Z',
          step_type: 'WORKFLOW PROXY',
          position: { x: 0, y: 0 },
        },
      ],
      children: [
        {
          schemaVersion: '4.0',
          local_id: 'Sub A',
          oid: 'child-a-oid',
          version: '1.0.0',
          state: 'Draft',
          last_modified_date: '2026-05-02T00:00:00Z',
          steps: [],
          connections: [],
        },
        {
          schemaVersion: '4.0',
          local_id: 'Sub B',
          oid: 'child-b-oid',
          version: '1.0.0',
          state: 'Draft',
          last_modified_date: '2026-05-02T00:00:00Z',
          steps: [],
          connections: [],
        },
      ],
    })
    const nodes = getNodes(spec)
    const a = nodes.find((n) => n.id === 'step-a-oid')
    const b = nodes.find((n) => n.id === 'step-b-oid')
    expect(a?.data?.subWorkflowMode).toBe('embedded')
    expect(a?.data?.embeddedWorkflowSpecId).toBe('child-a-oid')
    expect(b?.data?.subWorkflowMode).toBe('embedded')
    expect(b?.data?.embeddedWorkflowSpecId).toBe('child-b-oid')
  })
})
