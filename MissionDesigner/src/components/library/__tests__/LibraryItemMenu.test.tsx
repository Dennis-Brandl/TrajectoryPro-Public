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
import { LibraryItemMenu } from '@/components/library/LibraryItemMenu'

/** Open the Radix DropdownMenu trigger in jsdom (needs pointerDown before click). */
function openMenu(button: HTMLElement) {
  fireEvent.pointerDown(button, { button: 0, ctrlKey: false })
  fireEvent.click(button)
}

describe('LibraryItemMenu', () => {
  // Default: all three write caps enabled so the menu renders.
  function renderMenu(overrides: Partial<React.ComponentProps<typeof LibraryItemMenu>> = {}) {
    return render(
      <LibraryItemMenu
        canChangeState
        canCreateVersion
        canDeleteSpec
        onExportPDF={vi.fn()}
        onChangeState={vi.fn()}
        onCreateVersion={vi.fn()}
        onDelete={vi.fn()}
        {...overrides}
      />,
    )
  }

  it('renders trigger; menu hidden until clicked', () => {
    renderMenu()
    expect(screen.queryByRole('menu')).toBeNull()
    openMenu(screen.getByRole('button', { name: /item actions/i }))
    expect(screen.queryByRole('menu')).not.toBeNull()
  })

  it('shows all items (PDF, Change State, New Version, Delete) when all caps true', () => {
    renderMenu()
    openMenu(screen.getByRole('button', { name: /item actions/i }))
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(items).toEqual(['Export as PDF', 'Change State…', 'Create New Version…', 'Delete'])
  })

  it('inserts "Export as Package" before "Export as PDF" when onExportPackage is supplied', () => {
    const onExportPackage = vi.fn()
    renderMenu({ onExportPackage })
    openMenu(screen.getByRole('button', { name: /item actions/i }))
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(items).toEqual(['Export as Package', 'Export as PDF', 'Change State…', 'Create New Version…', 'Delete'])
    fireEvent.click(screen.getByText('Export as Package'))
    expect(onExportPackage).toHaveBeenCalledTimes(1)
  })

  it('invokes onExportPDF when Export is clicked', () => {
    const onExportPDF = vi.fn()
    renderMenu({ onExportPDF })
    openMenu(screen.getByRole('button', { name: /item actions/i }))
    fireEvent.click(screen.getByText('Export as PDF'))
    expect(onExportPDF).toHaveBeenCalledTimes(1)
  })

  it('invokes onDelete when Delete is clicked', () => {
    const onDelete = vi.fn()
    renderMenu({ onDelete })
    openMenu(screen.getByRole('button', { name: /item actions/i }))
    fireEvent.click(screen.getByText('Delete'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when all caps are false (read-only viewer)', () => {
    const { container } = renderMenu({ canChangeState: false, canCreateVersion: false, canDeleteSpec: false })
    expect(container.firstChild).toBeNull()
  })

  it('only shows Change State when only canChangeState is true', () => {
    renderMenu({ canChangeState: true, canCreateVersion: false, canDeleteSpec: false })
    openMenu(screen.getByRole('button', { name: /item actions/i }))
    expect(screen.getByText('Change State…')).not.toBeNull()
    expect(screen.queryByText('Create New Version…')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('only shows New Version when only canCreateVersion is true', () => {
    renderMenu({ canChangeState: false, canCreateVersion: true, canDeleteSpec: false })
    openMenu(screen.getByRole('button', { name: /item actions/i }))
    expect(screen.getByText('Create New Version…')).not.toBeNull()
    expect(screen.queryByText('Change State…')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })
})
