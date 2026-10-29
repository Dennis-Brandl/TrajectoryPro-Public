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
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { FormDocumentView } from '../FormDocumentView'
import type { FormDocument, FormEvent } from '@mission/form-schema'

const OPTIONS = [
  { label: 'Seals', value: 'seals' },
  { label: 'Bolts', value: 'bolts' },
]

function docWith(blocks: FormDocument['sections'][0]['rows'][0]['blocks']): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}

describe('checkbox block', () => {
  it('renders a fieldset of real checkboxes reflecting the value array', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([{ id: 'cb', type: 'checkbox', fieldName: 'checks', label: 'Checks', options: OPTIONS }])}
        values={{ checks: ['bolts'] }}
      />,
    )
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes).toHaveLength(2)
    expect(boxes.map((b) => b.checked)).toEqual([false, true])
    expect(container.querySelector('fieldset.tfk-fieldset')).not.toBeNull()
  })

  it('toggling emits fieldChange with the updated array (add and remove)', () => {
    const events: FormEvent[] = []
    const { container } = render(
      <FormDocumentView
        document={docWith([{ id: 'cb', type: 'checkbox', fieldName: 'checks', options: OPTIONS }])}
        values={{ checks: ['bolts'] }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const [seals, bolts] = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    fireEvent.click(seals!)
    // ['seals','bolts'] — option order, though 'bolts' was ticked first.
    expect(events).toContainEqual({ kind: 'fieldChange', fieldName: 'checks', value: ['seals', 'bolts'] })
    fireEvent.click(bolts!)
    expect(events).toContainEqual({ kind: 'fieldChange', fieldName: 'checks', value: [] })
  })

  it('emits option order, not click order, so the same selection always serialises alike', () => {
    // This array is workflow data landing in a batch record. Two operators ticking the
    // same two boxes in opposite orders must produce the same value, or records that
    // describe identical work compare as different.
    const pick = (already: string, then: number) => {
      const events: FormEvent[] = []
      const { container } = render(
        <FormDocumentView
          document={docWith([{ id: 'cb', type: 'checkbox', fieldName: 'checks', options: OPTIONS }])}
          values={{ checks: [already] }}
          onEvent={(e) => events.push(e)}
        />,
      )
      fireEvent.click([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][then]!)
      // A fieldChange is followed by a validation event, so filter rather than take the last.
      return events.filter((e) => e.kind === 'fieldChange').at(-1)
    }
    const bottsThenSeals = pick('bolts', 0) // had bolts, ticks seals
    const sealsThenBolts = pick('seals', 1) // had seals, ticks bolts
    expect(bottsThenSeals).toMatchObject({ value: ['seals', 'bolts'] })
    expect(sealsThenBolts).toMatchObject({ value: ['seals', 'bolts'] })
  })

  it('names the group with a legend and announces required-ness', () => {
    // The visible '*' is aria-hidden, and a fieldset's 'group' role has no
    // aria-required — so without this the gate blocks a screen-reader user with no
    // stated reason. See docs/BACKLOG.md item 2.
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 'cb', type: 'checkbox', fieldName: 'checks', label: 'Checks', required: true, options: OPTIONS },
        ])}
      />,
    )
    const legend = container.querySelector('fieldset.tfk-fieldset > legend')
    expect(legend).not.toBeNull()
    expect(legend!.textContent).toContain('Checks')
    expect(legend!.querySelector('.tfk-sr-only')?.textContent).toContain('required')
  })
})

describe('radio block', () => {
  it('renders a radio group (shared name), reflects value, emits the picked value', () => {
    const events: FormEvent[] = []
    const { container } = render(
      <FormDocumentView
        document={docWith([{ id: 'rg', type: 'radio', fieldName: 'grade', options: OPTIONS }])}
        values={{ grade: 'seals' }}
        onEvent={(e) => events.push(e)}
      />,
    )
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios).toHaveLength(2)
    expect(new Set(radios.map((r) => r.name))).toEqual(new Set(['rg']))
    expect(radios[0]!.checked).toBe(true)
    fireEvent.click(radios[1]!)
    expect(events).toContainEqual({ kind: 'fieldChange', fieldName: 'grade', value: 'bolts' })
  })

  it('exposes the group as a radiogroup', () => {
    const { container } = render(
      <FormDocumentView document={docWith([{ id: 'rg', type: 'radio', fieldName: 'grade', options: OPTIONS }])} />,
    )
    expect(container.querySelector('fieldset[role="radiogroup"]')).not.toBeNull()
  })
})

describe('required-ness is announced, not just drawn', () => {
  it('marks a required text input aria-required and leaves an optional one unmarked', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 'req', type: 'textInput', fieldName: 'serial', label: 'Serial', required: true },
          { id: 'opt', type: 'textInput', fieldName: 'note', label: 'Note' },
        ])}
      />,
    )
    expect(container.querySelector('#req-control')!.getAttribute('aria-required')).toBe('true')
    expect(container.querySelector('#opt-control')!.hasAttribute('aria-required')).toBe(false)
  })
})

describe('checkbox and radio labels match (spec §14 item 2)', () => {
  const opts = [{ label: 'One', value: '1' }, { label: 'Two', value: '2' }]

  function chain(container: HTMLElement, id: string) {
    const fieldset = container.querySelector(`[data-block-id="${id}"] fieldset`)!
    const option = fieldset.querySelector('label.tfk-option')!
    const legend = fieldset.querySelector('legend')
    return { fieldset: fieldset.className, option: option.className, legend: legend?.className ?? null }
  }

  it.each([undefined, 'xs', 'lg'] as const)('size %s: the same classes on fieldset, legend and option labels', (size) => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 'c', type: 'checkbox', fieldName: 'c', label: 'Pick', options: opts, ...(size ? { size } : {}) },
          { id: 'r', type: 'radio', fieldName: 'r', label: 'Pick', options: opts, ...(size ? { size } : {}) },
        ])}
      />,
    )
    expect(chain(container, 'c')).toEqual(chain(container, 'r'))
  })
})
