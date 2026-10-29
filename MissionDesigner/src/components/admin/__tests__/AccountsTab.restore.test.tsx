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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AccountsTab } from '../AccountsTab'
import { toast } from 'sonner'
import * as adminClient from '../../../lib/admin/adminClient'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('../../../lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/admin/adminClient')>()
  return { ...actual, listUsers: vi.fn() }
})

const OLDER =
  'This backup was made by an older Designer. Spec states, version history, images and links are not in it and will be lost.'
const FOREIGN =
  'This backup was not made by this Designer, or it was changed after it was made. Restore it only if you trust where it came from.'

type Inspection = { version: number; signature: 'match' | 'mismatch'; counts: Record<string, number> }

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

function respondWith(inspection: Inspection, restore: unknown = { success: true, counts: {}, warnings: [] }) {
  fetchMock.mockImplementation(async (input) => {
    const body = input.startsWith('/api/backup/inspect') ? inspection : restore
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

async function pickFile() {
  render(<AccountsTab currentUserId="me" />)
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File([new Uint8Array([1, 2, 3])], 'old.bpbackup')
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(screen.getByText('Restore from backup?')).toBeTruthy())
}

beforeEach(() => {
  vi.mocked(adminClient.listUsers).mockResolvedValue([])
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('AccountsTab restore', () => {
  it('inspects the file and warns that an older backup loses data', async () => {
    respondWith({ version: 2, signature: 'match', counts: { user: 3, library: 2, specification: 7 } })
    await pickFile()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/backup/inspect')
    expect(screen.getByText(OLDER)).toBeTruthy()
    expect(screen.queryByText(FOREIGN)).toBeNull()
    expect(screen.getByText('specification')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/backup/restore')
  })

  it('a foreign file needs Restore anyway and a second confirmation, then sends the flag', async () => {
    respondWith({ version: 3, signature: 'mismatch', counts: { specification: 1 } })
    await pickFile()
    expect(screen.getByText(FOREIGN)).toBeTruthy()
    expect(screen.queryByText(OLDER)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Restore anyway' }))
    await waitFor(() => expect(screen.getByText('Are you sure?')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Restore anyway' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/backup/restore?acceptForeignSignature=1')
  })

  it('the result dialog lists the counts per table and every warning', async () => {
    respondWith(
      { version: 3, signature: 'match', counts: { specification: 9 } },
      {
        success: true,
        version: 3,
        counts: { specification: 9, image_blob: 4 },
        warnings: ['library: skipped unknown columns: color', 'Image blobs/h1 does not match its recorded hash'],
      },
    )
    await pickFile()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(screen.getByText('Backup restored')).toBeTruthy())
    expect(screen.getByText('image blob')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText('2 warnings')).toBeTruthy()
    expect(screen.getByText('library: skipped unknown columns: color')).toBeTruthy()
    expect(screen.getByText('Image blobs/h1 does not match its recorded hash')).toBeTruthy()
  })

  it('a plain-text 413 shows a readable message, never a JSON parse error', async () => {
    fetchMock.mockImplementation(async () => new Response('Payload Too Large', { status: 413 }))
    render(<AccountsTab currentUserId="me" />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'big.bpbackup')] } })
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const message = vi.mocked(toast.error).mock.calls[0][0] as string
    expect(message).toContain('413')
    expect(message).toContain('Payload Too Large')
    expect(message).not.toMatch(/JSON|Unexpected token/i)
  })

  it('an HTML 413 shows the generic refusal', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>nope</html>', { status: 413 }))
    render(<AccountsTab currentUserId="me" />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'big.bpbackup')] } })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The server refused the file (HTTP 413).'))
  })

  it('a JSON 413 shows the server message', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: 'backup_too_large', message: 'Too big to restore.' }), { status: 413 }),
    )
    render(<AccountsTab currentUserId="me" />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'big.bpbackup')] } })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Too big to restore.'))
  })
})
