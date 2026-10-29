// @vitest-environment jsdom
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
import { render, fireEvent } from '@testing-library/react'
import { FormDocumentView } from '../FormDocumentView'
import type { FormDocument, FormEvent } from '@mission/form-schema'

function docWith(blocks: FormDocument['sections'][0]['rows'][0]['blocks']): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}

describe('textInput block', () => {
  it('renders a real input with stacked label, controlled value, and emits fieldChange', () => {
    const events: FormEvent[] = []
    const { container } = render(
      <FormDocumentView
        document={docWith([{ id: 'b1', type: 'textInput', fieldName: 'serial', label: 'Serial', required: true }])}
        values={{ serial: 'SN-1' }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const input = container.querySelector<HTMLInputElement>('#b1-control')!
    expect(input.tagName).toBe('INPUT')
    expect(input.value).toBe('SN-1')
    const label = container.querySelector('label[for="b1-control"]')!
    expect(label.textContent).toContain('Serial')
    expect(label.querySelector('.tfk-required')).not.toBeNull()
    fireEvent.change(input, { target: { value: 'SN-2' } })
    expect(events).toContainEqual({ kind: 'fieldChange', fieldName: 'serial', value: 'SN-2' })
  })

  it('number mode refuses text that can never be a number and flags an unfinished one', () => {
    const events: FormEvent[] = []
    const doc = docWith([{ id: 'n', type: 'textInput', fieldName: 'qty', label: 'Qty', inputMode: 'number' }])
    const { container, rerender } = render(<FormDocumentView document={doc} values={{ qty: '12' }} onEvent={(e) => events.push(e)} />)
    const input = container.querySelector<HTMLInputElement>('#n-control')!
    fireEvent.change(input, { target: { value: '12a' } })
    expect(events.filter((e) => e.kind === 'fieldChange')).toEqual([])
    expect(input.value).toBe('12')
    fireEvent.change(input, { target: { value: '12.5' } })
    expect(events).toContainEqual({ kind: 'fieldChange', fieldName: 'qty', value: '12.5' })
    expect(container.querySelector('.tfk-error')).toBeNull()

    rerender(<FormDocumentView document={doc} values={{ qty: '-' }} onEvent={(e) => events.push(e)} />)
    expect(container.querySelector('#n-error')!.textContent).toBe('Enter a number')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('n-error')
  })

  it('text mode accepts any text', () => {
    const events: FormEvent[] = []
    const { container } = render(
      <FormDocumentView document={docWith([{ id: 'b1', type: 'textInput', fieldName: 'serial' }])} onEvent={(e) => events.push(e)} />,
    )
    fireEvent.change(container.querySelector<HTMLInputElement>('#b1-control')!, { target: { value: 'abc' } })
    expect(events).toContainEqual({ kind: 'fieldChange', fieldName: 'serial', value: 'abc' })
  })

  it('maps inputMode to control semantics: password type, tel type, numeric inputmode, dropdown select, combobox datalist', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 'p', type: 'textInput', fieldName: 'pw', inputMode: 'password' },
          { id: 't', type: 'textInput', fieldName: 'tel', inputMode: 'phone' },
          { id: 'n', type: 'textInput', fieldName: 'num', inputMode: 'number' },
          { id: 'd', type: 'textInput', fieldName: 'pick', inputMode: 'dropdown', listItems: [{ label: 'One', value: '1' }] },
          { id: 'c', type: 'textInput', fieldName: 'combo', inputMode: 'combobox', listItems: [{ label: 'Two', value: '2' }] },
        ])}
      />,
    )
    expect(container.querySelector<HTMLInputElement>('#p-control')!.type).toBe('password')
    expect(container.querySelector<HTMLInputElement>('#t-control')!.type).toBe('tel')
    expect(container.querySelector<HTMLInputElement>('#n-control')!.getAttribute('inputmode')).toBe('numeric')
    const select = container.querySelector<HTMLSelectElement>('#d-control')!
    expect(select.tagName).toBe('SELECT')
    expect([...select.options].map((o) => o.value)).toEqual(['', '1'])
    const combo = container.querySelector<HTMLInputElement>('#c-control')!
    expect(combo.getAttribute('list')).toBe('c-list')
    expect(container.querySelector('datalist#c-list option')!.getAttribute('value')).toBe('2')
  })

  it('dropdown change emits fieldChange with the option value', () => {
    const events: FormEvent[] = []
    const { container } = render(
      <FormDocumentView
        document={docWith([{ id: 'd', type: 'textInput', fieldName: 'pick', inputMode: 'dropdown', listItems: [{ label: 'One', value: '1' }] }])}
        onEvent={(e) => events.push(e)}
      />,
    )
    fireEvent.change(container.querySelector('#d-control')!, { target: { value: '1' } })
    expect(events).toContainEqual({ kind: 'fieldChange', fieldName: 'pick', value: '1' })
  })

  it('no events fire in edit mode', () => {
    const onEvent = vi.fn()
    const { container } = render(
      <FormDocumentView
        document={docWith([{ id: 'b1', type: 'textInput', fieldName: 'serial' }])}
        mode="edit"
        onEvent={onEvent}
      />,
    )
    fireEvent.change(container.querySelector('#b1-control')!, { target: { value: 'x' } })
    expect(onEvent).not.toHaveBeenCalled()
  })
})

describe('textarea block', () => {
  it('renders a textarea with rows and emits fieldChange', () => {
    const events: FormEvent[] = []
    const { container } = render(
      <FormDocumentView
        document={docWith([{ id: 'ta', type: 'textarea', fieldName: 'notes', label: 'Notes', rows: 6 }])}
        onEvent={(e) => events.push(e)}
      />,
    )
    const area = container.querySelector<HTMLTextAreaElement>('#ta-control')!
    expect(area.tagName).toBe('TEXTAREA')
    expect(area.rows).toBe(6)
    fireEvent.change(area, { target: { value: 'hello' } })
    expect(events).toContainEqual({ kind: 'fieldChange', fieldName: 'notes', value: 'hello' })
  })
})
