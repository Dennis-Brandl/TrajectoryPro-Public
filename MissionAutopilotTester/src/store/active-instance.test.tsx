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

import { act, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  ActiveInstanceProvider,
  activeInstanceReducer,
  useActiveInstance,
  useTrackedInstances,
  type TrackedInstance,
} from './active-instance'

const wrapper = ({ children }: { children: ReactNode }) => (
  <ActiveInstanceProvider>{children}</ActiveInstanceProvider>
)

function makeTracked(overrides: Partial<TrackedInstance> = {}): TrackedInstance {
  return {
    instance_id: 'inst-1',
    connection_id: 'conn-1',
    action_oid: 'act-1',
    invoked_at: '2026-05-13T00:00:00Z',
    ...overrides,
  }
}

describe('activeInstanceReducer', () => {
  it('selectAction sets selection to {type:"action", action_oid}', () => {
    const next = activeInstanceReducer(
      { selection: null, trackedInstances: [] },
      { type: 'selectAction', action_oid: 'act-1' }
    )
    expect(next.selection).toEqual({ type: 'action', action_oid: 'act-1' })
  })

  it('selectInstance sets selection to {type:"instance", instance_id}', () => {
    const next = activeInstanceReducer(
      { selection: null, trackedInstances: [] },
      { type: 'selectInstance', instance_id: 'inst-1' }
    )
    expect(next.selection).toEqual({ type: 'instance', instance_id: 'inst-1' })
  })

  it('clearSelection sets selection to null', () => {
    const next = activeInstanceReducer(
      { selection: { type: 'action', action_oid: 'a' }, trackedInstances: [] },
      { type: 'clearSelection' }
    )
    expect(next.selection).toBeNull()
  })

  it('trackInstance prepends a new entry', () => {
    const initial = { selection: null, trackedInstances: [makeTracked({ instance_id: 'old' })] }
    const next = activeInstanceReducer(initial, {
      type: 'trackInstance',
      instance: makeTracked({ instance_id: 'new' }),
    })
    expect(next.trackedInstances).toHaveLength(2)
    expect(next.trackedInstances[0].instance_id).toBe('new')
    expect(next.trackedInstances[1].instance_id).toBe('old')
  })

  it('trackInstance caps the list at 50 most-recent PER CONNECTION', () => {
    const existing: TrackedInstance[] = Array.from({ length: 50 }, (_, i) =>
      makeTracked({ instance_id: `c1-${i}`, connection_id: 'conn-1' })
    )
    const other: TrackedInstance[] = Array.from({ length: 5 }, (_, i) =>
      makeTracked({ instance_id: `c2-${i}`, connection_id: 'conn-2' })
    )
    const initial = { selection: null, trackedInstances: [...existing, ...other] }
    const next = activeInstanceReducer(initial, {
      type: 'trackInstance',
      instance: makeTracked({ instance_id: 'c1-new', connection_id: 'conn-1' }),
    })
    const c1Count = next.trackedInstances.filter((t) => t.connection_id === 'conn-1').length
    const c2Count = next.trackedInstances.filter((t) => t.connection_id === 'conn-2').length
    expect(c1Count).toBe(50)
    expect(c2Count).toBe(5)
    expect(next.trackedInstances[0].instance_id).toBe('c1-new')
    expect(next.trackedInstances.find((t) => t.instance_id === 'c1-49')).toBeUndefined()
  })

  it('updateTrackedInstance updates last_known_state + last_known_error on an existing entry', () => {
    const initial = {
      selection: null,
      trackedInstances: [makeTracked({ instance_id: 'inst-1' })],
    }
    const next = activeInstanceReducer(initial, {
      type: 'updateTrackedInstance',
      instance_id: 'inst-1',
      patch: { last_known_state: 'COMPLETED', last_known_error: null },
    })
    expect(next.trackedInstances[0].last_known_state).toBe('COMPLETED')
    expect(next.trackedInstances[0].last_known_error).toBeNull()
  })

  it('updateTrackedInstance is a no-op for an unknown instance_id', () => {
    const initial = {
      selection: null,
      trackedInstances: [makeTracked({ instance_id: 'inst-1' })],
    }
    const next = activeInstanceReducer(initial, {
      type: 'updateTrackedInstance',
      instance_id: 'unknown',
      patch: { last_known_state: 'COMPLETED' },
    })
    expect(next.trackedInstances).toEqual(initial.trackedInstances)
  })
})

describe('ActiveInstanceProvider', () => {
  afterEach(() => {
    // Session-only state — no persistence to clean up.
  })

  it('exposes empty initial state', () => {
    const { result } = renderHook(() => useActiveInstance(), { wrapper })
    expect(result.current.state.selection).toBeNull()
    expect(result.current.state.trackedInstances).toEqual([])
  })

  it('selectAction / selectInstance / clearSelection update selection', () => {
    const { result } = renderHook(() => useActiveInstance(), { wrapper })
    act(() => result.current.selectAction('act-1'))
    expect(result.current.state.selection).toEqual({ type: 'action', action_oid: 'act-1' })
    act(() => result.current.selectInstance('inst-1'))
    expect(result.current.state.selection).toEqual({ type: 'instance', instance_id: 'inst-1' })
    act(() => result.current.clearSelection())
    expect(result.current.state.selection).toBeNull()
  })

  it('trackInstance generates an invoked_at timestamp', () => {
    const { result } = renderHook(() => useActiveInstance(), { wrapper })
    act(() =>
      result.current.trackInstance({
        instance_id: 'inst-1',
        connection_id: 'conn-1',
        action_oid: 'act-1',
      })
    )
    const tracked = result.current.state.trackedInstances[0]
    expect(tracked.instance_id).toBe('inst-1')
    expect(new Date(tracked.invoked_at).toString()).not.toBe('Invalid Date')
  })

  it('useTrackedInstances(connection_id) returns only that connection\'s tracked list', () => {
    const { result } = renderHook(
      () => {
        const api = useActiveInstance()
        const c1 = useTrackedInstances('conn-1')
        const c2 = useTrackedInstances('conn-2')
        return { api, c1, c2 }
      },
      { wrapper }
    )
    act(() => {
      result.current.api.trackInstance({
        instance_id: 'i1',
        connection_id: 'conn-1',
        action_oid: 'act-1',
      })
      result.current.api.trackInstance({
        instance_id: 'i2',
        connection_id: 'conn-2',
        action_oid: 'act-2',
      })
    })
    expect(result.current.c1.map((t) => t.instance_id)).toEqual(['i1'])
    expect(result.current.c2.map((t) => t.instance_id)).toEqual(['i2'])
  })

  it('throws when useActiveInstance is called outside the provider', () => {
    function Consumer() {
      useActiveInstance()
      return null
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(/ActiveInstanceProvider/)
    spy.mockRestore()
  })
})
