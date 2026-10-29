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


import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EnvirXUploader } from './EnvirXUploader'

function pickFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['{}'], 'env.WFenvirX')
  fireEvent.change(input, { target: { files: [file] } })
}

describe('EnvirXUploader', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the connection key as a Bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<EnvirXUploader serverUri="http://x:3002/" apiKey="k-123" onUploaded={() => {}} />)
    pickFile()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://x:3002/management/v1/upload')
    expect(init.headers).toEqual({ Authorization: 'Bearer k-123' })
    await screen.findByRole('status')
  })

  it('sends no Authorization header when no key is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<EnvirXUploader serverUri="http://x:3002" onUploaded={() => {}} />)
    pickFile()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined()
  })
})
