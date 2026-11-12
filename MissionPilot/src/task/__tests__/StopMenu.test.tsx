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
import { StopMenu, StopConfirm, stopQuestion } from '../StopMenu'

afterEach(cleanup)

describe('StopMenu', () => {
  it('opening the ellipsis shows Stop workflow… and choosing it calls onStop', () => {
    const onStop = vi.fn()
    render(<StopMenu onStop={onStop} />)
    expect(screen.queryByText('Stop workflow…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Stop workflow…'))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('is disabled when told to be', () => {
    render(<StopMenu disabled onStop={() => {}} />)
    expect((screen.getByRole('button', { name: 'More actions' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('StopMenu dismissal', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  it('closes on Escape', () => {
    render(<StopMenu onStop={() => {}} />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Stop workflow…')).toBeNull()
  })
  it('closes on an outside click', () => {
    render(<StopMenu onStop={() => {}} />)
    open()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Stop workflow…')).toBeNull()
  })
  it('closes when it becomes disabled', () => {
    const { rerender } = render(<StopMenu onStop={() => {}} />)
    open()
    rerender(<StopMenu disabled onStop={() => {}} />)
    expect(screen.queryByText('Stop workflow…')).toBeNull()
  })
})

describe('StopConfirm', () => {
  it('Escape cancels', () => {
    const onCancel = vi.fn()
    render(<StopConfirm runtimeLabel="X" onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
  it('shows the exact copy and the two buttons', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<StopConfirm runtimeLabel="MIX-1" onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('alertdialog').textContent).toContain(
      'Stop the whole workflow «MIX-1»? Its cleanup steps will run. This also ends work other people are doing on it.',
    )
    expect(stopQuestion('MIX-1')).toContain('«MIX-1»')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop workflow' }))
    expect(onConfirm).toHaveBeenCalled()
  })
})
