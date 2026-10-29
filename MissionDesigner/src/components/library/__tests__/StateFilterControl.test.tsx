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

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StateFilterControl } from '@/components/library/StateFilterControl'
import { useLibraryStore } from '@/stores/libraryStore'

function openDropdown(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0 })
  fireEvent.click(trigger)
}

describe('StateFilterControl', () => {
  beforeEach(() => {
    useLibraryStore.setState({ stateFilter: 'all' })
  })

  it('shows "All" by default', () => {
    render(<StateFilterControl />)
    expect(screen.getByRole('button').textContent).toContain('All')
  })

  it('opens dropdown with All + 7 states on click', async () => {
    render(<StateFilterControl />)
    openDropdown(screen.getByRole('button'))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((el) => el.textContent)).toEqual([
      'All',
      'Draft',
      'InTest',
      'InReview',
      'Approved',
      'Effective',
      'Superseded',
      'Obsolete',
    ])
  })

  it('selecting an option updates libraryStore.stateFilter and the trigger label', async () => {
    render(<StateFilterControl />)
    openDropdown(screen.getByRole('button'))
    const effective = await screen.findByText('Effective')
    fireEvent.click(effective)
    expect(useLibraryStore.getState().stateFilter).toBe('Effective')
    expect(screen.getByRole('button').textContent).toContain('Effective')
  })
})
