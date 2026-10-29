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

import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReturnConfigEditor } from '../ReturnConfigEditor'

const targets = [
  { id: 'm1', label: 'Mix Ingredients' },
  { id: 'm2', label: 'Bake' },
]

describe('ReturnConfigEditor', () => {
  it('renders the command select defaulting to ABANDON when value is undefined', () => {
    const { getAllByRole } = render(<ReturnConfigEditor value={undefined} onChange={vi.fn()} gotoTargets={targets} />)
    const selects = getAllByRole('combobox') as HTMLSelectElement[]
    expect(selects[0].value).toBe('ABANDON')
    // No sub-selects when command is ABANDON
    expect(selects.length).toBe(1)
  })

  it('switching to RESTART shows restart_mode sub-select', () => {
    const onChange = vi.fn()
    const { getAllByRole } = render(<ReturnConfigEditor value={undefined} onChange={onChange} gotoTargets={targets} />)
    fireEvent.change(getAllByRole('combobox')[0], { target: { value: 'RESTART' } })
    expect(onChange).toHaveBeenCalledWith({ command: 'RESTART', restart_mode: undefined })
  })

  it('choosing KEEP in restart_mode sub-select calls onChange correctly', () => {
    const onChange = vi.fn()
    const { getAllByRole } = render(
      <ReturnConfigEditor
        value={{ command: 'RESTART', restart_mode: undefined }}
        onChange={onChange}
        gotoTargets={targets}
      />,
    )
    const selects = getAllByRole('combobox') as HTMLSelectElement[]
    // Second select is the restart_mode select
    fireEvent.change(selects[1], { target: { value: 'KEEP' } })
    expect(onChange).toHaveBeenCalledWith({ command: 'RESTART', restart_mode: 'KEEP' })
  })

  it('switching to GOTO shows goto target sub-select with provided targets', () => {
    const onChange = vi.fn()
    const { getAllByRole } = render(<ReturnConfigEditor value={undefined} onChange={onChange} gotoTargets={targets} />)
    fireEvent.change(getAllByRole('combobox')[0], { target: { value: 'GOTO' } })
    expect(onChange).toHaveBeenCalledWith({ command: 'GOTO', goto_step_oid: 'm1' })
  })

  it('choosing a goto target calls onChange with the step oid', () => {
    const onChange = vi.fn()
    const { getAllByRole } = render(
      <ReturnConfigEditor value={{ command: 'GOTO', goto_step_oid: 'm1' }} onChange={onChange} gotoTargets={targets} />,
    )
    const selects = getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(selects[1], { target: { value: 'm2' } })
    expect(onChange).toHaveBeenCalledWith({ command: 'GOTO', goto_step_oid: 'm2' })
  })

  it('switching to RETRY shows no sub-fields', () => {
    const onChange = vi.fn()
    const { getAllByRole } = render(<ReturnConfigEditor value={undefined} onChange={onChange} gotoTargets={targets} />)
    fireEvent.change(getAllByRole('combobox')[0], { target: { value: 'RETRY' } })
    expect(onChange).toHaveBeenCalledWith({ command: 'RETRY' })
  })

  it('GOTO option is disabled and onChange not called when gotoTargets is empty', () => {
    const onChange = vi.fn()
    const { getByRole, getAllByRole } = render(
      <ReturnConfigEditor value={undefined} onChange={onChange} gotoTargets={[]} />,
    )
    const gotoOption = getByRole('option', { name: 'GOTO' }) as HTMLOptionElement
    expect(gotoOption.disabled).toBe(true)
    fireEvent.change(getAllByRole('combobox')[0], { target: { value: 'GOTO' } })
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'GOTO' }))
  })

  it('shows the "RETURN command" heading by default', () => {
    const { getByText } = render(<ReturnConfigEditor value={undefined} onChange={vi.fn()} gotoTargets={targets} />)
    expect(getByText('RETURN command')).toBeTruthy()
  })

  it('hides the heading when hideHeading is set', () => {
    const { queryByText, getAllByRole } = render(
      <ReturnConfigEditor value={undefined} onChange={vi.fn()} gotoTargets={targets} hideHeading />,
    )
    expect(queryByText('RETURN command')).toBeNull()
    // The command select is still present.
    expect(getAllByRole('combobox').length).toBeGreaterThanOrEqual(1)
  })

  it('switching to COMPLETE emits {command:"COMPLETE"} with no sub-fields', () => {
    const onChange = vi.fn()
    const { getAllByRole } = render(<ReturnConfigEditor value={undefined} onChange={onChange} gotoTargets={targets} />)
    fireEvent.change(getAllByRole('combobox')[0], { target: { value: 'COMPLETE' } })
    expect(onChange).toHaveBeenCalledWith({ command: 'COMPLETE' })
  })

  it('offers the COMPLETE option under its own command name (consistent with the other commands)', () => {
    const { getByRole } = render(<ReturnConfigEditor value={undefined} onChange={vi.fn()} gotoTargets={targets} />)
    const opt = getByRole('option', { name: 'COMPLETE' }) as HTMLOptionElement
    expect(opt.value).toBe('COMPLETE')
  })

  it('shows no sub-select when command is COMPLETE', () => {
    const { getAllByRole } = render(
      <ReturnConfigEditor value={{ command: 'COMPLETE' }} onChange={vi.fn()} gotoTargets={targets} />,
    )
    expect((getAllByRole('combobox') as HTMLSelectElement[]).length).toBe(1)
  })
})
