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
import { ButtonSection } from '../ButtonSection'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import type { ButtonBlock } from '@mission/form-schema'

const btn = (extra: Partial<ButtonBlock> = {}): ButtonBlock => ({
  id: 'b',
  type: 'button',
  label: '',
  outputValue: 'continue',
  job: 'continue',
  ...extra,
})

beforeEach(() => {
  useFormDocumentStore.getState().setActiveBreakpoint('base')
  useFormDocumentStore.setState({ actionDraft: null })
})

describe('ButtonSection', () => {
  it('offers Continue/Yes/No and sets outputValue with the job', () => {
    const onUpdate = vi.fn()
    render(<ButtonSection block={btn()} onUpdate={onUpdate} />)
    const sel = screen.getByLabelText('Job') as HTMLSelectElement
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(['Continue', 'Yes', 'No'])
    fireEvent.change(sel, { target: { value: 'no' } })
    expect(onUpdate).toHaveBeenCalledWith({ job: 'no', outputValue: 'false' })
    fireEvent.change(sel, { target: { value: 'yes' } })
    expect(onUpdate).toHaveBeenCalledWith({ job: 'yes', outputValue: 'true' })
  })

  it('a job button shows no Output Value field and no None option', () => {
    render(<ButtonSection block={btn()} onUpdate={vi.fn()} />)
    expect(screen.queryByLabelText('Output Value')).toBeNull()
    expect(screen.queryByText(/none \(old button\)/i)).toBeNull()
  })

  it('a job-less button shows None, the hint and Output Value', () => {
    const onUpdate = vi.fn()
    const { job: _j, ...rest } = btn({ outputValue: 'go' })
    render(<ButtonSection block={rest as ButtonBlock} onUpdate={onUpdate} />)
    const sel = screen.getByLabelText('Job') as HTMLSelectElement
    expect(sel.value).toBe('')
    expect(screen.getByText(/None \(old button\)/)).toBeTruthy()
    expect(screen.getByText("Pick a job so this button replaces Pilot's own.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Output Value'), { target: { value: 'x' } })
    expect(onUpdate).toHaveBeenCalledWith({ outputValue: 'x' })
  })

  it('label placeholder follows the continue draft', () => {
    useFormDocumentStore.setState({ actionDraft: { kind: 'continue', label: 'Proceed' } })
    render(<ButtonSection block={btn()} onUpdate={vi.fn()} />)
    expect((screen.getByLabelText('Label') as HTMLInputElement).placeholder).toBe('Proceed')
  })

  it('label placeholder follows the yes/no draft', () => {
    useFormDocumentStore.setState({ actionDraft: { kind: 'yesno', yes: 'Accept', no: 'Reject' } })
    const { rerender } = render(<ButtonSection block={btn({ job: 'yes' })} onUpdate={vi.fn()} />)
    expect((screen.getByLabelText('Label') as HTMLInputElement).placeholder).toBe('Accept')
    rerender(<ButtonSection block={btn({ job: 'no' })} onUpdate={vi.fn()} />)
    expect((screen.getByLabelText('Label') as HTMLInputElement).placeholder).toBe('Reject')
  })

  it('placeholder falls back to the job default when the draft kind does not match', () => {
    useFormDocumentStore.setState({ actionDraft: { kind: 'continue', label: 'Proceed' } })
    render(<ButtonSection block={btn({ job: 'yes' })} onUpdate={vi.fn()} />)
    expect((screen.getByLabelText('Label') as HTMLInputElement).placeholder).toBe('Yes')
  })

  it('edits label and emphasis', () => {
    const onUpdate = vi.fn()
    render(<ButtonSection block={btn()} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Go' } })
    expect(onUpdate).toHaveBeenCalledWith({ label: 'Go' })
    fireEvent.click(screen.getByRole('button', { name: 'Secondary' }))
    expect(onUpdate).toHaveBeenCalledWith({ emphasis: 'secondary' })
  })

  it('size is per device with fallback md', () => {
    useFormDocumentStore.getState().setActiveBreakpoint('phone')
    const onUpdate = vi.fn()
    render(<ButtonSection block={btn()} onUpdate={onUpdate} />)
    expect((screen.getByLabelText(/size/i) as HTMLSelectElement).value).toBe('md')
    fireEvent.change(screen.getByLabelText(/size/i), { target: { value: 'lg' } })
    expect(onUpdate).toHaveBeenCalledWith({ sizeAt: { phone: 'lg' } })
  })
})
