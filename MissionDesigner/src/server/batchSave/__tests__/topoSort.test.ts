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

// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { topoSortCreates, TopoCycleError } from '../topoSort'

describe('topoSortCreates (Kahn)', () => {
  it('orders parents before children', () => {
    const result = topoSortCreates([
      { id: 'c', parentSpecificationId: 'b' },
      { id: 'b', parentSpecificationId: 'a' },
      { id: 'a', parentSpecificationId: null },
    ])
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('handles roots with null parent', () => {
    const r = topoSortCreates([
      { id: 'a', parentSpecificationId: null },
      { id: 'b', parentSpecificationId: null },
    ])
    expect(r.sort()).toEqual(['a', 'b'])
  })

  it('throws TopoCycleError on a cycle', () => {
    expect(() =>
      topoSortCreates([
        { id: 'a', parentSpecificationId: 'b' },
        { id: 'b', parentSpecificationId: 'a' },
      ]),
    ).toThrow(TopoCycleError)
  })

  it('allows parent NOT in the input set (resolves at runtime)', () => {
    // 'x' is the parent but not in the batch (already exists in DB).
    const r = topoSortCreates([{ id: 'a', parentSpecificationId: 'x' }])
    expect(r).toEqual(['a'])
  })
})
