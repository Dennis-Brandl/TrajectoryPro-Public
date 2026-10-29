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

// @vitest-environment jsdom

import { useState } from 'react'
import { render, fireEvent, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PaneResizeHandle } from '../PaneResizeHandle'

function Host({ direction }: { direction: 1 | -1 }) {
  const [width, setWidth] = useState(280)
  return (
    <div data-testid="pane" style={{ width }}>
      <PaneResizeHandle
        width={width}
        min={240}
        max={560}
        direction={direction}
        onResize={setWidth}
        label="Resize test pane"
      />
    </div>
  )
}

function paneWidth(): string {
  return screen.getByTestId('pane').style.width
}

describe('PaneResizeHandle', () => {
  it('widens a left pane when dragging right (direction +1)', () => {
    render(<Host direction={1} />)
    fireEvent.pointerDown(screen.getByRole('separator'), { clientX: 300, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 340 })
    expect(paneWidth()).toBe('320px')
  })

  it('widens a right pane when dragging left (direction -1)', () => {
    render(<Host direction={-1} />)
    fireEvent.pointerDown(screen.getByRole('separator'), { clientX: 300, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 260 })
    expect(paneWidth()).toBe('320px')
  })

  it('clamps to [min, max]', () => {
    render(<Host direction={1} />)
    fireEvent.pointerDown(screen.getByRole('separator'), { clientX: 300, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 3000 })
    expect(paneWidth()).toBe('560px')
    fireEvent.pointerMove(window, { clientX: -3000 })
    expect(paneWidth()).toBe('240px')
  })

  it('stops resizing after pointerup', () => {
    render(<Host direction={1} />)
    fireEvent.pointerDown(screen.getByRole('separator'), { clientX: 300, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 340 })
    fireEvent.pointerUp(window)
    fireEvent.pointerMove(window, { clientX: 500 })
    expect(paneWidth()).toBe('320px')
  })
})
