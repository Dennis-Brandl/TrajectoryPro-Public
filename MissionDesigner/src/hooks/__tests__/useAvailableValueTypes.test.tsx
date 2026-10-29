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

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAvailableValueTypes } from '@/hooks/useAvailableValueTypes'
import { useLibraryStore } from '@/stores/libraryStore'
import type { Specification } from '@/types/library'
import type { ValueTypeSpec } from '@/types/nodes'

function makeSpec(id: string, libraryId: string, name: string, data: Record<string, unknown>): Specification {
  return {
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
  }
}

function vt(id: string, name: string, entryNames: string[]): ValueTypeSpec {
  return { id, name, entries: entryNames.map((n, i) => ({ id: `${id}-e${i}`, name: n })) }
}

beforeEach(() => {
  useLibraryStore.setState({ specifications: new Map(), selectedSpecificationId: null })
})

describe('useAvailableValueTypes', () => {
  it('returns nothing when no workflow is selected', () => {
    const { result } = renderHook(() => useAvailableValueTypes())
    expect(result.current.allValueTypes).toEqual([])
    expect(result.current.groups).toEqual([])
  })

  it('collects types from the current workflow environments and the parent chain, first-wins by name', () => {
    const envA = makeSpec('env-a', 'lib-env', 'Bakery', {
      valueTypes: [vt('vt-1', 'CustomerInfo', ['Name', 'Address'])],
    })
    const envB = makeSpec('env-b', 'lib-env', 'Cafe', {
      valueTypes: [
        vt('vt-2', 'CustomerInfo', ['Different']), // shadowed by envA's (first wins)
        vt('vt-3', 'VendorInfo', ['Company']),
      ],
    })
    const parent = makeSpec('wf-parent', 'lib-wf', 'Parent', { environmentSpecIds: ['env-b'] })
    const child = makeSpec('wf-child', 'lib-wf', 'Child', {
      environmentSpecIds: ['env-a'],
      parentSpecificationId: 'wf-parent',
    })
    useLibraryStore.setState({
      specifications: new Map([
        ['lib-env', [envA, envB]],
        ['lib-wf', [parent, child]],
      ]),
      selectedSpecificationId: 'wf-child',
    })

    const { result } = renderHook(() => useAvailableValueTypes())
    expect(result.current.allValueTypes.map((t) => t.id)).toEqual(['vt-1', 'vt-3'])
    expect(result.current.groups.map((g) => g.label)).toEqual(['Env: Bakery', 'Env: Cafe'])
  })

  it('skips types with no entries (nothing to copy)', () => {
    const env = makeSpec('env-a', 'lib-env', 'Bakery', {
      valueTypes: [vt('vt-empty', 'Empty', []), vt('vt-1', 'CustomerInfo', ['Name'])],
    })
    const wf = makeSpec('wf-1', 'lib-wf', 'Flow', { environmentSpecIds: ['env-a'] })
    useLibraryStore.setState({
      specifications: new Map([
        ['lib-env', [env]],
        ['lib-wf', [wf]],
      ]),
      selectedSpecificationId: 'wf-1',
    })

    const { result } = renderHook(() => useAvailableValueTypes())
    expect(result.current.allValueTypes.map((t) => t.id)).toEqual(['vt-1'])
  })
})
