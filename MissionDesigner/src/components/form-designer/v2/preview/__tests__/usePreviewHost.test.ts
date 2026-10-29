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
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { FormDocument } from '@mission/form-schema'
import { usePreviewHost } from '../usePreviewHost'

const REQ = 'serial'
function requiredInputDoc(): FormDocument {
  return {
    version: 2,
    sections: [
      {
        id: 's1',
        role: 'content',
        rows: [
          {
            id: 'r1',
            blocks: [{ id: 'b1', type: 'textInput', fieldName: REQ, label: 'Serial', required: true }] as never,
          },
        ],
      },
    ],
  } as FormDocument
}
function staticDefaultDoc(): FormDocument {
  return {
    version: 2,
    sections: [
      {
        id: 's1',
        role: 'content',
        rows: [
          {
            id: 'r1',
            blocks: [
              {
                id: 'b1',
                type: 'textInput',
                fieldName: REQ,
                required: true,
                defaultSource: { mode: 'static', value: 'SN-9' },
              },
            ] as never,
          },
        ],
      },
    ],
  } as FormDocument
}

describe('usePreviewHost', () => {
  it('computes the gate at mount (closed for an empty required field)', () => {
    const { result } = renderHook(() => usePreviewHost(requiredInputDoc()))
    expect(result.current.gate).toEqual({ ok: false, missing: [REQ] })
    expect(result.current.values).toEqual({})
    expect(result.current.instanceKey).toBe(0)
  })

  it('seeds static defaults → gate open at mount', () => {
    const { result } = renderHook(() => usePreviewHost(staticDefaultDoc()))
    expect(result.current.values).toEqual({ [REQ]: 'SN-9' })
    expect(result.current.gate.ok).toBe(true)
  })

  it('folds a fieldChange into values', () => {
    const { result } = renderHook(() => usePreviewHost(requiredInputDoc()))
    act(() => result.current.onEvent({ kind: 'fieldChange', fieldName: REQ, value: 'X' }))
    expect(result.current.values[REQ]).toBe('X')
  })

  it('adopts a validation event into the gate', () => {
    const { result } = renderHook(() => usePreviewHost(requiredInputDoc()))
    act(() => result.current.onEvent({ kind: 'validation', ok: true, missing: [] }))
    expect(result.current.gate.ok).toBe(true)
  })

  it('records a decision only when the gate is open', () => {
    const { result } = renderHook(() => usePreviewHost(requiredInputDoc()))
    act(() => result.current.decide('go')) // gate closed → ignored
    expect(result.current.lastDecision).toBeNull()
    act(() => result.current.onEvent({ kind: 'validation', ok: true, missing: [] }))
    act(() => result.current.decide('go')) // gate open → recorded
    expect(result.current.lastDecision).toBe('go')
  })

  it('routes an action event through the gate', () => {
    const { result } = renderHook(() => usePreviewHost(requiredInputDoc()))
    act(() => result.current.onEvent({ kind: 'validation', ok: true, missing: [] }))
    act(() => result.current.onEvent({ kind: 'action', blockId: 'x', outputValue: 'next' }))
    expect(result.current.lastDecision).toBe('next')
  })

  it('restart re-seeds, recomputes the gate back to CLOSED, clears lastDecision, bumps instanceKey', () => {
    const { result } = renderHook(() => usePreviewHost(requiredInputDoc()))
    act(() => result.current.onEvent({ kind: 'fieldChange', fieldName: REQ, value: 'edited' }))
    act(() => result.current.onEvent({ kind: 'validation', ok: true, missing: [] }))
    act(() => result.current.decide('go'))
    expect(result.current.gate.ok).toBe(true) // gate open pre-restart
    act(() => result.current.restart())
    expect(result.current.values).toEqual({}) // re-seeded (no static default → empty)
    expect(result.current.gate).toEqual({ ok: false, missing: [REQ] }) // recomputed → CLOSED again
    expect(result.current.lastDecision).toBeNull()
    expect(result.current.instanceKey).toBe(1)
  })

  it('owns the e-signature draft: gated until complete, adopted from signature events, cleared on restart', () => {
    const doc: FormDocument = {
      version: 2,
      sections: [
        {
          id: 's',
          role: 'content',
          rows: [{ id: 'r', blocks: [{ id: 'e', type: 'esignature', fieldName: 'approval' }] }],
        },
      ],
    }
    const { result } = renderHook(() => usePreviewHost(doc))
    expect(result.current.gate).toEqual({ ok: false, missing: ['approval'] })
    expect(result.current.signature).toEqual({ loginName: '', password: '' })
    act(() => result.current.onEvent({ kind: 'signature', blockId: 'e', loginName: 'jane', password: 'pw' }))
    expect(result.current.signature).toEqual({ loginName: 'jane', password: 'pw' })
    act(() => result.current.restart())
    expect(result.current.signature).toEqual({ loginName: '', password: '' })
    expect(result.current.gate.ok).toBe(false)
  })

  // Spec D5 (final-review fix): No/Reject is exempt from the signature requirement alone,
  // mirroring the Pilot's TaskScreen.tsx `noGateOk`.
  it('No is allowed with an empty signature draft on an esignature-only form (noGateOk true, decide accepts isNo)', () => {
    const doc: FormDocument = {
      version: 2,
      sections: [
        {
          id: 's',
          role: 'content',
          rows: [{ id: 'r', blocks: [{ id: 'e', type: 'esignature', fieldName: 'approval' }] }],
        },
      ],
    }
    const { result } = renderHook(() => usePreviewHost(doc))
    expect(result.current.gate).toEqual({ ok: false, missing: ['approval'] })
    expect(result.current.noGateOk).toBe(true)
    act(() => result.current.decide('yes')) // Yes still requires the full gate → ignored
    expect(result.current.lastDecision).toBeNull()
    act(() => result.current.decide('no', true)) // No + noGateOk → accepted
    expect(result.current.lastDecision).toBe('no')
  })

  it('a missing non-signature required field still blocks No even with isNo=true', () => {
    const doc: FormDocument = {
      version: 2,
      sections: [
        {
          id: 's',
          role: 'content',
          rows: [
            {
              id: 'r',
              blocks: [
                { id: 'b1', type: 'textInput', fieldName: REQ, label: 'Serial', required: true },
                { id: 'e', type: 'esignature', fieldName: 'approval' },
              ] as never,
            },
          ],
        },
      ],
    }
    const { result } = renderHook(() => usePreviewHost(doc))
    expect(result.current.gate).toEqual({ ok: false, missing: [REQ, 'approval'] })
    expect(result.current.noGateOk).toBe(false)
    act(() => result.current.decide('no', true))
    expect(result.current.lastDecision).toBeNull()
  })

  describe('job events', () => {
    const yesNo = {
      kind: 'yesno' as const,
      yes: { label: 'Yes', value: 'true' },
      no: { label: 'No', value: 'false' },
    }
    const open = (r: { current: ReturnType<typeof usePreviewHost> }) =>
      act(() => r.current.onEvent({ kind: 'validation', ok: true, missing: [] }))

    it("job 'no' decides the no routing value (isNo path: passes with only the signature missing)", () => {
      const doc: FormDocument = {
        version: 2,
        sections: [
          {
            id: 's',
            role: 'content',
            rows: [{ id: 'r', blocks: [{ id: 'e', type: 'esignature', fieldName: 'approval' }] }],
          },
        ],
      }
      const { result } = renderHook(() => usePreviewHost(doc, yesNo))
      act(() => result.current.onEvent({ kind: 'job', blockId: 'y', job: 'yes' }))
      expect(result.current.lastDecision).toBeNull() // gate closed
      act(() => result.current.onEvent({ kind: 'job', blockId: 'n', job: 'no' }))
      expect(result.current.lastDecision).toBe('false')
    })

    it("job 'yes' decides the yes value once the gate is open", () => {
      const { result } = renderHook(() => usePreviewHost(requiredInputDoc(), yesNo))
      act(() => result.current.onEvent({ kind: 'job', blockId: 'y', job: 'yes' }))
      expect(result.current.lastDecision).toBeNull()
      open(result)
      act(() => result.current.onEvent({ kind: 'job', blockId: 'y', job: 'yes' }))
      expect(result.current.lastDecision).toBe('true')
    })

    it("job 'continue' decides 'complete' on a continue step", () => {
      const { result } = renderHook(() => usePreviewHost(requiredInputDoc(), { kind: 'continue', label: 'Go' }))
      open(result)
      act(() => result.current.onEvent({ kind: 'job', blockId: 'c', job: 'continue' }))
      expect(result.current.lastDecision).toBe('complete')
    })

    it('a job that does not fit the step does nothing', () => {
      const { result } = renderHook(() => usePreviewHost(requiredInputDoc(), yesNo))
      open(result)
      act(() => result.current.onEvent({ kind: 'job', blockId: 'c', job: 'continue' }))
      expect(result.current.lastDecision).toBeNull()
      const r2 = renderHook(() => usePreviewHost(requiredInputDoc(), { kind: 'continue', label: 'Go' }))
      open(r2.result)
      act(() => r2.result.current.onEvent({ kind: 'job', blockId: 'y', job: 'yes' }))
      act(() => r2.result.current.onEvent({ kind: 'job', blockId: 'n', job: 'no' }))
      expect(r2.result.current.lastDecision).toBeNull()
    })
  })
})
