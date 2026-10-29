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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PropertySpecsEditor } from './PropertySpecsEditor'
import type { ActionPropertySpec } from '@/lib/types'

const specs: ActionPropertySpec[] = [
  {
    name: 'Config',
    entries: [
      { name: 'Host', value: 'localhost' },
      { name: 'Port', value: '8080' },
    ],
  },
  { name: 'Flags', entries: [{ name: 'Debug', value: 'false' }] },
]

function renderEditor(overrides: Partial<Parameters<typeof PropertySpecsEditor>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(
    <PropertySpecsEditor
      specs={specs}
      onSave={onSave}
      isSaving={false}
      error={null}
      {...overrides}
    />
  )
  return onSave
}

function valueInput(property: string, entry: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: `${property} ${entry}` })
}

describe('PropertySpecsEditor', () => {
  it('renders every property entry read-only with an Edit button', () => {
    renderEditor()
    expect(screen.getByText('Config')).toBeInTheDocument()
    expect(screen.getByText('Host')).toBeInTheDocument()
    expect(screen.getByText('localhost')).toBeInTheDocument()
    expect(screen.getByText('Port')).toBeInTheDocument()
    expect(screen.getByText('8080')).toBeInTheDocument()
    expect(screen.getByText('Flags')).toBeInTheDocument()
    expect(screen.getByText('false')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('Save sends only the entries whose value changed', async () => {
    const onSave = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    fireEvent.change(valueInput('Config', 'Port'), { target: { value: '9090' } })
    // Touch-and-restore must NOT count as a change.
    fireEvent.change(valueInput('Config', 'Host'), { target: { value: 'x' } })
    fireEvent.change(valueInput('Config', 'Host'), { target: { value: 'localhost' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith([{ property: 'Config', entry: 'Port', value: '9090' }])
  })

  it('disables Save until a value changes', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(valueInput('Flags', 'Debug'), { target: { value: 'true' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('Cancel discards the draft and restores the stored values', () => {
    const onSave = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(valueInput('Config', 'Host'), { target: { value: 'changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('localhost')).toBeInTheDocument()

    // Re-entering edit mode starts from the stored values, not the discarded draft.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(valueInput('Config', 'Host').value).toBe('localhost')
  })

  it('leaves edit mode after a successful save', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(valueInput('Flags', 'Debug'), { target: { value: 'true' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('stays in edit mode and shows the message when the save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Entry 'Debug' not found"))
    renderEditor({ onSave, error: new Error("Entry 'Debug' not found") })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(valueInput('Flags', 'Debug'), { target: { value: 'true' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(screen.getByRole('textbox', { name: 'Flags Debug' })).toBeInTheDocument()
    expect(screen.getByText("Entry 'Debug' not found")).toBeInTheDocument()
  })

  it('disables the inputs and Save while a save is in flight', () => {
    renderEditor({ isSaving: true })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(valueInput('Config', 'Host')).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Sav(e|ing)/ })).toBeDisabled()
  })
})
