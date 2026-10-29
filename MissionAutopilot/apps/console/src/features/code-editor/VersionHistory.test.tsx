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
import { render, screen } from '@testing-library/react'
import VersionHistory from './VersionHistory'
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

describe('VersionHistory', () => {
  it('lists versions with Activate/Delete on non-active rows by default', () => {
    render(
      <VersionHistory
        actionOid="a1"
        state="EXECUTING"
        activeVersionId={null}
        onSelectVersion={vi.fn()}
      />
    )
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getByText('v1')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  })

  it('hides Activate/Delete entirely in readOnly mode', () => {
    render(
      <VersionHistory
        actionOid="a1"
        state="EXECUTING"
        activeVersionId={null}
        onSelectVersion={vi.fn()}
        readOnly
      />
    )
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getByText('v1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})
