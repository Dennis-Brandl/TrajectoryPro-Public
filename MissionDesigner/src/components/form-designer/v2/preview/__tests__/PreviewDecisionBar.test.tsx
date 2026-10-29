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
import { render, screen, fireEvent } from '@testing-library/react'
import { PreviewDecisionBar } from '../PreviewDecisionBar'

describe('PreviewDecisionBar', () => {
  it('continue: shows the label, disabled while the gate is closed', () => {
    const onDecide = vi.fn()
    render(
      <PreviewDecisionBar
        decision={{ kind: 'continue', label: 'Submit' }}
        gate={{ ok: false, missing: ['x'] }}
        noGateOk={false}
        onDecide={onDecide}
      />,
    )
    const btn = screen.getByRole('button', { name: 'Submit' })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('continue: click emits "complete" when the gate is open', () => {
    const onDecide = vi.fn()
    render(
      <PreviewDecisionBar
        decision={{ kind: 'continue', label: 'Continue' }}
        gate={{ ok: true, missing: [] }}
        noGateOk={true}
        onDecide={onDecide}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onDecide).toHaveBeenCalledWith('complete')
  })

  it('yesno: renders both labels and emits their routing values', () => {
    const onDecide = vi.fn()
    render(
      <PreviewDecisionBar
        decision={{ kind: 'yesno', yes: { label: 'Approve', value: 'ok' }, no: { label: 'Reject', value: 'bad' } }}
        gate={{ ok: true, missing: [] }}
        noGateOk={true}
        onDecide={onDecide}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(onDecide).toHaveBeenNthCalledWith(1, 'ok')
    expect(onDecide).toHaveBeenNthCalledWith(2, 'bad', true)
  })

  it('yesno: both buttons disabled while the gate is closed', () => {
    render(
      <PreviewDecisionBar
        decision={{ kind: 'yesno', yes: { label: 'Yes', value: 'true' }, no: { label: 'No', value: 'false' } }}
        gate={{ ok: false, missing: ['x'] }}
        noGateOk={false}
        onDecide={vi.fn()}
      />,
    )
    expect((screen.getByRole('button', { name: 'Yes' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'No' }) as HTMLButtonElement).disabled).toBe(true)
  })

  // Spec D5 (final-review fix): No is exempt from the signature gate alone, mirroring the
  // Pilot — its disabled state and click payload key on noGateOk, not gate.ok.
  it('yesno: No stays enabled (and passes isNo=true) when noGateOk is true but gate.ok is false; Yes stays disabled', () => {
    const onDecide = vi.fn()
    render(
      <PreviewDecisionBar
        decision={{ kind: 'yesno', yes: { label: 'Yes', value: 'true' }, no: { label: 'No', value: 'false' } }}
        gate={{ ok: false, missing: ['approval'] }}
        noGateOk={true}
        onDecide={onDecide}
      />,
    )
    expect((screen.getByRole('button', { name: 'Yes' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'No' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(onDecide).toHaveBeenCalledWith('false', true)
  })
})
