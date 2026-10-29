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
import { render, fireEvent, act } from '@testing-library/react'
import { FormDocumentView } from '../FormDocumentView'
import type { FormDocument, FormEvent } from '@mission/form-schema'

afterEach(() => vi.useRealTimers())

const DOC: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [
        {
          id: 'r1',
          blocks: [
            { id: 'b1', type: 'textInput', fieldName: 'serial', required: true },
            { id: 'tm', type: 'timer', label: 'Cure', fieldName: 'cure', durationSeconds: 2, direction: 'countdown', blockDone: true },
          ],
        },
      ],
    },
  ],
}

describe('validation events', () => {
  it('emits NO validation on mount — the host owns the initial gate', () => {
    // Characterization test for docs/HOST-CONTRACT.md §2. The renderer emits validation
    // only on fieldChange and on timer settlement, so a host MUST compute the initial
    // gate itself (and recompute on every screen change) rather than wait for an event.
    // DOC has an unfilled required field, so a mount emission — if one were ever added —
    // would be {ok:false}, and the host would have no way to tell "not yet reported"
    // from "reported as blocked". Pinned so the contract cannot drift silently.
    vi.useFakeTimers()
    const events: FormEvent[] = []
    render(<FormDocumentView document={DOC} values={{}} onEvent={(e) => events.push(e)} />)
    expect(events.filter((e) => e.kind === 'validation')).toEqual([])
  })

  it('fieldChange is followed by validation computed WITH the new value applied', () => {
    vi.useFakeTimers()
    const events: FormEvent[] = []
    const { container } = render(<FormDocumentView document={DOC} values={{}} onEvent={(e) => events.push(e)} />)
    fireEvent.change(container.querySelector('#b1-control')!, { target: { value: 'SN-1' } })
    const validations = events.filter((e) => e.kind === 'validation')
    expect(validations.at(-1)).toEqual({ kind: 'validation', ok: false, missing: ['cure'] })
  })

  it('timer elapse settles the gate and re-emits validation', () => {
    vi.useFakeTimers()
    const events: FormEvent[] = []
    render(<FormDocumentView document={DOC} values={{ serial: 'SN-1' }} onEvent={(e) => events.push(e)} />)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    const validations = events.filter((e) => e.kind === 'validation')
    expect(validations.at(-1)).toEqual({ kind: 'validation', ok: true, missing: [] })
  })

  it('auto-elapse validates against the values as of elapse, not as of mount', () => {
    // The primary authoring pattern for a timer form: the operator fills the fields
    // WHILE the timer runs. The host is controlled, so each fieldChange comes back as
    // a new `values` prop. If the timer's interval callback is pinned to the mount
    // render, elapse re-validates against `values = {}` and reports the field the
    // operator just filled as missing — which dead-ends the host's advance gate.
    vi.useFakeTimers()
    const events: FormEvent[] = []
    const { container, rerender } = render(
      <FormDocumentView document={DOC} values={{}} onEvent={(e) => events.push(e)} />,
    )
    fireEvent.change(container.querySelector('#b1-control')!, { target: { value: 'SN-1' } })
    rerender(<FormDocumentView document={DOC} values={{ serial: 'SN-1' }} onEvent={(e) => events.push(e)} />)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    const validations = events.filter((e) => e.kind === 'validation')
    expect(validations.at(-1)).toEqual({ kind: 'validation', ok: true, missing: [] })
  })
})
