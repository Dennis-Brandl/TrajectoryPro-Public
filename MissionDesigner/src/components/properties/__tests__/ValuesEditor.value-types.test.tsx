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
import { ValuesEditor } from '@/components/properties/ValuesEditor'
import type { ValueSpec, ValueTypeSpec } from '@/types/nodes'

const customerInfo: ValueTypeSpec = {
  id: 'vt-1',
  name: 'CustomerInfo',
  entries: [
    { id: 'e-1', name: 'Name' },
    { id: 'e-2', name: 'Country', defaultValue: 'USA' },
  ],
}

/** Open a Radix DropdownMenu trigger in jsdom (needs pointerDown before click). */
function openDropdown(button: HTMLElement) {
  fireEvent.pointerDown(button, { button: 0, ctrlKey: false })
  fireEvent.click(button)
}

describe('ValuesEditor — Value Type creation', () => {
  it('with no types in scope, + adds a Freeform property immediately (no menu)', () => {
    const onChange = vi.fn()
    render(<ValuesEditor values={[]} onChange={onChange} />)
    const addButton = screen.getByRole('button', { name: /^Add value property$/i })
    expect(addButton.getAttribute('aria-haspopup')).toBeNull()
    fireEvent.click(addButton)
    expect(onChange).toHaveBeenCalledTimes(1)
    const added = (onChange.mock.calls[0][0] as ValueSpec[])[0]
    expect(added.entries.map((e) => e.name)).toEqual(['Value', 'Description'])
  })

  it('with types in scope, + itself opens the Freeform/type menu (no separate chevron)', () => {
    const onChange = vi.fn()
    render(<ValuesEditor values={[]} onChange={onChange} availableValueTypes={[customerInfo]} />)
    expect(screen.queryByRole('button', { name: /Add value property from type/i })).toBeNull()
    const addButton = screen.getByRole('button', { name: /^Add value property$/i })
    expect(addButton.getAttribute('aria-haspopup')).toBe('menu')
    openDropdown(addButton)
    fireEvent.click(screen.getByText('From CustomerInfo'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const added = (onChange.mock.calls[0][0] as ValueSpec[])[0]
    expect(added.entries.map((e) => e.name)).toEqual(['Name', 'Country', 'Description'])
    expect(added.entries.find((e) => e.name === 'Country')?.value).toBe('USA')
    expect(added.name).toBe('')
  })

  it('still creates a Freeform property from the + menu', () => {
    const onChange = vi.fn()
    render(<ValuesEditor values={[]} onChange={onChange} availableValueTypes={[customerInfo]} />)
    openDropdown(screen.getByRole('button', { name: /^Add value property$/i }))
    fireEvent.click(screen.getByText('Freeform'))
    const added = (onChange.mock.calls[0][0] as ValueSpec[])[0]
    expect(added.entries.map((e) => e.name)).toEqual(['Value', 'Description'])
  })
})
