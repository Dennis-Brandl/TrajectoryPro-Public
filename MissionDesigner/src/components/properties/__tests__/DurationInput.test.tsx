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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DurationInput } from '../DurationInput'

afterEach(cleanup)

describe('DurationInput', () => {
  it('shows the parts and their total', () => {
    render(<DurationInput idPrefix="d" value={{ hours: 2, minutes: 10, seconds: 20 }} onChange={vi.fn()} />)
    expect((screen.getByLabelText('Hours') as HTMLInputElement).value).toBe('2')
    expect((screen.getByLabelText('Weeks') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('Total: 2 h 10 min 20 s')).toBeTruthy()
  })
  it('keeps what was typed (90 min stays 90 min) and reads back the normalized total', () => {
    const onChange = vi.fn()
    render(<DurationInput idPrefix="d" value={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '90' } })
    expect(onChange).toHaveBeenCalledWith({ minutes: 90 })
    cleanup()
    render(<DurationInput idPrefix="d" value={{ minutes: 90 }} onChange={vi.fn()} />)
    expect((screen.getByLabelText('Minutes') as HTMLInputElement).value).toBe('90')
    expect(screen.getByText('Total: 1 h 30 min')).toBeTruthy()
  })
  it('a blank box clears that unit; negative or fractional input is ignored', () => {
    const onChange = vi.fn()
    render(<DurationInput idPrefix="d" value={{ minutes: 4, seconds: 5 }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Seconds'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ minutes: 4 })
    onChange.mockClear()
    fireEvent.change(screen.getByLabelText('Seconds'), { target: { value: '-1' } })
    fireEvent.change(screen.getByLabelText('Seconds'), { target: { value: '1.5' } })
    expect(onChange).not.toHaveBeenCalled()
  })
  it('only ever stores non-negative integers (negative zero normalizes to 0)', () => {
    const onChange = vi.fn()
    render(<DurationInput idPrefix="d" value={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Seconds'), { target: { value: '-0' } })
    for (const call of onChange.mock.calls) {
      for (const v of Object.values(call[0] as Record<string, number>)) {
        expect(Number.isInteger(v) && v >= 0 && !Object.is(v, -0)).toBe(true)
      }
    }
  })
  it('flags zero and over-52-weeks totals', () => {
    const { rerender } = render(<DurationInput idPrefix="d" value={{}} onChange={vi.fn()} />)
    expect(screen.getByText('Enter a delay')).toBeTruthy()
    rerender(<DurationInput idPrefix="d" value={{ weeks: 53 }} onChange={vi.fn()} />)
    expect(screen.getByText('Longer than 52 weeks')).toBeTruthy()
  })
  it('with emptyText, a zero total reads as that text instead of an error', () => {
    render(<DurationInput idPrefix="d" value={{}} onChange={vi.fn()} emptyText="No time limit" />)
    expect(screen.getByText('No time limit')).toBeTruthy()
    expect(screen.queryByText('Enter a delay')).toBeNull()
  })
})
