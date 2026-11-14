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
// User rulings 2026-11-14 (FormKit spec Appendix X): renderer side.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import type { Block, FormDocument, FormEvent } from '@mission/form-schema'
import { FormDocumentView } from '../FormDocumentView'
import { StepButtonBar } from '../StepButtonBar'
import { blockLayoutStyle } from '../blockClasses'
import type { ButtonJobs } from '../context'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function docWith(blocks: Block[]): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}

const JOBS: ButtonJobs = {
  continue: { enabled: true, label: 'Continue' },
  yes: { enabled: true, label: 'Yes' },
  no: { enabled: true, label: 'No' },
  signed: false,
}

const css = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8')

describe('X.2 a timer records its elapsed seconds in its field', () => {
  const TIMER = { id: 'tm', type: 'timer', label: 'Cure', fieldName: 'cure', durationSeconds: 3, direction: 'countdown' } as const

  it('a timer that runs out sets its field to the duration', () => {
    vi.useFakeTimers()
    const events: FormEvent[] = []
    render(<FormDocumentView document={docWith([TIMER])} onEvent={(e) => events.push(e)} />)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(events).toContainEqual({ kind: 'fieldChange', fieldName: 'cure', value: '3' })
  })

  it('a stopped timer sets its field to the seconds run, and the last validation counts it settled', () => {
    vi.useFakeTimers()
    const events: FormEvent[] = []
    const blockDone = { ...TIMER, blockDone: true }
    const { getByRole } = render(<FormDocumentView document={docWith([blockDone])} onEvent={(e) => events.push(e)} />)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    fireEvent.click(getByRole('button', { name: 'Stop' }))
    expect(events).toContainEqual({ kind: 'fieldChange', fieldName: 'cure', value: '1' })
    const validations = events.filter((e) => e.kind === 'validation')
    expect(validations[validations.length - 1]).toEqual({ kind: 'validation', ok: true, missing: [] })
  })
})

describe('X.1 minimum height and maximum width are drawn', () => {
  it('blockLayoutStyle maps tokens, rem and ch to custom properties', () => {
    expect(blockLayoutStyle(undefined)).toBeUndefined()
    expect(blockLayoutStyle({ span: { base: 6 } })).toBeUndefined()
    expect(blockLayoutStyle({ minHeight: 'lg' })).toEqual({ '--tfk-block-min-h': 'var(--form-space-lg)' })
    expect(blockLayoutStyle({ minHeight: { rem: 12.5 }, maxWidth: { ch: 60 } })).toEqual({
      '--tfk-block-min-h': '12.5rem',
      '--tfk-block-max-w': '60ch',
    })
    expect(blockLayoutStyle({ maxWidth: { rem: 20 } })).toEqual({ '--tfk-block-max-w': '20rem' })
  })

  it('the block cell carries the properties and markers layout.css reads', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 't', type: 'textarea', fieldName: 'notes', layout: { minHeight: { rem: 10 }, maxWidth: { ch: 40 } } },
          { id: 'u', type: 'text', content: 'plain' },
        ])}
      />,
    )
    const cell = container.querySelector('[data-block-id="t"]') as HTMLElement
    expect(cell.style.getPropertyValue('--tfk-block-min-h')).toBe('10rem')
    expect(cell.style.getPropertyValue('--tfk-block-max-w')).toBe('40ch')
    expect(cell.hasAttribute('data-min-height')).toBe(true)
    expect(cell.hasAttribute('data-max-width')).toBe(true)
    const plain = container.querySelector('[data-block-id="u"]') as HTMLElement
    expect(plain.getAttribute('style')).toBeNull()
    expect(plain.hasAttribute('data-min-height')).toBe(false)
  })

  it('layout.css applies them to the block content, never to the cell display', () => {
    const s = css('layout.css')
    expect(s).toContain('.tfk-block[data-min-height] > * { min-height: var(--tfk-block-min-h); }')
    expect(s).toContain('.tfk-block[data-max-width] > * { max-width: var(--tfk-block-max-w); }')
    expect(s).toContain('.tfk-block[data-min-height] .tfk-field > textarea.tfk-control { flex: 1 1 auto; }')
    expect(s).not.toMatch(/\.tfk-block\[data-[a-z-]+\]\s*\{[^}]*display/)
  })
})

describe('N2 order 0 is automatic', () => {
  it('every tier has an order-0 class', () => {
    const s = css('layout.css')
    expect(s).toContain('.tfk-order-base-0 { order: 0; }')
    expect(s).toContain('.tfk-order-tablet-0 { order: 0; }')
    expect(s).toContain('.tfk-order-phone-0 { order: 0; }')
  })
})

describe('N1 the fixed row is opaque', () => {
  it('the step bar paints the form surface', () => {
    expect(css('layout.css')).toMatch(/\.tfk-step-bar \{[^}]*background: var\(--form-color-surface\);/)
  })
})

describe('X.11 the host can decide where Back and Stop go', () => {
  const back = { onBack: () => {}, disabled: false }
  const stop = { onStop: () => {}, disabled: false }

  it('compact = true leaves Back and Stop out of the bar', () => {
    const { queryByRole, container } = render(
      <StepButtonBar kind="continue" barStyle={{}} jobs={JOBS} onPress={() => {}} back={back} stop={stop} compact />,
    )
    expect(queryByRole('button', { name: 'Back' })).toBeNull()
    expect(queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(container.querySelector('.tfk-step-bar')!.getAttribute('data-compact')).toBe('true')
  })

  it('compact = false keeps them and turns the bar’s own width rule off', () => {
    const { getByRole, container } = render(
      <StepButtonBar kind="continue" barStyle={{}} jobs={JOBS} onPress={() => {}} back={back} stop={stop} compact={false} />,
    )
    getByRole('button', { name: 'Back' })
    getByRole('button', { name: 'Stop' })
    expect(container.querySelector('.tfk-step-bar')!.getAttribute('data-compact')).toBe('false')
    expect(css('layout.css')).toContain('.tfk-step-bar:not([data-compact]) .tfk-step-bar-left')
  })

  it('no compact = the bar decides by its own width, as before', () => {
    const { container } = render(<StepButtonBar kind="continue" barStyle={{}} jobs={JOBS} onPress={() => {}} back={back} />)
    expect(container.querySelector('.tfk-step-bar')!.hasAttribute('data-compact')).toBe(false)
  })
})

describe('X.7 a host can disable job-less buttons', () => {
  const plain = { id: 'p', type: 'button', label: 'Approve', outputValue: 'approve' } as const

  it('actionsEnabled false draws a job-less button disabled and it emits nothing', () => {
    const onEvent = vi.fn()
    const { getByRole } = render(
      <FormDocumentView document={docWith([plain])} buttonJobs={{ ...JOBS, actionsEnabled: false }} onEvent={onEvent} />,
    )
    const b = getByRole('button', { name: 'Approve' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    fireEvent.click(b)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('absent actionsEnabled keeps the old behaviour', () => {
    const onEvent = vi.fn()
    const { getByRole } = render(<FormDocumentView document={docWith([plain])} buttonJobs={JOBS} onEvent={onEvent} />)
    fireEvent.click(getByRole('button', { name: 'Approve' }))
    expect(onEvent).toHaveBeenCalledWith({ kind: 'action', blockId: 'p', outputValue: 'approve' })
  })
})

describe('X.8 required is announced', () => {
  it('a required combo box sets aria-required', () => {
    const { getByRole } = render(
      <FormDocumentView
        document={docWith([
          { id: 'c', type: 'textInput', fieldName: 'lot', label: 'Lot', inputMode: 'combobox', required: true, listItems: [] },
        ])}
      />,
    )
    expect(getByRole('combobox').getAttribute('aria-required')).toBe('true')
  })

  it('an unlabeled required group gets a hidden "Required" legend; an optional one gets none', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 'g1', type: 'radio', fieldName: 'a', required: true, options: [{ label: 'One', value: '1' }] },
          { id: 'g2', type: 'checkbox', fieldName: 'b', options: [{ label: 'Two', value: '2' }] },
        ])}
      />,
    )
    const legend = container.querySelector('[data-block-id="g1"] legend')!
    expect(legend.textContent).toBe('Required')
    expect(legend.className).toBe('tfk-sr-only')
    expect(container.querySelector('[data-block-id="g2"] legend')).toBeNull()
  })
})
