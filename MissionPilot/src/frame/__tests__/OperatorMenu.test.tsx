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
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { OperatorMenu, type OperatorMenuProps } from '../OperatorMenu'

afterEach(cleanup)

function renderMenu(over: Partial<OperatorMenuProps> = {}) {
  const props: OperatorMenuProps = {
    name: 'John Adams',
    away: false,
    onToggleAway: vi.fn(),
    onSignOut: vi.fn(),
    prefs: { mode: null, textScale: 1, layout: 'standard' },
    onPrefsChange: vi.fn(),
    ...over,
  }
  const view = render(<OperatorMenu {...props} />)
  return { props, rerender: (next: Partial<OperatorMenuProps>) => view.rerender(<OperatorMenu {...props} {...next} />) }
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /^John Adams/ }))

describe('OperatorMenu (spec §5.1)', () => {
  it('the menu button names the operator, and says Away while away', () => {
    const { rerender } = renderMenu()
    expect(screen.getByRole('button', { name: 'John Adams' })).toBeTruthy()
    rerender({ away: true })
    expect(screen.getByRole('button', { name: 'John Adams Away' })).toBeTruthy()
  })

  it('an operator who never chose sees Light at 100%', () => {
    renderMenu()
    openMenu()
    expect((screen.getByLabelText('Display') as HTMLSelectElement).value).toBe('light')
    expect((screen.getByLabelText('Text size') as HTMLSelectElement).value).toBe('1')
  })

  it('Away/Back and both display controls work from the menu; a change reports the whole prefs', () => {
    const { props } = renderMenu({ prefs: { mode: 'light', textScale: 1.15, layout: 'standard' } })
    openMenu()
    const menu = screen.getByRole('dialog', { name: 'Operator menu' })
    fireEvent.click(within(menu).getByRole('button', { name: 'Away' }))
    expect(props.onToggleAway).toHaveBeenCalledTimes(1)
    fireEvent.change(within(menu).getByLabelText('Display'), { target: { value: 'dark' } })
    expect(props.onPrefsChange).toHaveBeenLastCalledWith({ mode: 'dark', textScale: 1.15, layout: 'standard' })
    fireEvent.change(within(menu).getByLabelText('Text size'), { target: { value: '1.3' } })
    expect(props.onPrefsChange).toHaveBeenLastCalledWith({ mode: 'light', textScale: 1.3, layout: 'standard' })
  })

  it('Sign Out signs out', () => {
    const { props } = renderMenu()
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))
    expect(props.onSignOut).toHaveBeenCalledTimes(1)
  })

  it('with no choice made, the Display select shows the theme default mode', () => {
    renderMenu({ defaultMode: 'dark' })
    openMenu()
    expect((screen.getByLabelText('Display') as HTMLSelectElement).value).toBe('dark')
  })

  it('Layout: Standard by default; choosing Workstation reports the whole prefs; the hint names 1280 px', () => {
    const { props } = renderMenu()
    openMenu()
    const menu = screen.getByRole('dialog', { name: 'Operator menu' })
    const select = within(menu).getByLabelText('Layout') as HTMLSelectElement
    expect(select.value).toBe('standard')
    expect([...select.options].map((o) => o.textContent)).toEqual(['Standard', 'Workstation'])
    expect(select.getAttribute('aria-describedby')).toBe('layout-hint')
    expect(document.getElementById('layout-hint')!.textContent).toBe(
      'Workstation shows the inbox beside the task on screens 1280 px and wider.',
    )
    fireEvent.change(select, { target: { value: 'workstation' } })
    expect(props.onPrefsChange).toHaveBeenLastCalledWith({ mode: null, textScale: 1, layout: 'workstation' })
  })

  it('while signing out, Sign Out is disabled and reads Signing out…', () => {
    renderMenu({ signingOut: true })
    openMenu()
    const btn = screen.getByRole('button', { name: 'Signing out…' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
