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
import { cloneSpecificationSubtree, type CloneSourceRow } from '@/server/actions/cloneSpecificationSubtree'

function row(overrides: Partial<CloneSourceRow> & Pick<CloneSourceRow, 'id'>): CloneSourceRow {
  return {
    libraryId: 'lib-1',
    name: 'X',
    description: null,
    typeName: null,
    version: '1.0.0',
    state: 'Effective',
    data: '{}',
    environmentLibraryIds: null,
    parentSpecificationId: null,
    rootSpecificationId: null,
    dataSchemaVersion: 3,
    lastEditedByUserId: null,
    history: '[]',
    ...overrides,
  }
}

describe('cloneSpecificationSubtree', () => {
  it('single root: returns one row with new id, parent/root null, state Draft', () => {
    const source = [row({ id: 'src-root' })]
    const result = cloneSpecificationSubtree({
      source,
      newRootVersion: '2.0.0',
      account: 'a@b.com',
      newId: () => 'new-root',
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe('new-root')
    expect(result.rows[0].parentSpecificationId).toBeNull()
    expect(result.rows[0].rootSpecificationId).toBeNull()
    expect(result.rows[0].state).toBe('Draft')
    expect(result.rows[0].version).toBe('2.0.0')
    expect(result.newRootId).toBe('new-root')
  })

  it('root + child: child re-parented to new root, root referenced as new root id', () => {
    const source = [
      row({ id: 'src-root' }),
      row({ id: 'src-child', parentSpecificationId: 'src-root', rootSpecificationId: 'src-root' }),
    ]
    let n = 0
    const result = cloneSpecificationSubtree({
      source,
      newRootVersion: '2.0.0',
      account: 'a@b.com',
      newId: () => `new-${n++}`,
    })
    expect(result.rows).toHaveLength(2)
    const newRoot = result.rows.find((r) => r.id === result.newRootId)!
    const newChild = result.rows.find((r) => r.id !== result.newRootId)!
    expect(newChild.parentSpecificationId).toBe(newRoot.id)
    expect(newChild.rootSpecificationId).toBe(newRoot.id)
  })

  it('root gets a new_version history entry; descendants get []', () => {
    const source = [
      row({ id: 'src-root' }),
      row({ id: 'src-child', parentSpecificationId: 'src-root', rootSpecificationId: 'src-root' }),
    ]
    let n = 0
    const result = cloneSpecificationSubtree({
      source,
      newRootVersion: '2.0.0',
      account: 'a@b.com',
      newId: () => `new-${n++}`,
    })
    const newRoot = result.rows.find((r) => r.id === result.newRootId)!
    const newChild = result.rows.find((r) => r.id !== result.newRootId)!
    const rootHistory = JSON.parse(newRoot.history)
    expect(rootHistory).toHaveLength(1)
    expect(rootHistory[0].type).toBe('new_version')
    expect(rootHistory[0].fromVersion).toBe('1.0.0')
    expect(rootHistory[0].fromSpecId).toBe('src-root')
    expect(JSON.parse(newChild.history)).toEqual([])
  })
})

describe('cloneSpecificationSubtree data rewriting', () => {
  it('rewrites embeddedWorkflowSpecId when target is in the cloned subtree', () => {
    const childData = JSON.stringify({ nodes: [] })
    const rootData = JSON.stringify({
      nodes: [
        { id: 'n1', type: 'workflowProxy', data: { subWorkflowMode: 'embedded', embeddedWorkflowSpecId: 'src-child' } },
      ],
    })
    const source = [
      row({ id: 'src-root', data: rootData }),
      row({ id: 'src-child', parentSpecificationId: 'src-root', rootSpecificationId: 'src-root', data: childData }),
    ]
    let n = 0
    const result = cloneSpecificationSubtree({
      source,
      newRootVersion: '2.0.0',
      account: 'a@b.com',
      newId: () => `new-${n++}`,
    })
    const newChildId = result.oidMap.get('src-child')!
    const newRoot = result.rows.find((r) => r.id === result.newRootId)!
    const parsed = JSON.parse(newRoot.data)
    expect(parsed.nodes[0].data.embeddedWorkflowSpecId).toBe(newChildId)
  })

  it('leaves referencedStepSpecId untouched when target is outside the cloned subtree', () => {
    const rootData = JSON.stringify({
      nodes: [
        {
          id: 'n1',
          type: 'workflowProxy',
          data: { subWorkflowMode: 'reference', referencedStepSpecId: 'external-spec-99' },
        },
      ],
    })
    const source = [row({ id: 'src-root', data: rootData })]
    const result = cloneSpecificationSubtree({
      source,
      newRootVersion: '2.0.0',
      account: 'a@b.com',
      newId: () => 'new-root',
    })
    const newRoot = result.rows[0]
    const parsed = JSON.parse(newRoot.data)
    expect(parsed.nodes[0].data.referencedStepSpecId).toBe('external-spec-99')
  })

  it('leaves embeddedWorkflowSpecId untouched when target is unexpectedly outside cloned subtree', () => {
    const rootData = JSON.stringify({
      nodes: [
        {
          id: 'n1',
          type: 'workflowProxy',
          data: { subWorkflowMode: 'embedded', embeddedWorkflowSpecId: 'unmapped-spec' },
        },
      ],
    })
    const source = [row({ id: 'src-root', data: rootData })]
    const result = cloneSpecificationSubtree({
      source,
      newRootVersion: '2.0.0',
      account: 'a@b.com',
      newId: () => 'new-root',
    })
    const parsed = JSON.parse(result.rows[0].data)
    expect(parsed.nodes[0].data.embeddedWorkflowSpecId).toBe('unmapped-spec')
  })

  it('leaves data with no workflowProxy nodes unchanged', () => {
    const rootData = JSON.stringify({ nodes: [{ id: 'n1', type: 'instructionStep', data: { text: 'hello' } }] })
    const source = [row({ id: 'src-root', data: rootData })]
    const result = cloneSpecificationSubtree({
      source,
      newRootVersion: '2.0.0',
      account: 'a@b.com',
      newId: () => 'new-root',
    })
    expect(JSON.parse(result.rows[0].data)).toEqual(JSON.parse(rootData))
  })

  it('copies keep typeName on the root and descendants', () => {
    const source = [
      row({ id: 'src-root', typeName: 'Procedure' }),
      row({
        id: 'src-child',
        parentSpecificationId: 'src-root',
        rootSpecificationId: 'src-root',
        typeName: 'Operation',
      }),
    ]
    let n = 0
    const result = cloneSpecificationSubtree({
      source,
      newRootVersion: '2.0.0',
      account: 'a@b.com',
      newId: () => `new-${n++}`,
    })
    const byName = new Map(result.rows.map((r) => [r.parentSpecificationId === null ? 'root' : 'child', r.typeName]))
    expect(byName.get('root')).toBe('Procedure')
    expect(byName.get('child')).toBe('Operation')
  })
})
