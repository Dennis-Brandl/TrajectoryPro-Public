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
import { ApiError } from './types'
import type { Connection, Instance } from './types'
import { fetchInstance } from './instances'

const baseConnection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-13T00:00:00Z',
}

const sampleInstance: Instance = {
  instance_id: 'inst-1',
  action_oid: 'act-1',
  environment_oid: 'env-1',
  workflow_instance_id: 'wf-1',
  step_instance_id: 'step-1',
  step_oid: 'step-oid-1',
  visibility: 'observable',
  state: { current: 'EXECUTING', previous: 'STARTING', entered_at: '2026-05-13T00:00:01Z' },
  inputs: [{ key: 'item_sku', value: 'SKU-1001' }],
  outputs: [],
  created_at: '2026-05-13T00:00:00Z',
  started_at: '2026-05-13T00:00:00Z',
  completed_at: null,
  error: null,
}

describe('fetchInstance', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('GETs {url}/trajectory/v1/instances/{id} with Accept JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: sampleInstance, meta: {} }), { status: 200 })
    )
    await fetchInstance(baseConnection, 'inst-1')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/instances/inst-1',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) })
    )
  })

  it('strips trailing slashes from the connection URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: sampleInstance, meta: {} }), { status: 200 })
    )
    await fetchInstance({ ...baseConnection, url: 'http://localhost:3000///' }, 'inst-1')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/instances/inst-1',
      expect.anything()
    )
  })

  it('adds Authorization: Bearer when apiKey is present', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: sampleInstance, meta: {} }), { status: 200 })
    )
    await fetchInstance({ ...baseConnection, apiKey: 'sek' }, 'inst-1')
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sek' }),
      })
    )
  })

  it('returns the parsed Instance on 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: sampleInstance, meta: {} }), { status: 200 })
    )
    const result = await fetchInstance(baseConnection, 'inst-1')
    expect(result).toEqual(sampleInstance)
  })

  it('throws ApiError(404) when the instance does not exist', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'INSTANCE_NOT_FOUND', message: 'gone' } }),
        { status: 404, statusText: 'Not Found' }
      )
    )
    try {
      await fetchInstance(baseConnection, 'gone')
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(404)
    }
  })

  it('throws ApiError on 5xx', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }))
    await expect(fetchInstance(baseConnection, 'inst-1')).rejects.toBeInstanceOf(ApiError)
  })
})
