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
import { usePresence } from '../presence'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    enterPresence: vi.fn(),
    heartbeat: vi.fn(),
    leavePresence: vi.fn(),
  },
}))

describe('usePresence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.enterPresence).mockResolvedValue(undefined)
    vi.mocked(api.heartbeat).mockResolvedValue(undefined)
    vi.mocked(api.leavePresence).mockResolvedValue(undefined)
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('does nothing when wcId is null', () => {
    renderHook(() => usePresence(null))
    expect(api.enterPresence).not.toHaveBeenCalled()
    expect(api.heartbeat).not.toHaveBeenCalled()
  })

  it('calls enterPresence(wcId) once on mount when wcId is set', () => {
    renderHook(() => usePresence('wc1'))
    expect(api.enterPresence).toHaveBeenCalledTimes(1)
    expect(api.enterPresence).toHaveBeenCalledWith('wc1')
  })

  it('calls heartbeat every 30s while mounted with a wcId, with an explicit "back" status while not away', () => {
    renderHook(() => usePresence('wc1'))
    expect(api.heartbeat).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(api.heartbeat).toHaveBeenCalledTimes(1)
    expect(api.heartbeat).toHaveBeenLastCalledWith('back')

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(api.heartbeat).toHaveBeenCalledTimes(2)
    expect(api.heartbeat).toHaveBeenLastCalledWith('back')

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(api.heartbeat).toHaveBeenCalledTimes(4)
    expect(api.heartbeat).toHaveBeenLastCalledWith('back')
  })

  it('the periodic tick sends an explicit "away" status once toggled away, self-healing a dropped one-shot send', () => {
    const { result } = renderHook(() => usePresence('wc1'))

    act(() => {
      result.current.toggleAway()
    })
    expect(api.heartbeat).toHaveBeenLastCalledWith('away')
    vi.mocked(api.heartbeat).mockClear()

    // Simulate the one-shot 'away' send above having been lost in transit
    // (its rejection is swallowed) — the next periodic tick must still
    // re-assert 'away' rather than sending no status at all.
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(api.heartbeat).toHaveBeenCalledWith('away')
  })

  it('toggleAway flips away and sends heartbeat("away") then heartbeat("back") immediately', () => {
    const { result } = renderHook(() => usePresence('wc1'))
    expect(result.current.away).toBe(false)

    act(() => {
      result.current.toggleAway()
    })
    expect(result.current.away).toBe(true)
    expect(api.heartbeat).toHaveBeenLastCalledWith('away')

    act(() => {
      result.current.toggleAway()
    })
    expect(result.current.away).toBe(false)
    expect(api.heartbeat).toHaveBeenLastCalledWith('back')
  })

  it('calls leavePresence on unmount', () => {
    const { unmount } = renderHook(() => usePresence('wc1'))
    expect(api.leavePresence).not.toHaveBeenCalled()

    unmount()
    expect(api.leavePresence).toHaveBeenCalledTimes(1)
  })

  it('does not call leavePresence on unmount if wcId was never set', () => {
    const { unmount } = renderHook(() => usePresence(null))
    unmount()
    expect(api.leavePresence).not.toHaveBeenCalled()
  })

  it('resets away to false when wcId switches to a new work center', () => {
    const { result, rerender } = renderHook(({ wcId }: { wcId: string | null }) => usePresence(wcId), {
      initialProps: { wcId: 'wc1' },
    })

    act(() => {
      result.current.toggleAway()
    })
    expect(result.current.away).toBe(true)

    rerender({ wcId: 'wc2' })
    expect(result.current.away).toBe(false)
  })

  it('leaves the old work center before entering the new one when wcId switches', () => {
    const order: string[] = []
    vi.mocked(api.leavePresence).mockImplementation(() => {
      order.push('leave')
      return Promise.resolve(undefined)
    })
    vi.mocked(api.enterPresence).mockImplementation((wcId: string) => {
      order.push(`enter:${wcId}`)
      return Promise.resolve(undefined)
    })

    const { rerender } = renderHook(({ wcId }: { wcId: string | null }) => usePresence(wcId), {
      initialProps: { wcId: 'wc1' },
    })
    expect(order).toEqual(['enter:wc1'])

    rerender({ wcId: 'wc2' })
    expect(order).toEqual(['enter:wc1', 'leave', 'enter:wc2'])
  })

  it('switching work centers leaves the old one by id', () => {
    const { rerender, unmount } = renderHook(({ wcId }: { wcId: string | null }) => usePresence(wcId), {
      initialProps: { wcId: 'A' },
    })
    rerender({ wcId: 'B' })
    expect(api.leavePresence).toHaveBeenCalledTimes(1)
    expect(api.leavePresence).toHaveBeenLastCalledWith('A')
    unmount()
    expect(api.leavePresence).toHaveBeenLastCalledWith('B')
  })

  it('sets error to the fixed copy when enterPresence rejects', async () => {
    vi.mocked(api.enterPresence).mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => usePresence('wc1'))

    await act(async () => {})

    expect(result.current.error).toBe('Could not enter work center.')
  })

  it('leaves error null when enterPresence resolves', async () => {
    const { result } = renderHook(() => usePresence('wc1'))

    await act(async () => {})

    expect(result.current.error).toBeNull()
  })

  it('ignores a stale enterPresence rejection that settles after switching to a new wcId', async () => {
    let rejectFirst: (err: unknown) => void = () => {}
    const firstCall = new Promise<undefined>((_resolve, reject) => {
      rejectFirst = reject
    })
    vi.mocked(api.enterPresence)
      .mockImplementationOnce(() => firstCall)
      .mockResolvedValueOnce(undefined)

    const { result, rerender } = renderHook(({ wcId }: { wcId: string | null }) => usePresence(wcId), {
      initialProps: { wcId: 'wc1' },
    })

    // Switch to a new wcId WHILE the first enterPresence call is still in
    // flight — this triggers the wc1 effect's cleanup (cancelled = true)
    // and starts a fresh, already-resolving call for wc2.
    rerender({ wcId: 'wc2' })
    await act(async () => {})
    expect(result.current.error).toBeNull()

    // The stale wc1 call finally rejects AFTER the switch — must be ignored.
    rejectFirst(new Error('boom'))
    await act(async () => {})

    expect(result.current.error).toBeNull()
  })
})
