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
import { ReactNode } from 'react'
import {
  ConnectionsProvider,
  STORAGE_KEY,
  connectionsReducer,
  useActiveConnection,
  useConnections,
} from './connections'
import type { Connection } from '../api/types'

const wrapper = ({ children }: { children: ReactNode }) => (
  <ConnectionsProvider>{children}</ConnectionsProvider>
)

const sampleConnection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  name: 'Local dev',
  createdAt: '2026-05-13T00:00:00Z',
}

describe('connectionsReducer', () => {
  it('adds a connection and auto-selects it when none is active', () => {
    const next = connectionsReducer(
      { connections: [], activeConnectionId: null },
      { type: 'add', connection: sampleConnection }
    )
    expect(next.connections).toEqual([sampleConnection])
    expect(next.activeConnectionId).toBe('conn-1')
  })

  it('adds a second connection without changing the active selection', () => {
    const second: Connection = { ...sampleConnection, id: 'conn-2', url: 'http://other' }
    const next = connectionsReducer(
      { connections: [sampleConnection], activeConnectionId: 'conn-1' },
      { type: 'add', connection: second }
    )
    expect(next.connections).toHaveLength(2)
    expect(next.activeConnectionId).toBe('conn-1')
  })

  it('updates an existing connection by id', () => {
    const next = connectionsReducer(
      { connections: [sampleConnection], activeConnectionId: 'conn-1' },
      { type: 'update', id: 'conn-1', patch: { name: 'Renamed', apiKey: 'sek' } }
    )
    expect(next.connections[0].name).toBe('Renamed')
    expect(next.connections[0].apiKey).toBe('sek')
    expect(next.connections[0].url).toBe('http://localhost:3000')
  })

  it('deletes a connection and falls back to first remaining when active was removed', () => {
    const second: Connection = { ...sampleConnection, id: 'conn-2' }
    const next = connectionsReducer(
      { connections: [sampleConnection, second], activeConnectionId: 'conn-1' },
      { type: 'delete', id: 'conn-1' }
    )
    expect(next.connections).toEqual([second])
    expect(next.activeConnectionId).toBe('conn-2')
  })

  it('keeps the active selection when a non-active connection is deleted', () => {
    const second: Connection = { ...sampleConnection, id: 'conn-2' }
    const next = connectionsReducer(
      { connections: [sampleConnection, second], activeConnectionId: 'conn-1' },
      { type: 'delete', id: 'conn-2' }
    )
    expect(next.connections).toEqual([sampleConnection])
    expect(next.activeConnectionId).toBe('conn-1')
  })

  it('clears active selection when the last connection is deleted', () => {
    const next = connectionsReducer(
      { connections: [sampleConnection], activeConnectionId: 'conn-1' },
      { type: 'delete', id: 'conn-1' }
    )
    expect(next.connections).toEqual([])
    expect(next.activeConnectionId).toBeNull()
  })

  it('explicitly selects a connection', () => {
    const second: Connection = { ...sampleConnection, id: 'conn-2' }
    const next = connectionsReducer(
      { connections: [sampleConnection, second], activeConnectionId: 'conn-1' },
      { type: 'select', id: 'conn-2' }
    )
    expect(next.activeConnectionId).toBe('conn-2')
  })

  it('allows clearing the active selection with select null', () => {
    const next = connectionsReducer(
      { connections: [sampleConnection], activeConnectionId: 'conn-1' },
      { type: 'select', id: null }
    )
    expect(next.activeConnectionId).toBeNull()
  })
})

describe('ConnectionsProvider', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('exposes empty initial state to consumers', () => {
    const { result } = renderHook(() => useConnections(), { wrapper })
    expect(result.current.state.connections).toEqual([])
    expect(result.current.state.activeConnectionId).toBeNull()
  })

  it('rehydrates from localStorage on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ connections: [sampleConnection], activeConnectionId: 'conn-1' })
    )
    const { result } = renderHook(() => useConnections(), { wrapper })
    expect(result.current.state.connections).toEqual([sampleConnection])
    expect(result.current.state.activeConnectionId).toBe('conn-1')
  })

  it('persists changes back to localStorage', () => {
    const { result } = renderHook(() => useConnections(), { wrapper })
    act(() => {
      result.current.addConnection({ url: 'http://localhost:3000', name: 'Local' })
    })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as {
      connections: Connection[]
      activeConnectionId: string | null
    }
    expect(stored.connections).toHaveLength(1)
    expect(stored.connections[0].name).toBe('Local')
    expect(stored.activeConnectionId).toBe(stored.connections[0].id)
  })

  it('addConnection generates an id and createdAt', () => {
    const { result } = renderHook(() => useConnections(), { wrapper })
    act(() => {
      result.current.addConnection({ url: 'http://x' })
    })
    const added = result.current.state.connections[0]
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(new Date(added.createdAt).toString()).not.toBe('Invalid Date')
  })

  it('addConnection returns the newly-created Connection', () => {
    const { result } = renderHook(() => useConnections(), { wrapper })
    let returned: Connection | undefined
    act(() => {
      returned = result.current.addConnection({ url: 'http://localhost:3000', name: 'Local' })
    })
    expect(returned).toBeDefined()
    expect(returned!.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(returned!.url).toBe('http://localhost:3000')
    expect(returned!.name).toBe('Local')
    expect(returned).toEqual(result.current.state.connections[0])
  })

  it('useActiveConnection returns null when nothing is selected', () => {
    const { result } = renderHook(() => useActiveConnection(), { wrapper })
    expect(result.current).toBeNull()
  })

  it('useActiveConnection returns the active connection object', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ connections: [sampleConnection], activeConnectionId: 'conn-1' })
    )
    const { result } = renderHook(() => useActiveConnection(), { wrapper })
    expect(result.current).toEqual(sampleConnection)
  })

  it('throws when useConnections is called outside the provider', () => {
    function Consumer() {
      useConnections()
      return null
    }
    // Suppress React's expected error output for this negative test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(/ConnectionsProvider/)
    spy.mockRestore()
  })
})
