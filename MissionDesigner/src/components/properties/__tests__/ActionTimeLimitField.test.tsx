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
import { ActionTimeLimitField } from '../ActionTimeLimitField'

describe('ActionTimeLimitField', () => {
  it('blank shows the No limit placeholder', () => {
    render(<ActionTimeLimitField timeoutMs={undefined} disabled={false} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Time limit (seconds)').getAttribute('placeholder')).toBe('No limit')
  })

  it('typing 45 reports 45000', () => {
    const onChange = vi.fn()
    render(<ActionTimeLimitField timeoutMs={undefined} disabled={false} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Time limit (seconds)'), { target: { value: '45' } })
    expect(onChange).toHaveBeenCalledWith(45000)
  })

  it('clearing reports undefined', () => {
    const onChange = vi.fn()
    render(<ActionTimeLimitField timeoutMs={30000} disabled={false} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Time limit (seconds)'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it.each(['1.5', '0', 'abc'])('%s shows the error and does not report', (v) => {
    const onChange = vi.fn()
    render(<ActionTimeLimitField timeoutMs={undefined} disabled={false} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Time limit (seconds)'), { target: { value: v } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Enter a whole number of seconds, 1 or more.')
  })

  it('shows 30 for a stored 30000', () => {
    render(<ActionTimeLimitField timeoutMs={30000} disabled={false} onChange={vi.fn()} />)
    expect((screen.getByLabelText('Time limit (seconds)') as HTMLInputElement).value).toBe('30')
  })

  it('disabled shows Choose an action first', () => {
    render(<ActionTimeLimitField timeoutMs={undefined} disabled={true} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Time limit (seconds)').getAttribute('placeholder')).toBe('Choose an action first')
  })
})
