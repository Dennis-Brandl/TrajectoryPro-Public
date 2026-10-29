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
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { StepBar } from '../StepBar'
import { CompletionScreen } from '../CompletionScreen'
import { EventLogPanel } from '../EventLogPanel'
import { FlowPicker } from '../FlowPicker'

describe('StepBar', () => {
  it('disables Back when it cannot go back and hides the missing note at zero', () => {
    render(<StepBar step={1} canGoBack={false} onBack={() => {}} missingCount={0} />)
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Step 1')).toBeTruthy()
    expect(screen.queryByText(/required field/)).toBeNull()
  })

  it('shows the missing count and fires onBack', () => {
    const onBack = vi.fn()
    render(<StepBar step={2} canGoBack onBack={onBack} missingCount={2} />)
    expect(screen.getByText('2 required field(s) remaining')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})

describe('CompletionScreen', () => {
  it('lists collected values (arrays joined) and fires onRestart', () => {
    const onRestart = vi.fn()
    render(<CompletionScreen values={{ serial: 'SN-1', checks: ['a', 'b'] }} onRestart={onRestart} />)
    expect(screen.getByText('serial')).toBeTruthy()
    expect(screen.getByText('SN-1')).toBeTruthy()
    expect(screen.getByText('a, b')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(onRestart).toHaveBeenCalledOnce()
  })

  it('handles the empty-values case', () => {
    render(<CompletionScreen values={{}} onRestart={() => {}} />)
    expect(screen.getByText('No values were collected.')).toBeTruthy()
  })
})

describe('EventLogPanel', () => {
  it('renders entries newline-joined under the event-log label', () => {
    render(<EventLogPanel entries={['{"kind":"a"}', '{"kind":"b"}']} />)
    expect(screen.getByLabelText('event log').textContent).toBe('{"kind":"a"}\n{"kind":"b"}')
  })
})

describe('FlowPicker', () => {
  it('disables the active option and fires onSelect for others', () => {
    const onSelect = vi.fn()
    render(
      <FlowPicker
        options={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]}
        activeId="a"
        onSelect={onSelect}
      />,
    )
    expect((screen.getByRole('button', { name: 'Alpha' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
    expect(onSelect).toHaveBeenCalledWith('b')
  })
})
