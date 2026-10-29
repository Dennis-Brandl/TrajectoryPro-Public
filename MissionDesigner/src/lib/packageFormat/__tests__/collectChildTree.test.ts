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
import { collectChildTree, type TreeSpec } from '../collectChildTree'

function spec(id: string, parent: string | null): TreeSpec {
  return {
    id,
    parentSpecificationId: parent,
    name: id,
    description: null,
    data: { nodes: [], edges: [] },
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('collectChildTree', () => {
  it('builds a ChildSpecification[] from the store childrenOf index with correct linkage', () => {
    // R (root) → A, B ; A → G (grandchild)
    const childrenOf = new Map<string, readonly TreeSpec[]>([
      ['R', [spec('A', 'R'), spec('B', 'R')]],
      ['A', [spec('G', 'A')]],
    ])
    const tree = collectChildTree('R', childrenOf)
    const byId = Object.fromEntries(tree.map((c) => [c.id, c]))

    expect(tree).toHaveLength(3)
    // direct children of the root → parentChildSpecId null, depth 1
    expect(byId.A.parentChildSpecId).toBeNull()
    expect(byId.B.parentChildSpecId).toBeNull()
    expect(byId.A.depth).toBe(1)
    // grandchild → parentChildSpecId is its parent spec id (not the root), depth 2
    expect(byId.G.parentChildSpecId).toBe('A')
    expect(byId.G.parentSpecificationId).toBe('A')
    expect(byId.G.depth).toBe(2)
    // data carried through verbatim for buildNestedChildExport
    expect(byId.A.data).toEqual({ nodes: [], edges: [] })
  })

  it('returns [] for a root with no loaded children', () => {
    expect(collectChildTree('R', new Map())).toEqual([])
  })

  it('does not add the root as its own descendant or loop on a cycle', () => {
    const childrenOf = new Map<string, readonly TreeSpec[]>([
      ['R', [spec('A', 'R')]],
      ['A', [spec('R', 'A')]], // pathological cycle back to the root
    ])
    const tree = collectChildTree('R', childrenOf)
    expect(tree.map((c) => c.id)).toEqual(['A'])
  })
})
