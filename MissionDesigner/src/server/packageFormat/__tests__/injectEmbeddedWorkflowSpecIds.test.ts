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
import { injectEmbeddedWorkflowSpecIds } from '../injectEmbeddedWorkflowSpecIds'
import type { BatchSaveRequest } from '../../batchSave/requestSchema'

// Minimal SpecCreate entry — only fields needed for the helper.
function makeBatchSpec(
  id: string,
  data: object,
  overrides: Partial<{
    parentSpecificationId: string | null
    rootSpecificationId: string
    libraryId: string | null
    name: string
    description: string | null
    version: string
    state: 'Draft'
    dataSchemaVersion: number
  }> = {},
): BatchSaveRequest['specs'][number] {
  return {
    op: 'create',
    id,
    parentSpecificationId: overrides.parentSpecificationId ?? null,
    rootSpecificationId: overrides.rootSpecificationId ?? id,
    libraryId: overrides.libraryId ?? null,
    name: overrides.name ?? id,
    description: overrides.description ?? null,
    data: JSON.stringify(data),
    dataSchemaVersion: overrides.dataSchemaVersion ?? 3,
    version: overrides.version ?? '1.0.0',
    state: overrides.state ?? 'Draft',
  }
}

function makeProxyRef(
  parentSpecificationId: string,
  nodeId: string,
  targetSpecificationId: string,
): BatchSaveRequest['proxyRefs'][number] {
  return { op: 'create', parentSpecificationId, nodeId, targetSpecificationId }
}

function emptyBatch(specs: BatchSaveRequest['specs'], proxyRefs: BatchSaveRequest['proxyRefs']): BatchSaveRequest {
  return { specs, proxyRefs, specEnvs: [], imageDeletes: [], imageRefs: [] }
}

function makeProxyNode(id: string, extra: object = {}) {
  return { id, type: 'workflowProxy', data: { subWorkflowMode: 'embedded', ...extra } }
}

describe('injectEmbeddedWorkflowSpecIds', () => {
  it('happy path: writes new spec id into the matching node data', () => {
    const node = makeProxyNode('node-1')
    const spec = makeBatchSpec('new-parent-id', { nodes: [node] })
    const batch = emptyBatch([spec], [makeProxyRef('new-parent-id', 'node-1', 'new-child-id')])

    injectEmbeddedWorkflowSpecIds(batch)

    const data = JSON.parse((spec as { data: string }).data) as { nodes: Array<{ data: Record<string, unknown> }> }
    expect(data.nodes[0].data.embeddedWorkflowSpecId).toBe('new-child-id')
    expect(data.nodes[0].data.subWorkflowMode).toBe('embedded')
  })

  it('multiple proxies in the same parent: both get correctly remapped', () => {
    const node1 = makeProxyNode('node-1')
    const node2 = makeProxyNode('node-2')
    const spec = makeBatchSpec('new-parent', { nodes: [node1, node2] })
    const batch = emptyBatch(
      [spec],
      [makeProxyRef('new-parent', 'node-1', 'new-child-a'), makeProxyRef('new-parent', 'node-2', 'new-child-b')],
    )

    injectEmbeddedWorkflowSpecIds(batch)

    const data = JSON.parse((spec as { data: string }).data) as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>
    }
    const n1 = data.nodes.find((n) => n.id === 'node-1')!
    const n2 = data.nodes.find((n) => n.id === 'node-2')!
    expect(n1.data.embeddedWorkflowSpecId).toBe('new-child-a')
    expect(n2.data.embeddedWorkflowSpecId).toBe('new-child-b')
  })

  it('sets subWorkflowMode to embedded even when it was missing from source data', () => {
    const node = { id: 'node-1', type: 'workflowProxy', data: {} }
    const spec = makeBatchSpec('new-parent', { nodes: [node] })
    const batch = emptyBatch([spec], [makeProxyRef('new-parent', 'node-1', 'new-child')])

    injectEmbeddedWorkflowSpecIds(batch)

    const data = JSON.parse((spec as { data: string }).data) as { nodes: Array<{ data: Record<string, unknown> }> }
    expect(data.nodes[0].data.subWorkflowMode).toBe('embedded')
    expect(data.nodes[0].data.embeddedWorkflowSpecId).toBe('new-child')
  })

  it('skips silently when the parent spec is not in batch.specs', () => {
    const batch = emptyBatch([], [makeProxyRef('new-parent-missing', 'node-1', 'new-child')])

    // Should not throw
    expect(() => injectEmbeddedWorkflowSpecIds(batch)).not.toThrow()
  })

  it('skips silently when the nodeId is not found in the parent nodes array', () => {
    const node = makeProxyNode('node-1')
    const spec = makeBatchSpec('new-parent', { nodes: [node] })
    const batch = emptyBatch([spec], [makeProxyRef('new-parent', 'node-WRONG', 'new-child')])

    injectEmbeddedWorkflowSpecIds(batch)

    // node-1 must be untouched
    const data = JSON.parse((spec as { data: string }).data) as { nodes: Array<{ data: Record<string, unknown> }> }
    expect(data.nodes[0].data.embeddedWorkflowSpecId).toBeUndefined()
  })

  it('is idempotent: running twice produces the same output', () => {
    const node = makeProxyNode('node-1')
    const spec = makeBatchSpec('new-parent', { nodes: [node] })
    const batch = emptyBatch([spec], [makeProxyRef('new-parent', 'node-1', 'new-child')])

    injectEmbeddedWorkflowSpecIds(batch)
    const afterFirst = (spec as { data: string }).data

    injectEmbeddedWorkflowSpecIds(batch)
    const afterSecond = (spec as { data: string }).data

    expect(afterFirst).toBe(afterSecond)
  })
})
