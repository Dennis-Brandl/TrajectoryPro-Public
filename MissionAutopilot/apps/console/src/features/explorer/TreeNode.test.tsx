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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EnvironmentNode } from './TreeNode'

const deleteMutateAsync = vi.fn().mockResolvedValue({})
const exportRun = vi.fn().mockResolvedValue(undefined)
const envirXRun = vi.fn().mockResolvedValue(undefined)
const reportRun = vi.fn().mockResolvedValue(undefined)

vi.mock('@/features/environments/hooks', () => ({
  useDeleteEnvironment: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
  useExportEnvironment: () => ({ run: exportRun, isPending: false, error: null }),
  useExportEnvironmentEnvirX: () => ({ run: envirXRun, isPending: false, error: null }),
  useGenerateEnvironmentReport: () => ({ run: reportRun, isPending: false, error: null }),
}))

// Mock @mission/ui DropdownMenu primitives to avoid cross-repo React
// instance conflicts (the package is symlinked from MissionDesigner which
// has its own node_modules/react, causing "Invalid hook call" in tests).
// Note: this mock always renders DropdownMenuContent's children, so the
// "opens menu" assertion verifies item presence after render, not the
// click-to-open semantic.
vi.mock('@mission/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mission/ui')>()
  return {
    ...original,
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-menu' }, children),
    DropdownMenuTrigger: ({
      children,
      asChild,
    }: {
      children: React.ReactNode
      asChild?: boolean
    }) =>
      asChild
        ? React.cloneElement(children as React.ReactElement)
        : React.createElement('div', null, children),
    DropdownMenuContent: ({
      children,
      onClick,
    }: {
      children: React.ReactNode
      onClick?: React.MouseEventHandler
    }) => React.createElement('div', { 'data-testid': 'dropdown-content', onClick }, children),
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
    }: {
      children: React.ReactNode
      onSelect?: () => void
      disabled?: boolean
    }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          disabled,
          onClick: () => !disabled && onSelect?.(),
          role: 'menuitem',
        },
        children
      ),
    DropdownMenuSeparator: () => React.createElement('hr', null),
  }
})

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('EnvironmentNode', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    deleteMutateAsync.mockClear()
    exportRun.mockClear()
    envirXRun.mockClear()
    reportRun.mockClear()
  })

  const baseProps = {
    oid: 'env-oid',
    localId: 'TestEnv',
    actions: [],
    actionCount: 5,
    version: '3',
    lastModifiedDate: '2026-05-10T00:00:00.000Z',
    onActionError: vi.fn(),
  }

  it('renders the two-line row with name + version/date metadata', () => {
    renderWithProviders(<EnvironmentNode {...baseProps} />)
    expect(screen.getByText('TestEnv')).toBeInTheDocument()
    expect(screen.getByText(/\[v3\]/)).toBeInTheDocument()
    expect(screen.getByText(/imported 5\/10/)).toBeInTheDocument()
  })

  it('opens a dropdown menu with four items when the kebab is clicked', async () => {
    renderWithProviders(<EnvironmentNode {...baseProps} />)
    const trigger = screen.getByRole('button', { name: /environment actions/i })
    fireEvent.click(trigger)
    await waitFor(() => {
      expect(screen.getByText('Export Envir Package')).toBeInTheDocument()
      expect(screen.getByText('Export as .WFenvirX')).toBeInTheDocument()
      expect(screen.getByText('Generate PDF report')).toBeInTheDocument()
      expect(screen.getByText('Delete environment')).toBeInTheDocument()
    })
  })

  it('clicking Delete confirms then triggers the mutation', async () => {
    renderWithProviders(<EnvironmentNode {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /environment actions/i }))
    await waitFor(() => screen.getByText('Delete environment'))
    fireEvent.click(screen.getByText('Delete environment'))
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Delete environment "TestEnv"')
    )
    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith('env-oid')
    })
  })
})
