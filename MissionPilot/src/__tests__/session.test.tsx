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
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { SessionProvider, useSession } from '../session'
import { api, ApiError } from '../api/client'
import type { Me } from '../api/types'

vi.mock('../api/client', () => {
  class ApiError extends Error {
    status: number
    code?: string
    constructor(status: number, code?: string) {
      super(`HTTP ${status}`)
      this.name = 'ApiError'
      this.status = status
      this.code = code
    }
  }
  return {
    api: { me: vi.fn(), signIn: vi.fn(), logout: vi.fn() },
    ApiError,
  }
})

const mockMe: Me = { id: 'u1', email: 'a@b.com', displayName: 'A B', loginName: 'ab' }

type Captured = ReturnType<typeof useSession>

function Consumer({ onRender }: { onRender: (v: Captured) => void }) {
  const value = useSession()
  onRender(value)
  return null
}

function renderSession() {
  let captured: Captured | undefined
  render(
    <SessionProvider>
      <Consumer onRender={(v) => { captured = v }} />
    </SessionProvider>
  )
  return {
    get current() {
      if (!captured) throw new Error('Consumer never rendered')
      return captured
    },
  }
}

describe('SessionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(cleanup)

  it('resolves api.me() on mount and sets user + ready', async () => {
    vi.mocked(api.me).mockResolvedValue(mockMe)
    const session = renderSession()

    await waitFor(() => expect(session.current.ready).toBe(true))
    expect(session.current.user).toEqual(mockMe)
    expect(api.me).toHaveBeenCalledTimes(1)
  })

  it('rejecting api.me() with a 401 ApiError sets user null, ready true, and does not crash', async () => {
    vi.mocked(api.me).mockRejectedValue(new ApiError(401))
    const session = renderSession()

    await waitFor(() => expect(session.current.ready).toBe(true))
    expect(session.current.user).toBeNull()
  })

  it('clears an existing user when pilot:unauthenticated is dispatched', async () => {
    vi.mocked(api.me).mockResolvedValue(mockMe)
    const session = renderSession()

    await waitFor(() => expect(session.current.user).toEqual(mockMe))

    act(() => {
      window.dispatchEvent(new Event('pilot:unauthenticated'))
    })

    await waitFor(() => expect(session.current.user).toBeNull())
  })

  it('signIn() calls api.signIn then api.me and sets the resolved user', async () => {
    vi.mocked(api.me)
      .mockResolvedValueOnce(null as unknown as Me) // initial mount call: not signed in
      .mockResolvedValueOnce(mockMe) // post-sign-in call
    vi.mocked(api.signIn).mockResolvedValue(undefined)
    const session = renderSession()

    await waitFor(() => expect(session.current.ready).toBe(true))
    expect(session.current.user).toBeNull()

    await act(async () => {
      await session.current.signIn('a@b.com', 'password123')
    })

    expect(api.signIn).toHaveBeenCalledWith('a@b.com', 'password123')
    expect(api.me).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(session.current.user).toEqual(mockMe))
  })

  it('signOut() calls api.logout and clears the user', async () => {
    vi.mocked(api.me).mockResolvedValue(mockMe)
    vi.mocked(api.logout).mockResolvedValue(undefined)
    const session = renderSession()

    await waitFor(() => expect(session.current.user).toEqual(mockMe))

    await act(async () => {
      await session.current.signOut()
    })

    expect(api.logout).toHaveBeenCalledTimes(1)
    expect(session.current.user).toBeNull()
  })

  it('signOut clears the user even when logout rejects', async () => {
    vi.mocked(api.me).mockResolvedValue(mockMe)
    vi.mocked(api.logout).mockRejectedValue(new TypeError('Failed to fetch'))
    localStorage.setItem('pilot:snapshot:wc1', '{"workCenterId":"wc1"}')
    sessionStorage.setItem('pilot:draft:a1', JSON.stringify({ stepInstanceId: 'si1', values: { x: '1' } }))
    const session = renderSession()

    await waitFor(() => expect(session.current.user).toEqual(mockMe))
    await act(async () => {
      await session.current.signOut()
    })

    expect(session.current.user).toBeNull()
    expect(localStorage.getItem('pilot:snapshot:wc1')).toBeNull()
    expect(sessionStorage.getItem('pilot:draft:a1')).toBeNull()
  })

  it('signOut() clears every cached inbox snapshot — a shared terminal must not seed the next operator with this one\'s claims/offers', async () => {
    vi.mocked(api.me).mockResolvedValue(mockMe)
    vi.mocked(api.logout).mockResolvedValue(undefined)
    localStorage.setItem('pilot:snapshot:wc1', '{"workCenterId":"wc1"}')
    localStorage.setItem('pilot:snapshot:wc2', '{"workCenterId":"wc2"}')
    localStorage.setItem('some:other:key', 'unrelated — must survive')
    const session = renderSession()

    await waitFor(() => expect(session.current.user).toEqual(mockMe))

    await act(async () => {
      await session.current.signOut()
    })

    expect(localStorage.getItem('pilot:snapshot:wc1')).toBeNull()
    expect(localStorage.getItem('pilot:snapshot:wc2')).toBeNull()
    expect(localStorage.getItem('some:other:key')).toBe('unrelated — must survive')
  })

  it('a pilot:unauthenticated event clears every cached inbox snapshot', async () => {
    vi.mocked(api.me).mockResolvedValue(mockMe)
    localStorage.setItem('pilot:snapshot:wc1', '{"workCenterId":"wc1"}')
    const session = renderSession()

    await waitFor(() => expect(session.current.user).toEqual(mockMe))

    act(() => {
      window.dispatchEvent(new Event('pilot:unauthenticated'))
    })

    await waitFor(() => expect(session.current.user).toBeNull())
    expect(localStorage.getItem('pilot:snapshot:wc1')).toBeNull()
  })

  it('signOut() clears every saved form draft (spec §5.7: a shared terminal keeps nothing typed)', async () => {
    vi.mocked(api.me).mockResolvedValue(mockMe)
    vi.mocked(api.logout).mockResolvedValue(undefined)
    sessionStorage.setItem('pilot:draft:a1', JSON.stringify({ stepInstanceId: 'si1', values: { x: '1' } }))
    const session = renderSession()

    await waitFor(() => expect(session.current.user).toEqual(mockMe))
    await act(async () => {
      await session.current.signOut()
    })

    expect(sessionStorage.getItem('pilot:draft:a1')).toBeNull()
  })

  it('a pilot:unauthenticated event clears every saved form draft', async () => {
    vi.mocked(api.me).mockResolvedValue(mockMe)
    sessionStorage.setItem('pilot:draft:a1', JSON.stringify({ stepInstanceId: 'si1', values: { x: '1' } }))
    const session = renderSession()

    await waitFor(() => expect(session.current.user).toEqual(mockMe))
    act(() => {
      window.dispatchEvent(new Event('pilot:unauthenticated'))
    })

    await waitFor(() => expect(session.current.user).toBeNull())
    expect(sessionStorage.getItem('pilot:draft:a1')).toBeNull()
  })

  it('signIn() asks /me with a 15 s timeout', async () => {
    vi.mocked(api.me).mockResolvedValueOnce(null as unknown as Me).mockResolvedValueOnce(mockMe)
    vi.mocked(api.signIn).mockResolvedValue(undefined)
    const session = renderSession()
    await waitFor(() => expect(session.current.ready).toBe(true))
    await act(async () => {
      await session.current.signIn('a@b.com', 'password123')
    })
    expect(api.me).toHaveBeenLastCalledWith({ timeoutMs: 15_000 })
  })

  it('a 401 from the post-sign-in /me is reported as SESSION_NOT_KEPT', async () => {
    vi.mocked(api.me).mockResolvedValueOnce(null as unknown as Me).mockRejectedValueOnce(new ApiError(401))
    vi.mocked(api.signIn).mockResolvedValue(undefined)
    const session = renderSession()
    await waitFor(() => expect(session.current.ready).toBe(true))
    let caught: unknown
    await act(async () => {
      await session.current.signIn('a@b.com', 'password123').catch((e) => { caught = e })
    })
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(401)
    expect((caught as ApiError).code).toBe('SESSION_NOT_KEPT')
  })
})
