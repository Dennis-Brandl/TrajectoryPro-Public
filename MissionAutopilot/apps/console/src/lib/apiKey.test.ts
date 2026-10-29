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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authedFetch, clearApiKey, getApiKey, setApiKey } from './apiKey'

const FAKE_KEY = 'test-key-0123456789abcdef0123456789abcdef'

describe('authedFetch', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    clearApiKey()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends X-API-Key once a key is set', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    setApiKey(FAKE_KEY)
    await authedFetch('/management/v1/settings')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('X-API-Key')).toBe(FAKE_KEY)
  })

  it('sends no key header when none is set', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await authedFetch('/management/v1/settings')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).has('X-API-Key')).toBe(false)
  })

  it('on 401 clears the key and fires autopilot:unauthorized', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    setApiKey(FAKE_KEY)
    const handler = vi.fn()
    window.addEventListener('autopilot:unauthorized', handler)
    const res = await authedFetch('/management/v1/settings')
    window.removeEventListener('autopilot:unauthorized', handler)
    expect(res.status).toBe(401)
    expect(getApiKey()).toBeNull()
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
