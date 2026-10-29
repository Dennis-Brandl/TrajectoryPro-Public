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
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OptionsSection } from '../OptionsSection'
import type { Block, CheckboxBlock } from '@mission/form-schema'

const block: CheckboxBlock = { id: 'b', type: 'checkbox', fieldName: 'f', options: [{ label: 'A', value: 'a' }] }

describe('OptionsSection', () => {
  it('adds an option whose value starts out as its label, unchanged', () => {
    const onUpdate = vi.fn()
    render(<OptionsSection block={block} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByPlaceholderText(/type and press enter/i), {
      target: { value: 'Warehouse/Loading Dock' },
    })
    fireEvent.keyDown(screen.getByPlaceholderText(/type and press enter/i), { key: 'Enter' })
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          { label: 'A', value: 'a' },
          { label: 'Warehouse/Loading Dock', value: 'Warehouse/Loading Dock' },
        ]),
      }),
    )
  })

  it('editing an option label commits the updated options', () => {
    const onUpdate = vi.fn()
    render(<OptionsSection block={block} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'Green' } })
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ options: [{ label: 'Green', value: 'a' }] }))
  })

  it('editing a label does not remount the option input (stable identity through the store round-trip)', () => {
    // The bug: committing inside the setLocalOptions updater let the re-derive guard fire and
    // regenerate option ids, remounting the input mid-keystroke and dropping focus. The Harness
    // feeds committed options back down like the real store, so a self-commit must NOT re-derive
    // and the same DOM node must survive the round-trip.
    function Harness() {
      const [b, setB] = useState<CheckboxBlock>(block)
      return (
        <OptionsSection
          block={b}
          onUpdate={(patch: Partial<Block>) => setB((prev) => ({ ...prev, ...patch }) as CheckboxBlock)}
        />
      )
    }
    render(<Harness />)
    const before = screen.getByDisplayValue('A')
    fireEvent.change(before, { target: { value: 'Gr' } })
    expect(screen.getByDisplayValue('Gr')).toBe(before)
  })
})
