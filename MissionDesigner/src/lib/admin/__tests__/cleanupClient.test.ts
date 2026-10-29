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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { applyCleanupFindings, fetchCleanupScanReport } from '../cleanupClient'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('fetchCleanupScanReport', () => {
  it('returns the cached report on 200', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ scanId: 'x', findings: [] }), { status: 200 }))
    const r = await fetchCleanupScanReport('x')
    expect(r?.scanId).toBe('x')
  })
  it('returns null on 404', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }))
    expect(await fetchCleanupScanReport('x')).toBeNull()
  })
})

describe('applyCleanupFindings', () => {
  it('POSTs scanId + findingIds and returns the body', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ applied: 1, skipped: 0, failed: 0, results: [] }), { status: 200 }),
    )
    const r = await applyCleanupFindings('sid', ['a', 'b'])
    expect(r.applied).toBe(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/cleanup/apply')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ scanId: 'sid', findingIds: ['a', 'b'] })
  })
})
