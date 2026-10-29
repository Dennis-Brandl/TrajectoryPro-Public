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
import { resolveTheme, themePayload } from 'mission-control-db/src/dao/pilot-theme'
import { useSiteTheme, fetchTheme, THEME_LAST_KEY, THEME_CHANGED_EVENT, themeWcKey } from '../site-theme'

const v1 = { ...themePayload(1, resolveTheme([{ schema: 1, appTitle: 'Acme' }])), etag: '"1-aaaaaaaaaaaaaaaa"' }
const v2 = { ...themePayload(2, resolveTheme([{ schema: 1, appTitle: 'Acme 2', colors: { light: { brand: '#7c3aed' } } }])), etag: '"2-bbbbbbbbbbbbbbbb"' }

function respond(status: number, body?: unknown) {
  return { status, ok: status >= 200 && status < 300, text: async () => (body === undefined ? '' : JSON.stringify(body)) }
}

const fetchMock = vi.fn()

beforeEach(() => {
  localStorage.clear()
  document.getElementById('pilot-theme')?.remove()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('fetchTheme (spec §13)', () => {
  it('sends the cached payload ETag as If-None-Match and maps 304 to unchanged', async () => {
    fetchMock.mockResolvedValue(respond(304))
    expect(await fetchTheme(null, '"3-0123456789abcdef"')).toEqual({ status: 'unchanged' })
    expect(fetchMock).toHaveBeenCalledWith('/api/theme', { credentials: 'same-origin', headers: { 'if-none-match': '"3-0123456789abcdef"' } })
  })

  it('asks for a work center by query parameter, without a validator when nothing is cached', async () => {
    fetchMock.mockResolvedValue(respond(200, v1))
    expect(await fetchTheme('wc 1', null)).toEqual({ status: 'fresh', payload: v1 })
    expect(fetchMock).toHaveBeenCalledWith('/api/theme?workCenterId=wc%201', { credentials: 'same-origin', headers: {} })
  })

  it('a network error, an error status or a foreign body is a failure, never a throw', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await fetchTheme(null, null)).toEqual({ status: 'failed' })
    fetchMock.mockResolvedValueOnce(respond(500, { error: 'x' }))
    expect(await fetchTheme(null, null)).toEqual({ status: 'failed' })
    fetchMock.mockResolvedValueOnce(respond(200, { css: 'body{}' }))
    expect(await fetchTheme(null, null)).toEqual({ status: 'failed' })
  })
})

describe('useSiteTheme', () => {
  it('shows the cached theme at once, then the fresh one, and caches it under both keys', async () => {
    localStorage.setItem(THEME_LAST_KEY, JSON.stringify(v1))
    fetchMock.mockResolvedValue(respond(200, v2))
    const { result } = renderHook(() => useSiteTheme(null))
    expect(result.current?.rev).toBe(1)
    await act(async () => {})
    expect(result.current?.rev).toBe(2)
    expect(document.getElementById('pilot-theme')?.textContent).toBe(v2.css)
    expect(JSON.parse(localStorage.getItem(THEME_LAST_KEY)!).rev).toBe(2)
  })

  it('a cached payload without an ETag (an older engine) refetches unconditionally', async () => {
    const { etag: _drop, ...old } = v1
    localStorage.setItem(THEME_LAST_KEY, JSON.stringify(old))
    fetchMock.mockResolvedValue(respond(200, v2))
    renderHook(() => useSiteTheme(null))
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalledWith('/api/theme', { credentials: 'same-origin', headers: {} })
  })

  it('keeps the cached theme when the engine is unreachable', async () => {
    localStorage.setItem(THEME_LAST_KEY, JSON.stringify(v1))
    fetchMock.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useSiteTheme(null))
    await act(async () => {})
    expect(result.current?.rev).toBe(1)
    expect(document.getElementById('pilot-theme')?.textContent).toBe(v1.css)
  })

  it('a work center uses its own cache key and query, and writes the last-theme key too', async () => {
    localStorage.setItem(themeWcKey('wc1'), JSON.stringify(v1))
    fetchMock.mockResolvedValue(respond(200, v2))
    renderHook(() => useSiteTheme('wc1'))
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalledWith('/api/theme?workCenterId=wc1', { credentials: 'same-origin', headers: { 'if-none-match': v1.etag } })
    expect(JSON.parse(localStorage.getItem(themeWcKey('wc1'))!).rev).toBe(2)
    expect(JSON.parse(localStorage.getItem(THEME_LAST_KEY)!).rev).toBe(2)
  })

  it('refetches on every theme-changed event (the SSE `theme` event)', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, v1)).mockResolvedValueOnce(respond(200, v2))
    const { result } = renderHook(() => useSiteTheme(null))
    await act(async () => {})
    expect(result.current?.rev).toBe(1)
    await act(async () => {
      window.dispatchEvent(new Event(THEME_CHANGED_EVENT))
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![1]).toEqual({ credentials: 'same-origin', headers: { 'if-none-match': v1.etag } })
    expect(result.current?.rev).toBe(2)
  })
})
