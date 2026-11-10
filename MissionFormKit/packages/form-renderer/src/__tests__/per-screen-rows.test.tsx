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
import { render, act, fireEvent } from '@testing-library/react'
import { FormDocumentView, breakpointForWidth } from '../FormDocumentView'
import type { FormDocument, FormEvent, Section } from '@mission/form-schema'

const t = (id: string) => ({ id, type: 'text' as const, content: id })
const TIMER = { id: 'tm', type: 'timer', label: 'Cure', fieldName: 'cure', durationSeconds: 5, direction: 'countup' } as const

// Desktop: [a b] [c]; tablet: [a] [b c]; phone: [c b a]
const doc = (rowsAt?: Section['rowsAt']): FormDocument => ({
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [
        { id: 'r1', blocks: [t('a'), t('b')] },
        { id: 'r2', blocks: [t('c')] },
      ],
      ...(rowsAt ? { rowsAt } : {}),
    },
  ],
})
const ARRANGED = doc({
  tablet: [
    { id: 't1', blockIds: ['a'] },
    { id: 't2', blockIds: ['b', 'c'] },
  ],
  phone: [{ id: 'p1', blockIds: ['c', 'b', 'a'] }],
})

/** Rows on screen, as "rowId:blockIds". */
function rowsShown(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-row-id]')].map(
    (r) =>
      `${r.getAttribute('data-row-id')}:${[...r.querySelectorAll('[data-block-id]')].map((b) => b.getAttribute('data-block-id')).join('')}`,
  )
}

// jsdom has no layout: fake the viewport width and a ResizeObserver we can fire by hand.
let width = 0
let observerCallback: ((entries: { contentRect: { width: number } }[]) => void) | null = null
function fakeLayout() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: typeof observerCallback) {
        observerCallback = cb
      }
      observe() {}
      disconnect() {
        observerCallback = null
      }
    },
  )
}
function resizeTo(w: number) {
  width = w
  act(() => observerCallback?.([{ contentRect: { width: w } }]))
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  width = 0
  observerCallback = null
})

describe('breakpointForWidth', () => {
  it('matches the layout.css container-query thresholds', () => {
    expect(breakpointForWidth(1024)).toBe('base')
    expect(breakpointForWidth(1023)).toBe('tablet')
    expect(breakpointForWidth(600)).toBe('tablet')
    expect(breakpointForWidth(599)).toBe('phone')
  })
})

describe('per-screen rows', () => {
  it('draws the arrangement of the screen type the host names', () => {
    const base = render(<FormDocumentView document={ARRANGED} breakpoint="base" />)
    expect(rowsShown(base.container)).toEqual(['r1:ab', 'r2:c'])
    base.unmount()
    const tab = render(<FormDocumentView document={ARRANGED} breakpoint="tablet" />)
    expect(rowsShown(tab.container)).toEqual(['t1:a', 't2:bc'])
    tab.unmount()
    const ph = render(<FormDocumentView document={ARRANGED} breakpoint="phone" />)
    expect(rowsShown(ph.container)).toEqual(['p1:cba'])
  })

  it('measures its own width when the host names no screen type, and follows a resize', () => {
    fakeLayout()
    width = 390
    const { container } = render(<FormDocumentView document={ARRANGED} />)
    expect(rowsShown(container)).toEqual(['p1:cba'])
    expect(container.querySelector('.tfk-viewport')?.getAttribute('data-rows-breakpoint')).toBe('phone')
    resizeTo(800)
    expect(rowsShown(container)).toEqual(['t1:a', 't2:bc'])
    resizeTo(1200)
    expect(rowsShown(container)).toEqual(['r1:ab', 'r2:c'])
  })

  it('stays on the desktop rows when there is no width to measure', () => {
    const { container } = render(<FormDocumentView document={ARRANGED} />)
    expect(rowsShown(container)).toEqual(['r1:ab', 'r2:c'])
  })

  it('a form without per-screen rows is not measured and always draws its rows', () => {
    fakeLayout()
    width = 390
    const { container } = render(<FormDocumentView document={doc()} />)
    expect(rowsShown(container)).toEqual(['r1:ab', 'r2:c'])
    expect(HTMLElement.prototype.getBoundingClientRect).not.toHaveBeenCalled()
    expect(observerCallback).toBeNull()
  })

  it('every block is drawn exactly once on every screen', () => {
    for (const bp of ['base', 'tablet', 'phone'] as const) {
      const { container, unmount } = render(<FormDocumentView document={ARRANGED} breakpoint={bp} />)
      const shown = [...container.querySelectorAll('[data-block-id]')].map((b) => b.getAttribute('data-block-id'))
      expect(shown.sort()).toEqual(['a', 'b', 'c'])
      unmount()
    }
  })
})

describe('a timer whose row changes with the screen type', () => {
  const timerDoc: FormDocument = {
    version: 2,
    sections: [
      {
        id: 's1',
        role: 'content',
        rows: [{ id: 'r1', blocks: [t('a'), TIMER] }],
        rowsAt: { phone: [{ id: 'p1', blockIds: ['a'] }, { id: 'p2', blockIds: ['tm'] }] },
      },
    ],
  }
  const display = (c: HTMLElement) => c.querySelector('.tfk-timer-display')?.textContent

  it('keeps counting instead of restarting, and reports running once', () => {
    vi.useFakeTimers()
    fakeLayout()
    width = 1200
    const events: FormEvent[] = []
    const { container } = render(<FormDocumentView document={timerDoc} onEvent={(e) => events.push(e)} />)
    act(() => vi.advanceTimersByTime(2000))
    expect(display(container)).toBe('00:02')
    resizeTo(390) // the timer moves to row p2: a remount
    expect(rowsShown(container)).toEqual(['p1:a', 'p2:tm'])
    expect(display(container)).toBe('00:02')
    act(() => vi.advanceTimersByTime(1000))
    expect(display(container)).toBe('00:03')
    expect(events.filter((e) => e.kind === 'timerState' && e.state === 'running')).toHaveLength(1)
  })

  it('a stopped timer stays stopped after the move', () => {
    vi.useFakeTimers()
    fakeLayout()
    width = 1200
    const events: FormEvent[] = []
    const { container, getByRole } = render(<FormDocumentView document={timerDoc} onEvent={(e) => events.push(e)} />)
    act(() => vi.advanceTimersByTime(2000))
    fireEvent.click(getByRole('button', { name: 'Stop' }))
    resizeTo(390)
    act(() => vi.advanceTimersByTime(3000))
    expect(display(container)).toBe('00:02')
    expect(container.querySelector('.tfk-timer button')).toBeNull()
    expect(events.filter((e) => e.kind === 'timerState' && e.state !== 'running')).toHaveLength(1)
  })
})
