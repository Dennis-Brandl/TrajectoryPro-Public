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

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StateHistorySheet from './StateHistorySheet'
import type { CodeVersionSummary } from '@/lib/types'

const versions: CodeVersionSummary[] = [
  {
    id: 'v2-id',
    version_number: 2,
    is_active: true,
    created_at: '2026-08-20T10:00:00.000Z',
    description: 'second try',
  },
  {
    id: 'v1-id',
    version_number: 1,
    is_active: false,
    created_at: '2026-08-19T10:00:00.000Z',
    description: null,
  },
]

vi.mock('./hooks', () => ({
  useCodeVersions: () => ({ data: { versions }, isLoading: false, isError: false }),
  useActivateVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteVersion: () => ({ mutate: vi.fn(), isPending: false }),
}))

const codeVersionMock = vi.fn().mockResolvedValue({
  id: 'v1-id',
  action_oid: 'a1',
  state: 'EXECUTING',
  version_number: 1,
  is_active: false,
  source_code: 'print("hello v1")',
  created_at: '2026-08-19T10:00:00.000Z',
  description: null,
})

vi.mock('@/lib/api', () => ({
  api: {
    codeVersion: (...args: unknown[]) => codeVersionMock(...args),
  },
}))

describe('StateHistorySheet', () => {
  it('renders nothing when state is null', () => {
    render(<StateHistorySheet actionOid="a1" state={null} onClose={vi.fn()} />)
    expect(screen.queryByText('Version History')).toBeNull()
  })

  it('lists versions for the state without Activate/Delete controls', () => {
    render(<StateHistorySheet actionOid="a1" state="EXECUTING" onClose={vi.fn()} />)
    expect(screen.getByText(/Version History/)).toBeTruthy()
    expect(screen.getByText(/EXECUTING/)).toBeTruthy()
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getByText('v1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('shows a version source read-only when its row is clicked', async () => {
    render(<StateHistorySheet actionOid="a1" state="EXECUTING" onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('v1'))
    await waitFor(() => {
      expect(screen.getByText('print("hello v1")')).toBeTruthy()
    })
    expect(codeVersionMock).toHaveBeenCalledWith('a1', 'EXECUTING', 'v1-id')
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
