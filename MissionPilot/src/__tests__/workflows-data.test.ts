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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useWorkflowDiagrams } from '../workflows-data'
import { INBOX_CHANGED_EVENT } from '../inbox-data'
import { api } from '../api/client'
import type { PilotRuntimeWorkflow, RuntimeWorkflowDiagram, RuntimeWorkflowLiveStates } from '../api/types'

vi.mock('../api/client', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number) { super(`HTTP ${status}`); this.status = status }
  }
  return { api: { runtimeWorkflows: vi.fn(), runtimeDiagram: vi.fn(), runtimeLiveStates: vi.fn() }, ApiError }
})

function wf(over: Partial<PilotRuntimeWorkflow> = {}): PilotRuntimeWorkflow {
  return {
    id: 'i1', workCenterId: 'wc1', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001', masterName: 'M', masterOid: 'm', masterVersion: '1.0.0',
    masterState: 'Effective', status: 'running', createdByName: null,  createdByLabel: null, createdAt: '2026-08-19T00:00:00Z',
    queuedAt: null, startedAt: null, completedAt: null, activeSteps: [], errorText: null, mine: false, ...over,
  }
}
const DIAGRAM: RuntimeWorkflowDiagram = {
  instanceId: 'i1', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001', masterName: 'M',
  root: { oid: 'rt_0', name: 'M', version: null, state: null, notation: 'flowchart', steps: [], connections: [], children: [] },
}
const LIVE: RuntimeWorkflowLiveStates = { instanceId: 'i1', status: 'running', steps: {}, childActive: {} }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.mocked(api.runtimeWorkflows).mockResolvedValue([wf()])
  vi.mocked(api.runtimeDiagram).mockResolvedValue(DIAGRAM)
  vi.mocked(api.runtimeLiveStates).mockResolvedValue(LIVE)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useWorkflowDiagrams', () => {
  it('inactive tab: fetches nothing', async () => {
    renderHook(() => useWorkflowDiagrams('wc1', false, true, null))
    await act(async () => {})
    expect(api.runtimeWorkflows).not.toHaveBeenCalled()
  })

  it('active: fetches the list immediately, then every 5s; stops when deactivated', async () => {
    const { result, rerender } = renderHook(
      ({ active }) => useWorkflowDiagrams('wc1', active, true, null),
      { initialProps: { active: true } },
    )
    await act(async () => {})
    expect(api.runtimeWorkflows).toHaveBeenCalledTimes(1)
    expect(result.current.list).toEqual([wf()])
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(api.runtimeWorkflows).toHaveBeenCalledTimes(2)
    rerender({ active: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(api.runtimeWorkflows).toHaveBeenCalledTimes(2)
  })

  it('selected instance: diagram once (cached), live states at 2s', async () => {
    const { rerender } = renderHook(
      ({ sel }) => useWorkflowDiagrams('wc1', true, true, sel),
      { initialProps: { sel: 'i1' as string | null } },
    )
    await act(async () => {})
    expect(api.runtimeDiagram).toHaveBeenCalledTimes(1)
    expect(api.runtimeLiveStates).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(api.runtimeLiveStates).toHaveBeenCalledTimes(2)
    // Deselect + reselect: the diagram is served from memory, not re-fetched.
    rerender({ sel: null })
    await act(async () => {})
    rerender({ sel: 'i1' })
    await act(async () => {})
    expect(api.runtimeDiagram).toHaveBeenCalledTimes(1)
  })

  it('the inbox-changed event triggers an immediate list re-fetch', async () => {
    renderHook(() => useWorkflowDiagrams('wc1', true, true, null))
    await act(async () => {})
    expect(api.runtimeWorkflows).toHaveBeenCalledTimes(1)
    await act(async () => { window.dispatchEvent(new Event(INBOX_CHANGED_EVENT)) })
    expect(api.runtimeWorkflows).toHaveBeenCalledTimes(2)
  })

  it('a 404 on the selected instance sets unavailable; keeps the last list', async () => {
    const { ApiError } = await import('../api/client')
    vi.mocked(api.runtimeLiveStates).mockRejectedValue(new (ApiError as any)(404))
    vi.mocked(api.runtimeDiagram).mockRejectedValue(new (ApiError as any)(404))
    const { result } = renderHook(() => useWorkflowDiagrams('wc1', true, true, 'gone'))
    await act(async () => {})
    expect(result.current.unavailable).toBe(true)
    expect(result.current.list).toEqual([wf()])
  })

  it('offline: intervals pause and no fetch fires', async () => {
    const { rerender } = renderHook(
      ({ online }) => useWorkflowDiagrams('wc1', true, online, 'i1'),
      { initialProps: { online: true } },
    )
    await act(async () => {})
    const listCalls = vi.mocked(api.runtimeWorkflows).mock.calls.length
    rerender({ online: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(api.runtimeWorkflows).toHaveBeenCalledTimes(listCalls)
  })
})
