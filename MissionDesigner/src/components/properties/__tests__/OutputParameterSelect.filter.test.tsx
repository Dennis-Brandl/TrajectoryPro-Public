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
import { filterComboboxGroups } from '@mission/ui/combobox'
import { OutputParameterSelect } from '@/components/properties/OutputParameterSelect'
import { SendSourceSelect } from '@/components/properties/SendSourceSelect'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { ValueSpec } from '@/types/nodes'

function prop(name: string, ...entries: string[]): ValueSpec {
  return {
    id: `v-${name}`,
    name,
    entries: entries.map((e) => ({ id: `e-${name}-${e}`, name: e, value: '' })),
  }
}

beforeEach(() => {
  useFlowStore.setState({
    nodes: [],
    edges: [],
    workflowInputs: [],
    workflowOutputs: [],
    workflowValues: [prop('Temperature', 'Value', 'Units'), prop('Pressure', 'Value')],
    workflowResources: [],
    hasDraft: false,
    editDialogRequest: null,
    _showLegacyUpgradeNotice: false,
    propertiesPanelWidth: 280,
  })
  useFlowStore.temporal.getState().clear()
  useLibraryStore.setState({ specifications: new Map(), selectedSpecificationId: null })
})

function openAndType(text: string) {
  fireEvent.click(screen.getByRole('combobox'))
  fireEvent.change(screen.getByPlaceholderText(/Type to filter/), { target: { value: text } })
}

describe('filterComboboxGroups', () => {
  const groups = [
    { heading: 'A', items: [{ value: 'Room.Temp' }, { value: 'Pressure' }] },
    { heading: 'B', items: [{ value: 'Other' }] },
    { pinned: true, items: [{ value: '__add__', searchText: 'Add' }] },
  ]

  it('matches a case-insensitive substring and drops emptied groups', () => {
    expect(filterComboboxGroups(groups, 'TEMP')).toEqual([{ heading: 'A', items: [{ value: 'Room.Temp' }] }, groups[2]])
  })

  it('returns everything for a blank query', () => {
    expect(filterComboboxGroups(groups, '  ')).toEqual(groups)
  })
})

describe('OutputParameterSelect filter as you type', () => {
  it('filters the destinations and keeps the Add... actions visible', () => {
    render(<OutputParameterSelect value="" onChange={vi.fn()} />)
    openAndType('temp')
    expect(screen.getByText('Temperature.Value')).toBeTruthy()
    expect(screen.getByText('Temperature.Units')).toBeTruthy()
    expect(screen.queryByText('Pressure.Value')).toBeNull()
    expect(screen.queryByText('(none)')).toBeNull()
    expect(screen.getByText('Add Value Property...')).toBeTruthy()
    expect(screen.getByText('Add Entry to Property...')).toBeTruthy()
  })

  it('choosing a filtered row writes it through onChange', () => {
    const onChange = vi.fn()
    render(<OutputParameterSelect value="" onChange={onChange} />)
    openAndType('units')
    fireEvent.click(screen.getByText('Temperature.Units'))
    expect(onChange).toHaveBeenCalledWith('Temperature.Units')
  })

  it('Enter picks the first match', () => {
    const onChange = vi.fn()
    render(<OutputParameterSelect value="" onChange={onChange} />)
    openAndType('pressure')
    fireEvent.keyDown(screen.getByPlaceholderText(/Type to filter/), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('Pressure.Value')
  })

  it('(none) clears the destination', () => {
    const onChange = vi.fn()
    render(<OutputParameterSelect value="Temperature.Value" onChange={onChange} />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByText('(none)'))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('shows "No matches" but keeps the actions when nothing matches', () => {
    render(<OutputParameterSelect value="" onChange={vi.fn()} />)
    openAndType('zzz')
    expect(screen.getByText('No matches')).toBeTruthy()
    expect(screen.getByText('Add Value Property...')).toBeTruthy()
  })
})

describe('SendSourceSelect filter as you type', () => {
  it('filters property names and entries; Literal value... stays', () => {
    const onChange = vi.fn()
    render(<SendSourceSelect value={undefined} onChange={onChange} />)
    openAndType('press')
    expect(screen.getByText('Pressure')).toBeTruthy()
    expect(screen.getByText('Pressure.Value')).toBeTruthy()
    expect(screen.queryByText('Temperature')).toBeNull()
    expect(screen.getByText('Literal value...')).toBeTruthy()
    fireEvent.click(screen.getByText('Pressure'))
    expect(onChange).toHaveBeenCalledWith('Pressure')
  })
})
