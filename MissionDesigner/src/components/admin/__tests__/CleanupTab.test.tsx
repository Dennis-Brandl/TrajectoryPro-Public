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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CleanupTab } from '../CleanupTab'
import * as client from '../../../lib/admin/cleanupClient'

vi.mock('../../../lib/admin/cleanupClient')

beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('CleanupTab', () => {
  it('renders idle state with a Run Cleanup Scan button', () => {
    render(<CleanupTab />)
    expect(screen.getByRole('button', { name: /run cleanup scan/i })).toBeTruthy()
  })

  it('transitions idle → scanning → results when scan completes', async () => {
    vi.mocked(client.streamCleanupScan).mockImplementation((onEvent) => {
      onEvent({ type: 'start', totalLibraries: 1, totalSpecs: 1 })
      onEvent({
        type: 'progress',
        librariesDone: 1,
        librariesTotal: 1,
        specsDone: 1,
        specsTotal: 1,
        currentLibraryName: 'L',
        currentUserEmail: 'u@x.com',
      })
      onEvent({
        type: 'result',
        scanId: 'sid',
        findings: [
          {
            id: 'f1',
            driftType: 'D3',
            libraryId: 'lib',
            libraryName: 'L',
            userEmail: 'u@x.com',
            parentSpecId: 'P',
            nodeId: 'n1',
            targetSpecId: 'T',
          },
        ],
        summary: { byType: { D1: 0, D2: 0, D3: 1, D4: 0, D5: 0, D6: 0 }, totalReportOnly: 0 },
      })
      return { close: () => {} }
    })

    render(<CleanupTab />)
    fireEvent.click(screen.getByRole('button', { name: /run cleanup scan/i }))
    await waitFor(() => expect(screen.getByText(/1 total/i)).toBeTruthy())
    expect(screen.getByText(/Stale proxy_reference/i)).toBeTruthy()
  })

  it('shows destructive dialog before applying D1 finding', async () => {
    vi.mocked(client.streamCleanupScan).mockImplementation((onEvent) => {
      onEvent({ type: 'start', totalLibraries: 1, totalSpecs: 1 })
      onEvent({
        type: 'result',
        scanId: 'sid',
        findings: [
          {
            id: 'f1',
            driftType: 'D1',
            libraryId: 'lib',
            libraryName: 'L',
            userEmail: 'u@x.com',
            orphanSpecId: 'C',
            orphanSpecName: 'Draft',
            dbParentId: 'P',
            descendantCount: 2,
          },
        ],
        summary: { byType: { D1: 1, D2: 0, D3: 0, D4: 0, D5: 0, D6: 0 }, totalReportOnly: 0 },
      })
      return { close: () => {} }
    })

    render(<CleanupTab />)
    fireEvent.click(screen.getByRole('button', { name: /run cleanup scan/i }))
    await waitFor(() => expect(screen.getByText(/Draft/)).toBeTruthy())

    // D1 is unchecked by default — admin must tick then click apply
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /apply selected fixes/i }))

    await waitFor(() => expect(screen.getByText(/confirm destructive changes/i)).toBeTruthy())
    expect(screen.getByText(/orphan workflow/i)).toBeTruthy()
    expect(screen.getByText(/cascading to/i)).toBeTruthy()
  })

  const seedTwoFindings = () => {
    vi.mocked(client.streamCleanupScan).mockImplementation((onEvent) => {
      onEvent({ type: 'start', totalLibraries: 1, totalSpecs: 2 })
      onEvent({
        type: 'result',
        scanId: 'sid',
        findings: [
          {
            id: 'f-d3',
            driftType: 'D3',
            libraryId: 'lib',
            libraryName: 'L',
            userEmail: 'u@x.com',
            parentSpecId: 'P',
            nodeId: 'n1',
            targetSpecId: 'T',
          },
          {
            id: 'f-d1',
            driftType: 'D1',
            libraryId: 'lib',
            libraryName: 'L',
            userEmail: 'u@x.com',
            orphanSpecId: 'C',
            orphanSpecName: 'Draft',
            dbParentId: 'P',
            descendantCount: 0,
          },
        ],
        summary: { byType: { D1: 1, D2: 0, D3: 1, D4: 0, D5: 0, D6: 0 }, totalReportOnly: 0 },
      })
      return { close: () => {} }
    })
  }

  it('filter chip D1 hides non-D1 findings', async () => {
    seedTwoFindings()
    render(<CleanupTab />)
    fireEvent.click(screen.getByRole('button', { name: /run cleanup scan/i }))
    await waitFor(() => expect(screen.getByText(/Draft/)).toBeTruthy())
    // Both findings visible
    expect(screen.getByText(/Stale proxy_reference/i)).toBeTruthy()
    // Click D1 filter chip
    fireEvent.click(screen.getByRole('button', { name: /filter D1/i }))
    expect(screen.queryByText(/Stale proxy_reference/i)).toBeNull()
    expect(screen.getByText(/Orphan embedded child/i)).toBeTruthy()
  })

  it('library header collapses and expands the group', async () => {
    seedTwoFindings()
    render(<CleanupTab />)
    fireEvent.click(screen.getByRole('button', { name: /run cleanup scan/i }))
    await waitFor(() => expect(screen.getByText(/Draft/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /toggle library L/i }))
    expect(screen.queryByText(/Draft/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /toggle library L/i }))
    expect(screen.getByText(/Draft/)).toBeTruthy()
  })

  it('"Select all safe" selects D3/D4 only', async () => {
    seedTwoFindings()
    render(<CleanupTab />)
    fireEvent.click(screen.getByRole('button', { name: /run cleanup scan/i }))
    await waitFor(() => expect(screen.getByText(/Draft/)).toBeTruthy())
    // Uncheck everything first (D3 was pre-selected by Task 16 default)
    const d3Checkbox = screen.getByLabelText(/Apply f-d3/)
    if ((d3Checkbox as HTMLInputElement).checked) fireEvent.click(d3Checkbox)
    expect((d3Checkbox as HTMLInputElement).checked).toBe(false)
    // Click select-all-safe
    fireEvent.click(screen.getByRole('button', { name: /select all safe/i }))
    expect((d3Checkbox as HTMLInputElement).checked).toBe(true)
    // D1 should not have been auto-selected
    const d1Checkbox = screen.getByLabelText(/Apply f-d1/)
    expect((d1Checkbox as HTMLInputElement).checked).toBe(false)
  })
})
