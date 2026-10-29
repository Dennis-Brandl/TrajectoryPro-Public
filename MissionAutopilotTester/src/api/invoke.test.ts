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
import type { Connection, InvokeRequestBody } from './types'
import { invokeAction } from './invoke'

const baseConnection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-13T00:00:00Z',
}

const baseBody: InvokeRequestBody = {
  environment_oid: 'env-1',
  workflow_instance_id: 'wf-1',
  step_instance_id: 'step-1',
  step_oid: 'step-oid-1',
  input_parameters: [{ name: 'item_sku', value: 'SKU-1001' }],
}

describe('invokeAction', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs to {url}/trajectory/v1/actions/{oid}/invoke with JSON body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-1' }, meta: {} }), {
        status: 201,
      })
    )
    await invokeAction(baseConnection, 'act-1', baseBody)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/actions/act-1/invoke',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
        body: JSON.stringify(baseBody),
      })
    )
  })

  it('strips trailing slashes from the connection URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-1' }, meta: {} }), {
        status: 201,
      })
    )
    await invokeAction({ ...baseConnection, url: 'http://localhost:3000/' }, 'act-1', baseBody)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/actions/act-1/invoke',
      expect.anything()
    )
  })

  it('adds Authorization: Bearer when apiKey is present', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-1' }, meta: {} }), {
        status: 201,
      })
    )
    await invokeAction({ ...baseConnection, apiKey: 'sek' }, 'act-1', baseBody)
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sek' }),
      })
    )
  })

  it('returns the parsed { instance_id } on 201', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { instance_id: 'inst-42' }, meta: {} }), {
        status: 201,
      })
    )
    const result = await invokeAction(baseConnection, 'act-1', baseBody)
    expect(result).toEqual({ instance_id: 'inst-42' })
  })

  it('throws ApiError on non-2xx with status, statusText, body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('bad params', { status: 400, statusText: 'Bad Request' })
    )
    try {
      await invokeAction(baseConnection, 'act-1', baseBody)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(400)
      expect(apiErr.statusText).toBe('Bad Request')
      expect(apiErr.body).toContain('bad params')
    }
  })
})
