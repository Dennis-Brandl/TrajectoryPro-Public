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

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FindingRow } from '../FindingRow'
import type { Finding } from '../../../../server/admin/cleanup/types'

const d1: Finding = {
  id: 'f1',
  driftType: 'D1',
  libraryId: 'lib',
  libraryName: 'L',
  userEmail: 'u@x.com',
  orphanSpecId: 'C',
  orphanSpecName: 'Draft',
  dbParentId: 'P',
  descendantCount: 3,
}

const d5: Finding = {
  id: 'f2',
  driftType: 'D5',
  libraryId: 'lib',
  libraryName: 'L',
  userEmail: 'u@x.com',
  parentSpecId: 'P',
  nodeId: 'n1',
  missingTargetId: 'GONE',
}

describe('FindingRow', () => {
  it('renders a D1 finding with descendant count and calls onToggle', () => {
    const onToggle = vi.fn()
    render(<FindingRow finding={d1} checked={false} onToggle={onToggle} />)
    expect(screen.getByText(/Draft/)).toBeTruthy()
    expect(screen.getByText(/\+3 descendants/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith('f1', true)
  })

  it('renders a D5 finding with no checkbox and a report-only marker', () => {
    render(<FindingRow finding={d5} checked={false} onToggle={() => {}} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText(/Cannot auto-fix/i)).toBeTruthy()
  })
})
