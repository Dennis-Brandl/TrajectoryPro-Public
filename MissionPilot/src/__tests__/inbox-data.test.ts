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
import { useInbox, clearSnapshotCache } from '../inbox-data'
import { api } from '../api/client'
import type { InboxSnapshot, InboxTask } from '../api/types'

vi.mock('../api/client', () => ({
  api: {
    inbox: vi.fn(),
  },
}))

// Controllable fake for the global EventSource: records every instance so a
// test can reach in and fire a named server event via emit(), and exposes
// `closed` so cleanup-on-unmount/wcId-change can be asserted.
class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  closed = false
  private listeners = new Map<string, Array<(evt: { data: string }) => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (evt: { data: string }) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, listener: (evt: { data: string }) => void) {
    const list = this.listeners.get(type)
    if (!list) return
    this.listeners.set(
      type,
      list.filter((l) => l !== listener),
    )
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: unknown) {
    const evt = { data: JSON.stringify(data) }
    for (const listener of this.listeners.get(type) ?? []) listener(evt)
  }
}

function snapshot(overrides: Partial<InboxSnapshot> = {}): InboxSnapshot {
  return { workCenterId: 'wc1', offers: [], myClaims: [], ...overrides }
}

function task(overrides: Partial<InboxTask> = {}): InboxTask {
  return {
    assignmentId: 'a1',
    stepInstanceId: 'si1',
    stepOid: 'so1',
    stepType: 'form',
    stepName: 'Step',
    instanceId: 'i1',
    runtimeNumber: 1,
    runtimeLabel: 'MIX-20261007-001',
    masterName: 'Master',
    offeredAt: '2026-08-03T00:00:00.000Z',
    claimedAt: null,
    suggestedForMe: false,
    paused: false,
    formDocument: null,
    yesNoConfig: null,
    ...overrides,
  }
}

let online = true

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  FakeEventSource.instances.length = 0
  vi.stubGlobal('EventSource', FakeEventSource)
  online = true
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  })
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useInbox', () => {
  it('serves the cached snapshot immediately with stale=true, then replaces it with the fetched result (stale=false)', async () => {
    const cached = snapshot({ offers: [] })
    localStorage.setItem('pilot:snapshot:wc1', JSON.stringify(cached))
    const fresh = snapshot({ myClaims: [] })
    vi.mocked(api.inbox).mockResolvedValue(fresh)

    const { result } = renderHook(() => useInbox('wc1'))

    expect(result.current.snapshot).toEqual(cached)
    expect(result.current.stale).toBe(true)

    await act(async () => {})

    expect(api.inbox).toHaveBeenCalledWith('wc1')
    expect(result.current.snapshot).toEqual(fresh)
    expect(result.current.stale).toBe(false)
  })

  it('syncedAt is null while only the cache shows, then records when live data last landed', async () => {
    localStorage.setItem('pilot:snapshot:wc1', JSON.stringify(snapshot()))
    vi.setSystemTime(new Date(2026, 9, 9, 10, 42, 0))
    vi.mocked(api.inbox).mockResolvedValue(snapshot())

    const { result } = renderHook(() => useInbox('wc1'))
    expect(result.current.syncedAt).toBeNull()

    await act(async () => {})
    expect(result.current.syncedAt?.getTime()).toBe(new Date(2026, 9, 9, 10, 42, 0).getTime())

    vi.setSystemTime(new Date(2026, 9, 9, 10, 43, 30))
    act(() => {
      FakeEventSource.instances[0]!.emit('inbox', snapshot())
    })
    expect(result.current.syncedAt?.getTime()).toBe(new Date(2026, 9, 9, 10, 43, 30).getTime())
  })

  it('a failed fetch or a dropped event stream marks the engine unreachable until live data lands again (final review)', async () => {
    vi.mocked(api.inbox).mockRejectedValue(new Error('engine down'))
    const { result } = renderHook(() => useInbox('wc1'))
    expect(result.current.unreachable).toBe(false)

    await act(async () => {})
    expect(result.current.unreachable).toBe(true)

    act(() => {
      FakeEventSource.instances[0]!.emit('inbox', snapshot())
    })
    expect(result.current.unreachable).toBe(false)

    act(() => {
      FakeEventSource.instances[0]!.emit('error', {})
    })
    expect(result.current.unreachable).toBe(true)
  })

  it('an SSE inbox event updates snapshot AND localStorage', async () => {
    vi.mocked(api.inbox).mockResolvedValue(snapshot())
    const { result } = renderHook(() => useInbox('wc1'))
    await act(async () => {})

    const source = FakeEventSource.instances[0]!
    const pushed = snapshot({ offers: [task()] })
    act(() => {
      source.emit('inbox', pushed)
    })

    expect(result.current.snapshot).toEqual(pushed)
    expect(result.current.stale).toBe(false)
    expect(JSON.parse(localStorage.getItem('pilot:snapshot:wc1')!)).toEqual(pushed)
  })

  it('a 10s tick calls api.inbox again (poll fallback)', async () => {
    vi.mocked(api.inbox).mockResolvedValue(snapshot())
    renderHook(() => useInbox('wc1'))
    await act(async () => {})
    expect(api.inbox).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(api.inbox).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(api.inbox).toHaveBeenCalledTimes(3)
  })

  it('a poll that started before an SSE snapshot is dropped', async () => {
    const s1 = snapshot({ offers: [task({ assignmentId: 'old' })] })
    const s2 = snapshot({ offers: [task({ assignmentId: 'new' })] })
    let resolvePoll!: (v: InboxSnapshot) => void
    vi.mocked(api.inbox).mockReturnValueOnce(new Promise<InboxSnapshot>((r) => { resolvePoll = r }))
    const { result } = renderHook(() => useInbox('wc1'))
    await act(async () => {})

    act(() => {
      FakeEventSource.instances[0]!.emit('inbox', s2)
    })
    expect(result.current.snapshot).toEqual(s2)

    await act(async () => {
      resolvePoll(s1)
    })
    expect(result.current.snapshot).toEqual(s2)
    expect(JSON.parse(localStorage.getItem('pilot:snapshot:wc1')!)).toEqual(s2)
  })

  it('of two overlapping polls only the newer applies', async () => {
    const s1 = snapshot({ offers: [task({ assignmentId: 'first' })] })
    const s2 = snapshot({ offers: [task({ assignmentId: 'second' })] })
    let resolveFirst!: (v: InboxSnapshot) => void
    let resolveSecond!: (v: InboxSnapshot) => void
    vi.mocked(api.inbox)
      .mockReturnValueOnce(new Promise<InboxSnapshot>((r) => { resolveFirst = r }))
      .mockReturnValueOnce(new Promise<InboxSnapshot>((r) => { resolveSecond = r }))
    const { result } = renderHook(() => useInbox('wc1'))
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(api.inbox).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveSecond(s2)
    })
    expect(result.current.snapshot).toEqual(s2)
    await act(async () => {
      resolveFirst(s1)
    })
    expect(result.current.snapshot).toEqual(s2)
    expect(JSON.parse(localStorage.getItem('pilot:snapshot:wc1')!)).toEqual(s2)
  })

  it('slow overlapping polls: the first resolving before the second still applies, then the second', async () => {
    const s1 = snapshot({ offers: [task({ assignmentId: 'first' })] })
    const s2 = snapshot({ offers: [task({ assignmentId: 'second' })] })
    let resolveFirst!: (v: InboxSnapshot) => void
    let resolveSecond!: (v: InboxSnapshot) => void
    vi.mocked(api.inbox)
      .mockReturnValueOnce(new Promise<InboxSnapshot>((r) => { resolveFirst = r }))
      .mockReturnValueOnce(new Promise<InboxSnapshot>((r) => { resolveSecond = r }))
    const { result } = renderHook(() => useInbox('wc1'))
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(api.inbox).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveFirst(s1)
    })
    expect(result.current.snapshot).toEqual(s1)
    await act(async () => {
      resolveSecond(s2)
    })
    expect(result.current.snapshot).toEqual(s2)
  })

  it('a superseded poll failing does not mark the inbox unreachable', async () => {
    const s2 = snapshot({ offers: [task({ assignmentId: 'second' })] })
    let rejectFirst!: (e: unknown) => void
    let resolveSecond!: (v: InboxSnapshot) => void
    vi.mocked(api.inbox)
      .mockReturnValueOnce(new Promise<InboxSnapshot>((_, rej) => { rejectFirst = rej }))
      .mockReturnValueOnce(new Promise<InboxSnapshot>((r) => { resolveSecond = r }))
    const { result } = renderHook(() => useInbox('wc1'))
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    await act(async () => {
      resolveSecond(s2)
    })
    await act(async () => {
      rejectFirst(new Error('late'))
    })
    expect(result.current.unreachable).toBe(false)
    expect(result.current.snapshot).toEqual(s2)
  })

  it('an offline event stops the poll from fetching; an online event resumes it', async () => {
    vi.mocked(api.inbox).mockResolvedValue(snapshot())
    const { result } = renderHook(() => useInbox('wc1'))
    await act(async () => {})
    expect(api.inbox).toHaveBeenCalledTimes(1)

    online = false
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current.offline).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(api.inbox).toHaveBeenCalledTimes(1) // poll tick did NOT fetch while offline

    online = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current.offline).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(api.inbox).toHaveBeenCalledTimes(2) // poll resumed
  })

  it('closes the old EventSource and opens a new one with the new query param when wcId changes', async () => {
    vi.mocked(api.inbox).mockResolvedValue(snapshot())
    const { rerender } = renderHook(({ wcId }: { wcId: string | null }) => useInbox(wcId), {
      initialProps: { wcId: 'wc1' },
    })
    await act(async () => {})
    expect(FakeEventSource.instances).toHaveLength(1)
    const first = FakeEventSource.instances[0]!
    expect(first.url).toBe('/api/events?workCenterId=wc1')
    expect(first.closed).toBe(false)

    rerender({ wcId: 'wc2' })
    await act(async () => {})

    expect(first.closed).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.instances[1]!.url).toBe('/api/events?workCenterId=wc2')
    expect(api.inbox).toHaveBeenCalledWith('wc2')
  })

  it('ignores a corrupted cache entry (parse-guarded) and falls through to the fetched result', async () => {
    localStorage.setItem('pilot:snapshot:wc1', '{not valid json')
    const fresh = snapshot()
    vi.mocked(api.inbox).mockResolvedValue(fresh)

    const { result } = renderHook(() => useInbox('wc1'))
    expect(result.current.snapshot).toBeNull()
    expect(result.current.stale).toBe(true)

    await act(async () => {})
    expect(result.current.snapshot).toEqual(fresh)
    expect(result.current.stale).toBe(false)
  })

  it('clearSnapshotCache removes every pilot:snapshot: key and leaves unrelated keys alone', () => {
    localStorage.setItem('pilot:snapshot:wc1', JSON.stringify(snapshot()))
    localStorage.setItem('pilot:snapshot:wc2', JSON.stringify(snapshot()))
    localStorage.setItem('unrelated:key', 'keep me')

    clearSnapshotCache()

    expect(localStorage.getItem('pilot:snapshot:wc1')).toBeNull()
    expect(localStorage.getItem('pilot:snapshot:wc2')).toBeNull()
    expect(localStorage.getItem('unrelated:key')).toBe('keep me')
  })

  it('closes the EventSource on unmount', async () => {
    vi.mocked(api.inbox).mockResolvedValue(snapshot())
    const { unmount } = renderHook(() => useInbox('wc1'))
    await act(async () => {})
    const source = FakeEventSource.instances[0]!
    expect(source.closed).toBe(false)

    unmount()
    expect(source.closed).toBe(true)
  })

  it('relays the stream\'s theme event to the window, so the site theme refetches (spec §13)', async () => {
    vi.mocked(api.inbox).mockResolvedValue(snapshot())
    const onTheme = vi.fn()
    window.addEventListener('pilot:theme-changed', onTheme)
    renderHook(() => useInbox('wc1'))
    await act(async () => {})
    act(() => {
      FakeEventSource.instances[0]!.emit('theme', { rev: 3 })
    })
    expect(onTheme).toHaveBeenCalledTimes(1)
    window.removeEventListener('pilot:theme-changed', onTheme)
  })

  it('sign-out clears inbox snapshots but keeps the cached themes (spec §13 item 3)', () => {
    localStorage.setItem('pilot:snapshot:wc1', '{}')
    localStorage.setItem('pilot:theme:last', '{}')
    localStorage.setItem('pilot:theme:wc:wc1', '{}')
    clearSnapshotCache()
    expect(localStorage.getItem('pilot:snapshot:wc1')).toBeNull()
    expect(localStorage.getItem('pilot:theme:last')).toBe('{}')
    expect(localStorage.getItem('pilot:theme:wc:wc1')).toBe('{}')
  })
})
