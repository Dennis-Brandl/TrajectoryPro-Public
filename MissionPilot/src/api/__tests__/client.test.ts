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
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { api, ApiError } from '../client'

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.clearAllMocks()
  })

  it('inbox() GETs /api/inbox?workCenterId=wc1 with credentials and returns parsed JSON', async () => {
    const mockData = {
      workCenterId: 'wc1',
      offers: [],
      myClaims: [],
    }

    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockData,
      text: async () => JSON.stringify(mockData),
    })

    const result = await api.inbox('wc1')

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox?workCenterId=wc1', {
      credentials: 'same-origin',
      headers: undefined,
    })
    expect(result).toEqual(mockData)
  })

  it('401 response dispatches pilot:unauthenticated and rejects with ApiError{status:401}', async () => {
    fetchMock.mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({}),
      text: async () => '',
    })

    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

    await expect(api.inbox('wc1')).rejects.toThrow(
      expect.objectContaining({
        name: 'ApiError',
        status: 401,
      })
    )

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pilot:unauthenticated',
      })
    )

    dispatchEventSpy.mockRestore()
  })

  it('409 rejects with ApiError{status:409, code} and does NOT dispatch unauthenticated', async () => {
    fetchMock.mockResolvedValue({
      status: 409,
      ok: false,
      json: async () => ({ code: 'NOT_RUNNING', error: 'Engine not running' }),
      text: async () => '{"code":"NOT_RUNNING","error":"Engine not running"}',
    })

    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

    await expect(api.inbox('wc1')).rejects.toThrow(
      expect.objectContaining({
        name: 'ApiError',
        status: 409,
        code: 'NOT_RUNNING',
      })
    )

    expect(dispatchEventSpy).not.toHaveBeenCalled()

    dispatchEventSpy.mockRestore()
  })

  it('submit() posts the body verbatim', async () => {
    const body = { kind: 'decision' as const, value: 'yes' as const, values: { a: 'b' } }

    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({}),
      text: async () => '',
    })

    await api.submit('assign1', body)

    expect(fetchMock).toHaveBeenCalledWith('/api/assignments/assign1/submit', {
      credentials: 'same-origin',
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  })

  it('signIn() posts to /api/auth/sign-in/email with email and password', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({}),
      text: async () => '',
    })

    await api.signIn('user@example.com', 'password123')

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-in/email', {
      credentials: 'same-origin',
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
      headers: { 'content-type': 'application/json' },
      signal: expect.any(AbortSignal),
    })
  })

  it('logout() posts to /api/logout', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({}),
      text: async () => '',
    })

    await api.logout()

    expect(fetchMock).toHaveBeenCalledWith('/api/logout', {
      credentials: 'same-origin',
      method: 'POST',
      body: undefined,
      headers: undefined,
      signal: expect.any(AbortSignal),
    })
  })

  it("heartbeat('away') posts {status:'away'}; heartbeat() posts {}", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({}),
      text: async () => '',
    })

    await api.heartbeat('away')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/presence/heartbeat', {
      credentials: 'same-origin',
      method: 'POST',
      body: JSON.stringify({ status: 'away' }),
      headers: { 'content-type': 'application/json' },
    })

    vi.clearAllMocks()

    await api.heartbeat()

    expect(fetchMock).toHaveBeenCalledWith('/api/presence/heartbeat', {
      credentials: 'same-origin',
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    })
  })

  it('leavePresence(wcId) DELETEs with the work center id; leavePresence() sends none', async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true, json: async () => ({}), text: async () => '' })

    await api.leavePresence('wc 1')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/presence?workCenterId=wc%201', expect.objectContaining({ method: 'DELETE' }))

    await api.leavePresence()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/presence', expect.objectContaining({ method: 'DELETE' }))
  })

  it('runtimeWorkflows/runtimeDiagram/runtimeLiveStates GET the diagram routes', async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true, json: async () => [], text: async () => '[]' })
    await api.runtimeWorkflows('wc1')
    expect(fetchMock).toHaveBeenCalledWith('/api/work-centers/wc1/runtime-workflows', {
      credentials: 'same-origin', headers: undefined,
    })
    await api.runtimeDiagram('i1')
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime-workflows/i1/diagram', {
      credentials: 'same-origin', headers: undefined,
    })
    await api.runtimeLiveStates('i1')
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime-workflows/i1/live-states', {
      credentials: 'same-origin', headers: undefined,
    })
  })
  it('signIn aborts after 15 s', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      )
      const outcome = api.signIn('a@b.com', 'pw').then(
        () => null,
        (e: unknown) => e,
      )
      await vi.advanceTimersByTimeAsync(15_000)
      const err = await outcome
      expect(err).toBeTruthy()
      expect(err).not.toBeInstanceOf(ApiError)
      expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
    } finally {
      vi.useRealTimers()
    }
  })

  it('me({ timeoutMs }) aborts the fetch after that long; plain me() has no signal', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation(
        (_p: string, init: RequestInit) =>
          new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted')))),
      )
      const p = api.me({ timeoutMs: 15_000 })
      const assertion = expect(p).rejects.toThrow('aborted')
      await vi.advanceTimersByTimeAsync(15_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
    fetchMock.mockResolvedValue({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) })
    await api.me()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/me', { credentials: 'same-origin', headers: undefined })
  })
})
