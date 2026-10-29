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
import { render, fireEvent, screen, act } from '@testing-library/react'
import { FlowHost } from '../FlowHost'
import { MockEngine } from '../../engine/MockEngine'
import { inspectionFlow } from '../../flows/inspection'
import { reworkFlow } from '../../flows/rework'
import { kitchenSinkFlow } from '../../flows/kitchenSink'

afterEach(() => vi.useRealTimers())

function renderInspection() {
  return render(<FlowHost engine={new MockEngine(inspectionFlow)} />)
}

describe('FlowHost — inspection flow', () => {
  it('renders the entry screen at Step 1 with Back disabled', () => {
    renderInspection()
    expect(screen.getByRole('textbox')).toBeTruthy() // serial input
    expect(screen.getByText('Step 1')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('blocks advance while the required field is empty and shows the missing count', () => {
    renderInspection()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('textbox')).toBeTruthy() // still on s1
    expect(screen.queryByRole('button', { name: 'Pass' })).toBeNull()
    expect(screen.getByText('1 required field(s) remaining')).toBeTruthy()
  })

  it('advances once the required field is filled', () => {
    renderInspection()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SN-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('button', { name: 'Pass' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fail' })).toBeTruthy()
    expect(screen.getByText('Step 2')).toBeTruthy()
  })

  it('branches to fail, then Back restores prior screens and the serial value', () => {
    renderInspection()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SN-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fail' }))
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeTruthy() // s3-fail
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Pass' })).toBeTruthy() // back to s2
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('SN-1') // back to s1, restored
  })

  it('completes via the pass branch and logs host decision + complete', () => {
    renderInspection()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SN-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByText('Flow complete')).toBeTruthy()
    const log = screen.getByLabelText('event log').textContent ?? ''
    expect(log).toContain('"kind":"decision"')
    expect(log).toContain('"value":"pass"')
    expect(log).toContain('"kind":"complete"')
  })
})

describe('FlowHost — rework flow (self-loop)', () => {
  // The other sample flows are acyclic, so every transition changes screenId and the
  // renderer remounts by luck. This flow loops a step to ITSELF, where screenId is
  // unchanged — so it only remounts if the host keys per step INSTANCE.
  // Without that, the renderer's private settled-timer set survives the loop and this
  // instance's cure is skipped. See docs/HOST-CONTRACT.md §3-§4.
  it('restarts the cure timer on every loop instance', () => {
    vi.useFakeTimers()
    render(<FlowHost engine={new MockEngine(reworkFlow)} />)

    // Instance 1: record the reading, let the cure elapse. Gate opens.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '4.2' } })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull() // settled
    fireEvent.click(screen.getByRole('button', { name: 'Rework' }))

    // Instance 2 of the SAME step: the cure must be running again, not still settled.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.getByText('1 required field(s) remaining')).toBeTruthy()
  })

  it('will not let the previous instance\'s cure open this instance\'s gate', () => {
    // The dangerous half. If settled timers leak across the loop, a fieldChange makes
    // the renderer re-emit validation from ITS stale settled set -> {ok:true} -> Accept
    // completes the step without this cure ever running, and the batch record says it did.
    vi.useFakeTimers()
    render(<FlowHost engine={new MockEngine(reworkFlow)} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '4.2' } })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rework' }))

    // Re-record the reading WITHOUT waiting for the new cure.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '4.3' } })
    expect(screen.getByText('1 required field(s) remaining')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(screen.queryByText('Flow complete')).toBeNull() // still gated on the fresh cure
  })
})

describe('FlowHost — kitchen-sink flow (esignature)', () => {
  // Regression: the host must track the renderer's `signature` draft as its own state
  // (HOST-CONTRACT.md §2 rule 4) and feed it back into `FormDocumentView`. Without that
  // wiring the esignature inputs are controlled against a draft that never changes, so
  // every re-render (each `onEvent` call logs, which re-renders the host) snaps them back
  // to empty and the gate never sees a complete signature.
  it('keeps the typed login/password after other events re-render the host, and clears the esignature gate error', () => {
    const { container } = render(<FlowHost engine={new MockEngine(kitchenSinkFlow)} />)

    // Mount: serial, checks and approval (the esignature block) are all required and empty.
    expect(screen.getByText('3 required field(s) remaining')).toBeTruthy()

    const login = screen.getByLabelText('Login name') as HTMLInputElement
    const password = screen.getByLabelText('Password') as HTMLInputElement

    fireEvent.change(login, { target: { value: 'jane' } })
    expect(login.value).toBe('jane') // survives the re-render `signature` (then `validation`) triggers

    fireEvent.change(password, { target: { value: 'pw' } })
    expect(password.value).toBe('pw')
    expect(screen.getByText('2 required field(s) remaining')).toBeTruthy() // approval satisfied

    // Force an unrelated re-render (a fieldChange elsewhere) and confirm the draft still holds.
    const serial = container.querySelector<HTMLInputElement>('#ks-input-control')!
    fireEvent.change(serial, { target: { value: 'SN-1' } })
    expect(login.value).toBe('jane')
    expect(password.value).toBe('pw')
    expect(screen.getByText('1 required field(s) remaining')).toBeTruthy() // only checks left

    fireEvent.click(screen.getByLabelText('Seals'))
    expect(screen.queryByText(/required field\(s\) remaining/)).toBeNull() // gate is fully open

    fireEvent.click(screen.getByRole('button', { name: 'Retry scan' }))
    expect(screen.getByText('Flow complete')).toBeTruthy()
  })
})
