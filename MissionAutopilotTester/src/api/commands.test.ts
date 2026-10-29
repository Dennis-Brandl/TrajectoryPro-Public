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
import { sendCommand } from './commands'
import { ApiError } from './types'
import type { Connection } from './types'

const connection: Connection = {
  id: 'conn-1',
  url: 'http://localhost:3000',
  createdAt: '2026-05-14T00:00:00Z',
}

const connectionWithKey: Connection = {
  ...connection,
  apiKey: 'secret-key-123',
}

describe('sendCommand', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs to {url}/trajectory/v1/instances/{id}/command with JSON body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )
    await sendCommand(connection, 'inst-1', 'PAUSE')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/instances/inst-1/command',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
        body: JSON.stringify({ command: 'PAUSE' }),
      })
    )
  })

  it('strips trailing slashes from the connection URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'STOP', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )
    await sendCommand({ ...connection, url: 'http://localhost:3000///' }, 'inst-1', 'STOP')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/trajectory/v1/instances/inst-1/command',
      expect.anything()
    )
  })

  it('attaches Authorization header when apiKey is present', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'ABORT', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )
    await sendCommand(connectionWithKey, 'inst-1', 'ABORT')
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-key-123',
        }),
      })
    )
  })

  it('returns the data payload on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { instance_id: 'inst-1', command: 'PAUSE', accepted: true },
          meta: {},
        }),
        { status: 200 }
      )
    )
    const result = await sendCommand(connection, 'inst-1', 'PAUSE')
    expect(result).toEqual({ instance_id: 'inst-1', command: 'PAUSE', accepted: true })
  })

  it('throws ApiError on 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'INSTANCE_NOT_FOUND' } }), {
        status: 404,
        statusText: 'Not Found',
      })
    )
    await expect(sendCommand(connection, 'gone', 'PAUSE')).rejects.toBeInstanceOf(ApiError)
  })

  it('throws ApiError on 422 invalid command', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'INVALID_COMMAND' } }), {
        status: 422,
        statusText: 'Unprocessable Entity',
      })
    )
    await expect(
      sendCommand(connection, 'inst-1', 'PAUSE')
    ).rejects.toMatchObject({ status: 422 })
  })
})
