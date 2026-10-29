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
import { downloadAuthed } from './download'
import { clearApiKey, setApiKey } from './apiKey'

const FAKE_KEY = 'test-key-0123456789abcdef0123456789abcdef'

describe('downloadAuthed', () => {
  const fetchMock = vi.fn()
  let saved: string | null

  beforeEach(() => {
    clearApiKey()
    saved = null
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      saved = this.download
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends X-API-Key and saves under the Content-Disposition filename', async () => {
    setApiKey(FAKE_KEY)
    fetchMock.mockResolvedValue(
      new Response('data', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="snap-1.WFsnapshot"' },
      })
    )
    await downloadAuthed('/management/v1/snapshot/export', 'fallback.bin')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('X-API-Key')).toBe(FAKE_KEY)
    expect(saved).toBe('snap-1.WFsnapshot')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
  })

  it('uses the fallback name without a header and throws on failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('data', { status: 200 }))
    await downloadAuthed('/x', 'fallback.bin')
    expect(saved).toBe('fallback.bin')
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 500 })
    )
    await expect(downloadAuthed('/x', 'f')).rejects.toThrow('nope')
  })
})
