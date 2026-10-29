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

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CatchIdEditor } from '../CatchIdEditor'

describe('CatchIdEditor', () => {
  it('renders a text input bound to the current value', () => {
    const { getByRole } = render(<CatchIdEditor value="OvenFailed" onChange={vi.fn()} takenIds={[]} />)
    const input = getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('OvenFailed')
  })

  it('shows duplicate warning when typed id is in takenIds (and differs from current)', () => {
    const { getByRole, getByText } = render(
      <CatchIdEditor value="OvenFailed" onChange={vi.fn()} takenIds={['Dup', 'Other']} />,
    )
    fireEvent.change(getByRole('textbox'), { target: { value: 'Dup' } })
    expect(getByText(/unique/i)).toBeTruthy()
  })

  it('does not show duplicate warning when typed id matches the current value', () => {
    const { getByRole, queryByText } = render(
      <CatchIdEditor value="OvenFailed" onChange={vi.fn()} takenIds={['OvenFailed']} />,
    )
    fireEvent.change(getByRole('textbox'), { target: { value: 'OvenFailed' } })
    expect(queryByText(/unique/i)).toBeNull()
  })

  it('calls onChange on blur with a non-duplicate, non-empty new value', () => {
    const onChange = vi.fn()
    const { getByRole } = render(<CatchIdEditor value="OvenFailed" onChange={onChange} takenIds={[]} />)
    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: 'BurnerStuck' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith('BurnerStuck')
  })

  it('does not call onChange on blur when value is duplicate', () => {
    const onChange = vi.fn()
    const { getByRole } = render(<CatchIdEditor value="OvenFailed" onChange={onChange} takenIds={['Dup']} />)
    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Dup' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('syncs local input value when value prop changes (node switch)', () => {
    const { getByRole, rerender } = render(<CatchIdEditor value="A" onChange={vi.fn()} takenIds={[]} />)
    const input = getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'SomethingTyped' } })
    rerender(<CatchIdEditor value="B" onChange={vi.fn()} takenIds={[]} />)
    expect((getByRole('textbox') as HTMLInputElement).value).toBe('B')
  })

  it('shows the "CATCH id" heading by default', () => {
    render(<CatchIdEditor value="C1" onChange={vi.fn()} takenIds={[]} />)
    expect(screen.getByText('CATCH id')).toBeTruthy()
  })

  it('hides the heading but keeps the input when hideHeading is set', () => {
    render(<CatchIdEditor value="C1" onChange={vi.fn()} takenIds={[]} hideHeading />)
    expect(screen.queryByText('CATCH id')).toBeNull()
    expect(screen.getByLabelText('catch_id')).toBeTruthy()
  })
})
