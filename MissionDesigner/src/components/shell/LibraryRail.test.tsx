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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LibraryRail } from './LibraryRail'
import { LibrarySidebar } from '@/components/library/LibrarySidebar'
import { useLibraryStore } from '@/stores/libraryStore'
import { useFlowStore } from '@/stores/flowStore'
import { usePrincipalStore } from '@/stores/principalStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'

beforeEach(() => {
  useLibraryStore.setState({ activeEntityType: 'workflow' })
  useFlowStore.setState({ librarySidebarCollapsed: false, librarySidebarWidth: 256 })
  usePrincipalStore.setState({ principal: null })
})

const asAdmin = (isAdministrator: boolean) =>
  usePrincipalStore.setState({ principal: { isAdministrator } as unknown as MePrincipal })

describe('LibraryRail', () => {
  it('lists the four library kinds', () => {
    render(<LibraryRail />)
    for (const name of ['Workflows', 'Step Libraries', 'Environments', 'Actions']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('selecting another kind switches to it and shows the sidebar', () => {
    useFlowStore.setState({ librarySidebarCollapsed: true })
    render(<LibraryRail />)
    fireEvent.click(screen.getByRole('button', { name: 'Step Libraries' }))
    expect(useLibraryStore.getState().activeEntityType).toBe('step')
    expect(useFlowStore.getState().librarySidebarCollapsed).toBe(false)
  })

  it('selecting the current kind toggles the sidebar', () => {
    render(<LibraryRail />)
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }))
    expect(useFlowStore.getState().librarySidebarCollapsed).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }))
    expect(useFlowStore.getState().librarySidebarCollapsed).toBe(false)
  })

  it('administrators get Teams and Account, which open that Administration tab', () => {
    asAdmin(true)
    const onOpenAdmin = vi.fn()
    render(<LibraryRail onOpenAdmin={onOpenAdmin} />)
    fireEvent.click(screen.getByRole('button', { name: 'Teams' }))
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    expect(onOpenAdmin.mock.calls).toEqual([['teams'], ['accounts']])
    expect(useLibraryStore.getState().activeEntityType).toBe('workflow')
  })

  it('non-administrators do not see Teams or Account', () => {
    asAdmin(false)
    render(<LibraryRail onOpenAdmin={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Teams' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull()
  })

  it('a stored sidebar width of 450 renders as 400', () => {
    useFlowStore.setState({ librarySidebarWidth: 450 })
    const { container } = render(<LibrarySidebar width={useFlowStore.getState().librarySidebarWidth} />)
    expect((container.firstChild as HTMLElement).style.width).toBe('400px')
  })
})
