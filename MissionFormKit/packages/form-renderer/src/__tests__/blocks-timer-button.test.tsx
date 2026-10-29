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
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { FormDocumentView } from '../FormDocumentView'
import type { FormDocument, FormEvent } from '@mission/form-schema'

function docWith(blocks: FormDocument['sections'][0]['rows'][0]['blocks']): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}

const TIMER = { id: 'tm', type: 'timer', label: 'Cure', fieldName: 'cure', durationSeconds: 3, direction: 'countdown' } as const

afterEach(() => {
  vi.useRealTimers()
})

describe('timer block', () => {
  it('Stop clears the interval instead of leaving it ticking for the mount lifetime', () => {
    // The settledRef guard already freezes the display, so every other timer test passes
    // whether or not stop() clears the interval — this is the one that can tell.
    vi.useFakeTimers()
    const { getByRole } = render(<FormDocumentView document={docWith([TIMER])} />)
    expect(vi.getTimerCount()).toBe(1)
    fireEvent.click(getByRole('button', { name: 'Stop' }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('run mode: auto-starts, counts down, emits running then elapsed', () => {
    vi.useFakeTimers()
    const events: FormEvent[] = []
    const { container } = render(
      <FormDocumentView document={docWith([TIMER])} onEvent={(e) => events.push(e)} />,
    )
    expect(events).toContainEqual({ kind: 'timerState', fieldName: 'cure', state: 'running', elapsedSeconds: 0 })
    expect(container.querySelector('.tfk-timer-display')!.textContent).toBe('00:03')
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(container.querySelector('.tfk-timer-display')!.textContent).toBe('00:00')
    expect(events).toContainEqual({ kind: 'timerState', fieldName: 'cure', state: 'elapsed', elapsedSeconds: 3 })
  })

  it('Stop emits stopped with the elapsed seconds and freezes the display', () => {
    vi.useFakeTimers()
    const events: FormEvent[] = []
    const { container, getByRole } = render(
      <FormDocumentView document={docWith([TIMER])} onEvent={(e) => events.push(e)} />,
    )
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    fireEvent.click(getByRole('button', { name: 'Stop' }))
    expect(events).toContainEqual({ kind: 'timerState', fieldName: 'cure', state: 'stopped', elapsedSeconds: 1 })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(container.querySelector('.tfk-timer-display')!.textContent).toBe('00:02')
  })

  it('edit mode: static full-duration display, no ticking, no events', () => {
    vi.useFakeTimers()
    const onEvent = vi.fn()
    const { container } = render(<FormDocumentView document={docWith([TIMER])} mode="edit" onEvent={onEvent} />)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(container.querySelector('.tfk-timer-display')!.textContent).toBe('00:03')
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('edit mode: Stop still renders (spec §5 parity) but cannot emit', () => {
    const onEvent = vi.fn()
    const { container, getByRole, queryByRole } = render(
      <FormDocumentView document={docWith([TIMER])} mode="edit" onEvent={onEvent} />,
    )
    // The designer must lay out against the real timer height, so the button renders.
    // What neutralises it in a browser is the wrapper's `inert`; jsdom does not implement
    // inert's click blocking, so clicking here asserts the guarantee that holds in every
    // environment: the provider refuses to emit outside run mode.
    expect(container.querySelector('[data-block-id="tm"]')!.hasAttribute('inert')).toBe(true)
    fireEvent.click(getByRole('button', { name: 'Stop' }))
    expect(onEvent).not.toHaveBeenCalled()
    // Parity invariant, not just the event invariant: the click must not unmount the button
    // either. jsdom doesn't block the click, so this exercises the component's own mode guard.
    expect(queryByRole('button', { name: 'Stop' })).toBeTruthy()
  })
})

describe('button block', () => {
  it('emits action with blockId and outputValue; emphasis maps to the class', () => {
    const events: FormEvent[] = []
    const { getByRole } = render(
      <FormDocumentView
        document={docWith([{ id: 'bt', type: 'button', label: 'Retry', outputValue: 'retry', emphasis: 'secondary' }])}
        onEvent={(e) => events.push(e)}
      />,
    )
    const button = getByRole('button', { name: 'Retry' })
    expect(button.className).toContain('tfk-button-secondary')
    fireEvent.click(button)
    expect(events).toContainEqual({ kind: 'action', blockId: 'bt', outputValue: 'retry' })
  })

  it('authored color overrides the background inline', () => {
    const { getByRole } = render(
      <FormDocumentView
        document={docWith([{ id: 'bt', type: 'button', label: 'Go', outputValue: 'go', color: '#16a34a' }])}
      />,
    )
    expect((getByRole('button', { name: 'Go' }) as HTMLElement).style.background).toContain('rgb(22, 163, 74)')
  })
})

describe('job buttons', () => {
  const btn = (extra: object) =>
    ({ id: 'b1', type: 'button', label: '', outputValue: 'continue', ...extra }) as never
  const run = (block: object, buttonJobs?: import('../context').FormRendererContextValue['buttonJobs']) => {
    const events: FormEvent[] = []
    const r = render(
      <FormDocumentView document={docWith([btn(block)])} buttonJobs={buttonJobs ?? undefined} onEvent={(e) => events.push(e)} />,
    )
    return { ...r, events, button: r.container.querySelector('button') as HTMLButtonElement }
  }
  const jobs = (over: object = {}) => ({
    continue: { enabled: true, label: 'Continue' },
    yes: { enabled: true, label: 'Yes' },
    no: { enabled: true, label: 'No' },
    signed: false,
    ...over,
  })

  it('job-less button renders its label and emits action', () => {
    const { button, events } = run({ label: 'Go', outputValue: 'go' })
    expect(button.textContent).toBe('Go')
    fireEvent.click(button)
    expect(events).toEqual([{ kind: 'action', blockId: 'b1', outputValue: 'go' }])
  })
  it('continue with no buttonJobs uses the default word, enabled', () => {
    const { button } = run({ job: 'continue' })
    expect(button.textContent).toBe('Continue')
    expect(button.disabled).toBe(false)
  })
  it('host state drives label, disabled, aria', () => {
    const { button } = run(
      { job: 'continue' },
      jobs({ continue: { enabled: false, label: 'Save batch', describedBy: 'm1' } }),
    )
    expect(button.textContent).toBe('Save batch')
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-describedby')).toBe('m1')
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+Enter')
  })
  it('signed prefixes the label', () => {
    const { button } = run(
      { job: 'continue' },
      jobs({ continue: { enabled: true, label: 'Save batch' }, signed: true }),
    )
    expect(button.textContent).toBe('Sign & Save batch')
  })
  it('No is never signed', () => {
    const { button } = run({ job: 'no', label: 'Reject' }, jobs({ signed: true }))
    expect(button.textContent).toBe('Reject')
  })
  it('typed label wins over host label', () => {
    const { button } = run({ job: 'yes', label: 'Approve' }, jobs())
    expect(button.textContent).toBe('Approve')
  })
  it('click emits job, not action; disabled emits nothing', () => {
    const a = run({ job: 'yes' }, jobs())
    fireEvent.click(a.button)
    expect(a.events).toEqual([{ kind: 'job', blockId: 'b1', job: 'yes' }])
    const b = run({ job: 'yes' }, jobs({ yes: { enabled: false, label: 'Yes' } }))
    fireEvent.click(b.button)
    expect(b.events).toEqual([])
  })
  it('a disabled job button does not apply the authored background; an enabled one does', () => {
    const off = run({ job: 'continue', color: '#16a34a' }, jobs({ continue: { enabled: false, label: 'Continue' } }))
    expect(off.button.disabled).toBe(true)
    expect(off.button.style.background).toBe('')
    const on = run({ job: 'continue', color: '#16a34a' }, jobs())
    expect(on.button.style.background).toContain('rgb(22, 163, 74)')
  })
  it('size class only when authored', () => {
    expect(run({ size: 'xl' }).button.className).toContain('tfk-size-xl')
    expect(run({}).button.className).not.toContain('tfk-size-')
  })
})
