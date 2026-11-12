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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { StepButtonBar, type StepButtonBarProps } from '../StepButtonBar'
import { FormRendererContext, type ButtonJobs } from '../context'

afterEach(cleanup)

function jobs(over: Partial<ButtonJobs> = {}): ButtonJobs {
  return {
    continue: { enabled: true, label: 'Weigh done' },
    yes: { enabled: true, label: 'Yes' },
    no: { enabled: true, label: 'No' },
    signed: false,
    ...over,
  }
}

function bar(over: Partial<StepButtonBarProps> = {}) {
  const onPress = vi.fn()
  const utils = render(<StepButtonBar kind="continue" barStyle={{}} jobs={jobs()} onPress={onPress} {...over} />)
  return { onPress, ...utils }
}

describe('StepButtonBar', () => {
  it('continue step shows one centered button with the authored text and color', () => {
    const { onPress, getAllByRole, getByRole } = bar({ barStyle: { color: '#112233' } })
    expect(getAllByRole('button')).toHaveLength(1)
    const b = getByRole('button', { name: 'Weigh done' })
    expect(b.style.background).toBe('rgb(17, 34, 51)')
    fireEvent.click(b)
    expect(onPress).toHaveBeenCalledWith('continue')
  })

  it('yes/no step shows Yes then No with their own colors', () => {
    const { onPress, getAllByRole } = bar({ kind: 'yesno', barStyle: { yesColor: '#00ff00', noColor: '#ff0000' } })
    const [yes, no] = getAllByRole("button") as [HTMLElement, HTMLElement]
    expect(yes.textContent).toBe('Yes')
    expect(no.textContent).toBe('No')
    expect(yes.style.background).toBe('rgb(0, 255, 0)')
    expect(no.style.background).toBe('rgb(255, 0, 0)')
    fireEvent.click(yes)
    fireEvent.click(no)
    expect(onPress.mock.calls).toEqual([['yes'], ['no']])
  })

  it('disabled job is disabled', () => {
    const { getByRole } = bar({ jobs: jobs({ continue: { enabled: false, label: 'Weigh done' } }) })
    expect((getByRole('button', { name: 'Weigh done' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('back and stop render only when given', () => {
    const none = bar()
    expect(none.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(none.queryByRole('button', { name: 'Stop' })).toBeNull()
    cleanup()
    const onBack = vi.fn()
    const onStop = vi.fn()
    const { getByRole, container } = bar({ back: { onBack, disabled: false }, stop: { onStop, disabled: false } })
    const back = getByRole('button', { name: 'Back' })
    const stop = getByRole('button', { name: 'Stop' })
    expect(back.className).toContain('tfk-step-bar-aux')
    expect(container.querySelector('.tfk-step-bar')?.firstElementChild?.contains(back)).toBe(true)
    expect(container.querySelector('.tfk-step-bar')?.lastElementChild?.contains(stop)).toBe(true)
    fireEvent.click(back)
    fireEvent.click(stop)
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onStop).toHaveBeenCalledTimes(1)
    cleanup()
    const d = bar({ back: { onBack, disabled: true }, stop: { onStop, disabled: true } })
    expect((d.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
    expect((d.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('signed step prefixes Sign &', () => {
    const { getByRole } = bar({ jobs: jobs({ signed: true }) })
    expect(getByRole('button', { name: 'Sign & Weigh done' })).toBeTruthy()
  })

  it('main slot is pinned to the middle column so it stays centered when the aux slots hide', () => {
    const { container } = bar()
    expect(container.querySelector('.tfk-step-bar-main')).toBeTruthy()
    const css = readFileSync(resolve(__dirname, '../layout.css'), 'utf8')
    expect(css).toMatch(/\.tfk-step-bar-main\s*\{[^}]*grid-column:\s*2/)
  })

  it('the bar container has no horizontal padding, so it hides Back/Stop at the same width as the Pilot topline', () => {
    const { container } = bar({ back: { onBack: () => {}, disabled: false }, stop: { onStop: () => {}, disabled: false } })
    const outer = container.querySelector('.tfk-step-bar') as HTMLElement
    const inner = outer.querySelector(':scope > .tfk-step-bar-inner') as HTMLElement
    expect(inner).toBeTruthy()
    expect(outer.children).toHaveLength(1)
    expect(inner.querySelector('.tfk-step-bar-back')).toBeTruthy()
    expect(inner.querySelector('.tfk-step-bar-stop')).toBeTruthy()
    const css = readFileSync(resolve(__dirname, '../layout.css'), 'utf8')
    const outerRule = css.match(/\.tfk-step-bar\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(outerRule).toMatch(/container-type:\s*inline-size/)
    expect(outerRule).not.toMatch(/padding/)
    const innerRule = css.match(/\.tfk-step-bar-inner\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(innerRule).toMatch(/padding:/)
    expect(innerRule).toMatch(/grid-template-columns/)
  })

  it('a low-contrast authored color is dropped like on a form button', () => {
    const ctx = {
      mode: 'run' as const,
      values: {},
      resolveImage: () => undefined,
      emit: () => {},
      signature: null,
      signatureError: null,
      signatureHint: null,
      buttonJobs: null,
    }
    const view = (surface: string | null, color: string) =>
      render(
        <FormRendererContext.Provider value={{ ...ctx, surfaceColor: surface }}>
          <StepButtonBar kind="continue" barStyle={{ color }} jobs={jobs()} onPress={() => {}} />
        </FormRendererContext.Provider>,
      )
    let v = view('rgb(19, 28, 46)', '#1e293b')
    expect((v.getByRole('button', { name: 'Weigh done' }) as HTMLElement).style.background).toBe('')
    v.unmount()
    v = view('rgb(255, 255, 255)', '#1e293b')
    expect((v.getByRole('button', { name: 'Weigh done' }) as HTMLElement).style.background).toBe('rgb(30, 41, 59)')
  })

  it('surfaceColor prop guards authored colors without an outer provider', () => {
    const v = (surface: string) =>
      render(
        <StepButtonBar kind="continue" barStyle={{ color: '#1e293b' }} jobs={jobs()} onPress={() => {}} surfaceColor={surface} />,
      )
    let r = v('rgb(19, 28, 46)')
    expect((r.getByRole('button', { name: 'Weigh done' }) as HTMLElement).style.background).toBe('')
    r.unmount()
    r = v('rgb(255, 255, 255)')
    expect((r.getByRole('button', { name: 'Weigh done' }) as HTMLElement).style.background).toBe('rgb(30, 41, 59)')
  })
})
