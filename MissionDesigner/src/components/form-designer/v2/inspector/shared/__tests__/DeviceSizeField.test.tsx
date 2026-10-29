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
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeviceSizeField } from '../DeviceSizeField'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

beforeEach(() => useFormDocumentStore.getState().setActiveBreakpoint('base'))

describe('DeviceSizeField', () => {
  it('desktop behaves like a plain select: writes size, no hint, no clear button', () => {
    const onChange = vi.fn()
    render(<DeviceSizeField size="md" fallback="md" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText(/size/i), { target: { value: 'xl' } })
    expect(onChange).toHaveBeenCalledWith({ size: 'xl' })
    expect(screen.queryByText(/from desktop/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull()
  })

  it('phone with size lg shows lg (from Desktop) and writes sizeAt.phone', () => {
    useFormDocumentStore.getState().setActiveBreakpoint('phone')
    const onChange = vi.fn()
    render(<DeviceSizeField size="lg" fallback="md" onChange={onChange} />)
    expect((screen.getByLabelText(/size/i) as HTMLSelectElement).value).toBe('lg')
    expect(screen.getByText('(from Desktop)')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull()
    fireEvent.change(screen.getByLabelText(/size/i), { target: { value: 'sm' } })
    expect(onChange).toHaveBeenCalledWith({ sizeAt: { phone: 'sm' } })
  })

  it('phone inherits from Tablet when a tablet override exists', () => {
    useFormDocumentStore.getState().setActiveBreakpoint('phone')
    render(<DeviceSizeField size="lg" sizeAt={{ tablet: 'sm' }} fallback="md" onChange={vi.fn()} />)
    expect((screen.getByLabelText(/size/i) as HTMLSelectElement).value).toBe('sm')
    expect(screen.getByText('(from Tablet)')).toBeTruthy()
  })

  it('shows the clear button only when overridden, and clears it', () => {
    useFormDocumentStore.getState().setActiveBreakpoint('phone')
    const onChange = vi.fn()
    render(<DeviceSizeField size="lg" sizeAt={{ phone: 'xs' }} fallback="md" onChange={onChange} />)
    expect(screen.queryByText(/\(from/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear phone override (inherit desktop)' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].sizeAt).toBeUndefined()
  })

  it('phone clear button says inherit tablet when a tablet override exists', () => {
    useFormDocumentStore.getState().setActiveBreakpoint('phone')
    render(<DeviceSizeField size="lg" sizeAt={{ tablet: 'sm', phone: 'xs' }} fallback="md" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Clear phone override (inherit tablet)' })).toBeTruthy()
  })
})
