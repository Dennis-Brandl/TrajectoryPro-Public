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
import { fetchCapabilities } from './capabilities'
import type { Connection } from './types'

const baseConnection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-13T00:00:00Z',
}

describe('fetchCapabilities', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('hits {url}/trajectory/v1/capabilities with Accept JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { environments: [] }, meta: { total_environments: 0, total_actions: 0 } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )
    await fetchCapabilities(baseConnection)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/capabilities',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) })
    )
  })

  it('strips a trailing slash from the connection URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { environments: [] }, meta: { total_environments: 0, total_actions: 0 } }),
        { status: 200 }
      )
    )
    await fetchCapabilities({ ...baseConnection, url: 'http://localhost:3000/' })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/capabilities',
      expect.anything()
    )
  })

  it('adds Authorization: Bearer when apiKey is present', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { environments: [] }, meta: { total_environments: 0, total_actions: 0 } }),
        { status: 200 }
      )
    )
    await fetchCapabilities({ ...baseConnection, apiKey: 'secret-token' })
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
      })
    )
  })

  it('returns the parsed body on 200', async () => {
    const body = {
      data: {
        environments: [
          {
            environment_oid: 'env-1',
            environment_name: 'Warehouse',
            environment_state: 'Effective',
            action_properties: [],
            actions: [
              {
                action_oid: 'act-1',
                action_name: 'PickItem',
                action_state: 'Effective',
                local_id: 'PickItem',
                version: '1.0.0',
                visibility: 'observable',
                input_parameters: [],
                output_parameters: [],
                supported_commands: ['PAUSE'],
              },
            ],
          },
        ],
      },
      meta: { total_environments: 1, total_actions: 1 },
    }
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    )
    const result = await fetchCapabilities(baseConnection)
    expect(result).toEqual(body)
  })

  it('throws ApiError on non-2xx', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    )
    await expect(fetchCapabilities(baseConnection)).rejects.toBeInstanceOf(ApiError)
  })

  it('exposes status, statusText, and body on ApiError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('not found body', { status: 404, statusText: 'Not Found' })
    )
    try {
      await fetchCapabilities(baseConnection)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(404)
      expect(apiErr.statusText).toBe('Not Found')
      expect(apiErr.body).toContain('not found body')
    }
  })
})
