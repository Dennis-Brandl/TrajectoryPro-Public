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
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { TaskMenu } from '../TaskMenu'

afterEach(cleanup)

function setup(onSelect = vi.fn()) {
  render(
    <TaskMenu
      items={[
        { label: 'One', onSelect },
        { label: 'Two', onSelect, disabled: true },
        { label: 'Three', onSelect },
      ]}
    />,
  )
  const trigger = screen.getByRole('button', { name: 'More actions' })
  return { trigger, onSelect }
}

describe('TaskMenu', () => {
  it('is closed until the trigger is clicked', () => {
    const { trigger } = setup()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens with items in order, focuses the first, portalled to body', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect(menu.parentElement).toBe(document.body)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['One', 'Two', 'Three'])
    expect(document.activeElement).toBe(items[0])
  })

  it('ArrowDown skips disabled items and wraps; ArrowUp goes back', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    const items = screen.getAllByRole('menuitem')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[2])
  })

  it('Escape closes and focuses the trigger', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('an outside pointer-down closes it', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('choosing an item closes the menu and calls onSelect with the trigger', () => {
    const { trigger, onSelect } = setup()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Three' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onSelect).toHaveBeenCalledWith(trigger)
  })

  it('focus is on the trigger when onSelect runs, so a sheet opened from it returns there', () => {
    let focusedAtSelect: Element | null = null
    const { trigger } = setup(vi.fn(() => (focusedAtSelect = document.activeElement)))
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'One' }))
    expect(focusedAtSelect).toBe(trigger)
    expect(document.activeElement).toBe(trigger)
  })
})
