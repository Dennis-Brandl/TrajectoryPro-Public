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

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { api, ApiError } from '../apiClient'
import { encodeExportWarnings } from '@/lib/packageFormat/export-warnings-header'

const mockFetch = vi.fn()
beforeEach(() => {
  mockFetch.mockReset()
  global.fetch = mockFetch as unknown as typeof fetch
})

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('apiClient', () => {
  it('GET /api/v2/me returns parsed body', async () => {
    mockFetch.mockResolvedValue(jsonRes({ userId: 'u1', isAdministrator: false }))
    const result = await api.getMe()
    expect(result.userId).toBe('u1')
    expect(mockFetch).toHaveBeenCalledWith('/api/v2/me', expect.objectContaining({ credentials: 'include' }))
  })

  it('GET /api/v2/libraries returns { libraries: [...] }', async () => {
    mockFetch.mockResolvedValue(jsonRes({ libraries: [{ id: 'l1', name: 'L' }] }))
    const result = await api.listLibraries()
    expect(result.libraries).toHaveLength(1)
  })

  it('throws ApiError with code on 4xx', async () => {
    mockFetch.mockResolvedValue(jsonRes({ code: 'not_found' }, 404))
    try {
      await api.getSpec('nope')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('not_found')
      expect((err as ApiError).status).toBe(404)
    }
  })

  it('throws ApiError with unknown code on non-JSON bodies', async () => {
    mockFetch.mockResolvedValue(new Response('not json', { status: 500 }))
    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError)
  })

  it('POST /api/v2/specifications/batch-save sends JSON body', async () => {
    mockFetch.mockResolvedValue(jsonRes({ specs: [], libraries: [] }))
    await api.batchSave({
      specs: [],
      proxyRefs: [],
      specEnvs: [],
      imageDeletes: [],
      imageRefs: [],
    })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v2/specifications/batch-save',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('apiClient.exportWorkflow (GATE follow-up item 5)', () => {
  const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])

  it('returns the ZIP blob and the warnings decoded from x-export-warnings', async () => {
    mockFetch.mockResolvedValue(
      new Response(zipBytes, {
        status: 200,
        headers: { 'content-type': 'application/zip', 'x-export-warnings': encodeExportWarnings(['w1', 'w2'])! },
      }),
    )
    const result = await api.exportWorkflow('root-1')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v2/packages/workflow/root-1',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(result.warnings).toEqual(['w1', 'w2'])
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(zipBytes)
  })

  it('returns an empty warnings list when the header is absent', async () => {
    mockFetch.mockResolvedValue(new Response(zipBytes, { status: 200, headers: { 'content-type': 'application/zip' } }))
    const result = await api.exportWorkflow('root-1')
    expect(result.warnings).toEqual([])
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(zipBytes)
  })
})
