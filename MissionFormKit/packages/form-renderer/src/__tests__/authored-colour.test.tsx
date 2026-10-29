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
import { render } from '@testing-library/react'
import { FormDocumentView } from '../FormDocumentView'
import { isContextualColor } from '../blocks/common'
import type { FormDocument } from '@mission/form-schema'

function docWith(blocks: FormDocument['sections'][0]['rows'][0]['blocks']): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}

const DARK = 'rgb(19, 28, 46)'
const WHITE = 'rgb(255, 255, 255)'

// Designer's default text colour on every authored block kind the spec names.
const ALL = docWith([
  { id: 't', type: 'text', content: 'x', color: '#1e293b' },
  { id: 'h', type: 'header', content: 'x', color: '#1e293b' },
  { id: 'b', type: 'button', label: 'Go', outputValue: 'go', color: '#1e293b' },
  { id: 'd', type: 'divider', weight: 'hairline', color: '#1e293b' },
])

function styles(container: HTMLElement) {
  const q = (sel: string) => container.querySelector<HTMLElement>(sel)!
  return {
    text: q('[data-block-id="t"] .tfk-text').style.color,
    header: q('[data-block-id="h"] h2').style.color,
    button: q('[data-block-id="b"] button').style.background,
    divider: q('[data-block-id="d"] hr').style.borderTopColor,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('authored colours (spec §14, R6)', () => {
  it('without a surface, every authored colour is drawn as before (Designer passes none)', () => {
    const { container } = render(<FormDocumentView document={ALL} />)
    expect(styles(container)).toEqual({
      text: 'rgb(30, 41, 59)',
      header: 'rgb(30, 41, 59)',
      button: 'rgb(30, 41, 59)',
      divider: 'rgb(30, 41, 59)',
    })
  })

  it('on a dark surface, colours below 3:1 are dropped on all four block kinds', () => {
    const { container } = render(<FormDocumentView document={ALL} surfaceColor={DARK} />)
    expect(styles(container)).toEqual({ text: '', header: '', button: '', divider: '' })
  })

  it('on a light surface the same colours are kept', () => {
    const { container } = render(<FormDocumentView document={ALL} surfaceColor={WHITE} />)
    expect(styles(container).text).toBe('rgb(30, 41, 59)')
    expect(styles(container).button).toBe('rgb(30, 41, 59)')
  })

  it('a surface change re-judges without a remount', () => {
    const view = render(<FormDocumentView document={ALL} surfaceColor={WHITE} />)
    expect(styles(view.container).header).toBe('rgb(30, 41, 59)')
    view.rerender(<FormDocumentView document={ALL} surfaceColor={DARK} />)
    expect(styles(view.container).header).toBe('')
    view.rerender(<FormDocumentView document={ALL} surfaceColor={WHITE} />)
    expect(styles(view.container).header).toBe('rgb(30, 41, 59)')
  })

  it('a named colour is judged by what the browser resolves it to', () => {
    const real = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = real(el, pseudo)
      if ((el as HTMLElement).style.color === 'black') {
        return { ...style, color: 'rgb(0, 0, 0)' } as CSSStyleDeclaration
      }
      return style
    })
    const { container } = render(
      <FormDocumentView document={docWith([{ id: 't', type: 'text', content: 'x', color: 'black' }])} surfaceColor={DARK} />,
    )
    expect(container.querySelector<HTMLElement>('[data-block-id="t"] .tfk-text')!.style.color).toBe('')
  })
})

describe('colours on selected text inside a block (final review)', () => {
  const RICH = '<p>Plain <span style="color: #1e293b">dark</span> and <span style="color: #ffff00; font-weight: bold">yellow</span></p>'
  const spans = (container: HTMLElement, sel: string) =>
    [...container.querySelectorAll<HTMLElement>(`${sel} span`)].map((s) => s.style.color)

  it('without a surface, inline span colours are drawn as authored', () => {
    const { container } = render(<FormDocumentView document={docWith([{ id: 't', type: 'text', content: RICH }])} />)
    expect(spans(container, '[data-block-id="t"]')).toEqual(['rgb(30, 41, 59)', 'rgb(255, 255, 0)'])
  })

  it('on a dark surface, an unreadable inline colour is dropped and a readable one kept — text and header', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 't', type: 'text', content: RICH },
          { id: 'h', type: 'header', content: RICH },
        ])}
        surfaceColor={DARK}
      />,
    )
    expect(spans(container, '[data-block-id="t"]')).toEqual(['', 'rgb(255, 255, 0)'])
    expect(spans(container, '[data-block-id="h"]')).toEqual(['', 'rgb(255, 255, 0)'])
    // Only the colour goes: other inline styling and the text stay.
    const yellow = container.querySelectorAll<HTMLElement>('[data-block-id="t"] span')[1]!
    expect(yellow.style.fontWeight).toBe('bold')
    expect(container.querySelector('[data-block-id="t"]')!.textContent).toBe('Plain dark and yellow')
  })
})

describe('context-dependent colours (final review minor)', () => {
  it('currentColor, inherit and var() are never resolved through the probe, so a mode flip cannot leave a stale answer', () => {
    // Whatever the probe would report, these follow their context, not the author's palette.
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ color: 'rgb(0, 0, 0)' } as CSSStyleDeclaration)
    const doc = docWith([
      { id: 'a', type: 'text', content: 'x', color: 'currentColor' },
      { id: 'b', type: 'text', content: 'x', color: 'inherit' },
      { id: 'c', type: 'text', content: 'x', color: 'var(--brand)' },
    ])
    const { container } = render(<FormDocumentView document={doc} surfaceColor={DARK} />)
    const colour = (id: string) => container.querySelector<HTMLElement>(`[data-block-id="${id}"] .tfk-text`)!.style.color
    expect(colour('a').toLowerCase()).toBe('currentcolor')
    expect(colour('b')).toBe('inherit')
    expect(colour('c')).toBe('var(--brand)')
  })
})

describe('isContextualColor (review)', () => {
  it('light/dark, system-palette and currentColor mixes are contextual; plain colours are not', () => {
    for (const v of ['light-dark(#000000, #ffffff)', 'Canvas', 'CanvasText', 'color-mix(in srgb, currentColor 50%, red)', 'currentColor', 'inherit', 'var(--x)'])
      expect(isContextualColor(v), v).toBe(true)
    for (const v of ['black', 'rebeccapurple', '#1e293b', 'rgb(0, 0, 0)', 'hsl(0 0% 0%)'])
      expect(isContextualColor(v), v).toBe(false)
  })
})
