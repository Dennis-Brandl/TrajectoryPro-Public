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
import { useAvailableActionProperties } from '@/hooks/useAvailableActionProperties'
import { useLibraryStore } from '@/stores/libraryStore'
import { useFlowStore } from '@/stores/flowStore'
import type { Specification } from '@/types/library'
import type { ValueSpec } from '@/types/nodes'

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

function prop(id: string, name: string, entryNames: string[]): ValueSpec {
  return { id, name, entries: entryNames.map((n, i) => ({ id: `${id}-e${i}`, name: n, value: '' })) }
}

beforeEach(() => {
  useLibraryStore.setState({ specifications: new Map(), selectedSpecificationId: null })
  useFlowStore.setState({ workflowValues: [] })
})

describe('useAvailableActionProperties (spec 2026-09-04 §5.2.1)', () => {
  it('returns nothing when no workflow is selected', () => {
    const { result } = renderHook(() => useAvailableActionProperties())
    expect(result.current.groups).toEqual([])
    expect([...result.current.allNames]).toEqual([])
  })

  it('collects from the current environments and the parent chain, first-wins by name, with dot-notation entry refs', () => {
    const envA = makeSpec('env-a', 'lib-env', 'Kitchen', {
      actionProperties: [prop('ap-1', 'Sensor', ['Value', 'Description'])],
    })
    const envB = makeSpec('env-b', 'lib-env', 'Bakery', {
      actionProperties: [prop('ap-2', 'Sensor', ['Other']), prop('ap-3', 'Oven', ['Temp'])],
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

    const { result } = renderHook(() => useAvailableActionProperties())
    expect(result.current.groups.map((g) => g.label)).toEqual([
      'Env: Kitchen (Action Properties)',
      'Env: Bakery (Action Properties)',
    ])
    expect(result.current.groups[0].envSpecId).toBe('env-a')
    expect(result.current.groups[1].values.map((v) => v.id)).toEqual(['ap-3']) // Bakery's Sensor shadowed by Kitchen's
    expect([...result.current.allNames]).toEqual(['Sensor', 'Oven'])
    expect([...result.current.allEntryRefs]).toEqual(['Sensor.Value', 'Oven.Temp']) // Description hidden
  })

  it('hides an Action Property whose name matches a Value Property in scope (D5)', () => {
    const env = makeSpec('env-a', 'lib-env', 'Kitchen', {
      values: [prop('vp-1', 'Sensor', ['Value'])],
      actionProperties: [prop('ap-1', 'Sensor', ['Value']), prop('ap-2', 'Oven', ['Temp'])],
    })
    const wf = makeSpec('wf-1', 'lib-wf', 'Flow', { environmentSpecIds: ['env-a'] })
    useLibraryStore.setState({
      specifications: new Map([
        ['lib-env', [env]],
        ['lib-wf', [wf]],
      ]),
      selectedSpecificationId: 'wf-1',
    })
    useFlowStore.setState({ workflowValues: [prop('wv-1', 'Oven', ['Temp'])] })

    const { result } = renderHook(() => useAvailableActionProperties())
    expect(result.current.groups).toEqual([]) // Sensor shadowed by the env Value Property, Oven by the workflow Value Property
  })

  it('dedupes two Action Properties of the same name inside ONE environment (no duplicate React keys)', () => {
    const env = makeSpec('env-a', 'lib-env', 'Kitchen', {
      actionProperties: [prop('ap-1', 'Sensor', ['Value']), prop('ap-2', 'Sensor', ['Other'])],
    })
    const wf = makeSpec('wf-1', 'lib-wf', 'Flow', { environmentSpecIds: ['env-a'] })
    useLibraryStore.setState({
      specifications: new Map([
        ['lib-env', [env]],
        ['lib-wf', [wf]],
      ]),
      selectedSpecificationId: 'wf-1',
    })

    const { result } = renderHook(() => useAvailableActionProperties())
    expect(result.current.groups).toHaveLength(1)
    expect(result.current.groups[0].values.map((v) => v.id)).toEqual(['ap-1']) // first one wins, no duplicate
    expect([...result.current.allNames]).toEqual(['Sensor'])
  })

  it('skips unnamed properties and environments that cannot be found', () => {
    const env = makeSpec('env-a', 'lib-env', 'Kitchen', { actionProperties: [prop('ap-1', '', ['Value'])] })
    const wf = makeSpec('wf-1', 'lib-wf', 'Flow', { environmentSpecIds: ['env-a', 'env-missing'] })
    useLibraryStore.setState({
      specifications: new Map([
        ['lib-env', [env]],
        ['lib-wf', [wf]],
      ]),
      selectedSpecificationId: 'wf-1',
    })
    const { result } = renderHook(() => useAvailableActionProperties())
    expect(result.current.groups).toEqual([])
  })
})
