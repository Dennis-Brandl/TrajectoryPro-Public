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
import { ValueTypesSection } from '@/components/detail/environment/ValueTypesSection'
import type { ValueTypeSpec } from '@/types/nodes'

const customerInfo: ValueTypeSpec = {
  id: 'vt-1',
  name: 'CustomerInfo',
  description: 'Standard customer record',
  entries: [
    { id: 'e-1', name: 'Name' },
    { id: 'e-2', name: 'Country', defaultValue: 'USA' },
  ],
}

describe('ValueTypesSection', () => {
  it('renders empty state', () => {
    render(<ValueTypesSection valueTypes={[]} onAdd={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()} />)
    expect(screen.getByText(/No value types defined/i)).toBeTruthy()
  })

  it('adds a type via the dialog', () => {
    const onAdd = vi.fn()
    render(<ValueTypesSection valueTypes={[]} onAdd={onAdd} onRemove={vi.fn()} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Add Value Type/i }))
    fireEvent.change(screen.getByPlaceholderText('Value type name'), { target: { value: 'CustomerInfo' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    const added = onAdd.mock.calls[0][0] as ValueTypeSpec
    expect(added.name).toBe('CustomerInfo')
    expect(added.entries).toEqual([])
    expect(added.id).toBeTruthy()
  })

  it('moves an entry up or down; the ends cannot move past the edge', () => {
    const onUpdate = vi.fn()
    render(<ValueTypesSection valueTypes={[customerInfo]} onAdd={vi.fn()} onRemove={vi.fn()} onUpdate={onUpdate} />)
    expect((screen.getByRole('button', { name: 'Move Name up' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Move Country down' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Move Country up' }))
    expect(onUpdate).toHaveBeenLastCalledWith('vt-1', { entries: [customerInfo.entries[1], customerInfo.entries[0]] })
    fireEvent.click(screen.getByRole('button', { name: 'Move Name down' }))
    expect(onUpdate).toHaveBeenLastCalledWith('vt-1', { entries: [customerInfo.entries[1], customerInfo.entries[0]] })
  })

  it('renders entries and adds a new entry to a type', () => {
    const onUpdate = vi.fn()
    render(<ValueTypesSection valueTypes={[customerInfo]} onAdd={vi.fn()} onRemove={vi.fn()} onUpdate={onUpdate} />)
    expect(screen.getByDisplayValue('CustomerInfo')).toBeTruthy()
    expect(screen.getByDisplayValue('USA')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add Entry/i }))
    expect(onUpdate).toHaveBeenCalledWith('vt-1', {
      entries: [...customerInfo.entries, expect.objectContaining({ name: '' })],
    })
  })

  it('blocks renaming an entry to the reserved name Description', () => {
    const onUpdate = vi.fn()
    render(<ValueTypesSection valueTypes={[customerInfo]} onAdd={vi.fn()} onRemove={vi.fn()} onUpdate={onUpdate} />)
    const nameInput = screen.getByDisplayValue('Name')
    fireEvent.change(nameInput, { target: { value: 'Description' } })
    // update must NOT be applied for the reserved name
    const applied = onUpdate.mock.calls.some((c) => JSON.stringify(c[1]).toLowerCase().includes('"description"'))
    expect(applied).toBe(false)
  })

  it("blocks renaming a type to another type's name, case-insensitively", () => {
    const orderInfo: ValueTypeSpec = { id: 'vt-2', name: 'OrderInfo', entries: [] }
    const onUpdate = vi.fn()
    render(
      <ValueTypesSection
        valueTypes={[customerInfo, orderInfo]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onUpdate={onUpdate}
      />,
    )
    const nameInput = screen.getByDisplayValue('CustomerInfo')
    fireEvent.change(nameInput, { target: { value: 'orderinfo' } })
    // update must NOT be applied for a name colliding with another type (case-insensitive)
    const applied = onUpdate.mock.calls.some(
      (c) =>
        c[1] &&
        typeof (c[1] as Partial<ValueTypeSpec>).name === 'string' &&
        (c[1] as Partial<ValueTypeSpec>).name!.toLowerCase() === 'orderinfo',
    )
    expect(applied).toBe(false)
  })

  it("blocks renaming an entry to a sibling entry's name, case-insensitively", () => {
    const onUpdate = vi.fn()
    render(<ValueTypesSection valueTypes={[customerInfo]} onAdd={vi.fn()} onRemove={vi.fn()} onUpdate={onUpdate} />)
    const nameInput = screen.getByDisplayValue('Name')
    fireEvent.change(nameInput, { target: { value: 'country' } })
    // update must NOT be applied for a name colliding with a sibling entry (case-insensitive)
    const applied = onUpdate.mock.calls.some((c) => JSON.stringify(c[1]).toLowerCase().includes('"name":"country"'))
    expect(applied).toBe(false)
  })
})
