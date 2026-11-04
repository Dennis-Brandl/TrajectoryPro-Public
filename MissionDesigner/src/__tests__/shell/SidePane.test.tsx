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

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidePane, SIDE_PANE, clampPaneWidth, treeRowClass } from '@mission/ui'

const KEY = 'mission-side-pane-width'

describe('SidePane', () => {
  beforeEach(() => localStorage.clear())

  it('starts at 256', () => {
    render(<SidePane>x</SidePane>)
    expect((screen.getByTestId('side-pane') as HTMLElement).style.width).toBe('256px')
  })
  it('clamps stored values', () => {
    localStorage.setItem(KEY, '450')
    const { unmount } = render(<SidePane>x</SidePane>)
    expect((screen.getByTestId('side-pane') as HTMLElement).style.width).toBe('400px')
    unmount()
    localStorage.setItem(KEY, '50')
    render(<SidePane>x</SidePane>)
    expect((screen.getByTestId('side-pane') as HTMLElement).style.width).toBe('200px')
  })
  it('dragging updates the stored value', () => {
    render(<SidePane>x</SidePane>)
    const handle = screen.getByRole('separator')
    fireEvent.mouseDown(handle, { clientX: 256 })
    fireEvent.mouseMove(document, { clientX: 300 })
    fireEvent.mouseUp(document)
    expect(localStorage.getItem(KEY)).toBe('300')
    expect((screen.getByTestId('side-pane') as HTMLElement).style.width).toBe('300px')
  })
  it('keeps the resize handle outside the scrolling element', () => {
    render(<SidePane>x</SidePane>)
    const handle = screen.getByRole('separator')
    const aside = screen.getByTestId('side-pane')
    expect(handle.parentElement).toBe(aside)
    expect(aside.className).not.toContain('overflow-auto')
    expect(screen.getByText('x').className).toContain('overflow-auto')
  })
  it('clampPaneWidth', () => {
    expect(clampPaneWidth(NaN)).toBe(SIDE_PANE.default)
    expect(clampPaneWidth(999)).toBe(400)
    expect(clampPaneWidth(1)).toBe(200)
  })
  it('treeRowClass adds selection and depth padding', () => {
    expect(treeRowClass({ selected: true, depth: 1 })).toContain('bg-selection')
    expect(treeRowClass({ depth: 2 })).toContain('pl-10')
    expect(treeRowClass()).toContain('pl-2')
    expect(treeRowClass()).not.toContain('bg-selection')
  })
})
