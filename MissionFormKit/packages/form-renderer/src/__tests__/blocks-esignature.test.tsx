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
import { render, fireEvent } from '@testing-library/react'
import { FormDocumentView } from '../FormDocumentView'
import type { FormDocument, FormEvent } from '@mission/form-schema'

function docWith(blocks: FormDocument['sections'][0]['rows'][0]['blocks']): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}

const esig = { id: 'e1', type: 'esignature' as const, fieldName: 'approval', label: 'Approve', meaning: 'I approve this record', roleName: 'Supervisor' }

describe('esignature block', () => {
  it('renders legend, meaning, role line, hint, two labelled inputs and the error line', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([esig])}
        signature={{ loginName: 'jane', password: '' }}
        signatureHint="Must be signed by someone other than Jo"
        signatureError="Login name or password is incorrect"
      />,
    )
    const fs = container.querySelector('fieldset.tfk-esig')!
    expect(fs.querySelector('legend')!.textContent).toBe('Approve')
    expect(fs.querySelector('.tfk-esig-meaning')!.textContent).toBe('I approve this record')
    expect([...fs.querySelectorAll('.tfk-hint')].map((p) => p.textContent)).toEqual(['Sign as: Supervisor', 'Must be signed by someone other than Jo'])
    const login = container.querySelector<HTMLInputElement>('#e1-login')!
    expect(container.querySelector('label[for="e1-login"]')!.textContent).toBe('Login name')
    expect(login.value).toBe('jane')
    expect(login.getAttribute('autocomplete')).toBe('off')
    expect(login.getAttribute('aria-required')).toBe('true')
    const pw = container.querySelector<HTMLInputElement>('#e1-password')!
    expect(container.querySelector('label[for="e1-password"]')!.textContent).toBe('Password')
    expect(pw.type).toBe('password')
    expect(pw.getAttribute('autocomplete')).toBe('new-password')
    const err = container.querySelector('#e1-error')!
    expect(err.getAttribute('role')).toBe('alert')
    expect(err.textContent).toBe('Login name or password is incorrect')
  })

  it('defaults: legend "E-signature", "Any member of this work center", no hint, no error', () => {
    const { container } = render(<FormDocumentView document={docWith([{ id: 'e1', type: 'esignature', fieldName: 'approval' }])} />)
    expect(container.querySelector('fieldset.tfk-esig legend')!.textContent).toBe('E-signature')
    expect(container.querySelector('.tfk-esig-meaning')).toBeNull()
    expect([...container.querySelectorAll('.tfk-hint')].map((p) => p.textContent)).toEqual(['Any member of this work center'])
    expect(container.querySelector('.tfk-error')).toBeNull()
  })

  it('emits signature (merged with the current draft) then validation computed with the new draft', () => {
    const events: FormEvent[] = []
    const { container } = render(
      <FormDocumentView document={docWith([esig])} signature={{ loginName: 'jane', password: '' }} onEvent={(e) => events.push(e)} />,
    )
    fireEvent.change(container.querySelector('#e1-password')!, { target: { value: 'pw' } })
    expect(events).toEqual([
      { kind: 'signature', blockId: 'e1', loginName: 'jane', password: 'pw' },
      { kind: 'validation', ok: true, missing: [] },
    ])
    events.length = 0
    fireEvent.change(container.querySelector('#e1-login')!, { target: { value: '' } })
    expect(events).toEqual([
      { kind: 'signature', blockId: 'e1', loginName: '', password: '' },
      { kind: 'validation', ok: false, missing: ['approval'] },
    ])
  })

  it('fieldChange validation also carries the signature draft the host passed', () => {
    const events: FormEvent[] = []
    const { container } = render(
      <FormDocumentView
        document={docWith([{ id: 'b1', type: 'textInput', fieldName: 'serial', required: true }, esig])}
        signature={{ loginName: 'jane', password: 'pw' }}
        onEvent={(e) => events.push(e)}
      />,
    )
    fireEvent.change(container.querySelector('#b1-control')!, { target: { value: 'SN-1' } })
    expect(events).toContainEqual({ kind: 'validation', ok: true, missing: [] })
  })

  it('no events fire in edit mode', () => {
    const onEvent = vi.fn()
    const { container } = render(<FormDocumentView document={docWith([esig])} mode="edit" onEvent={onEvent} />)
    fireEvent.change(container.querySelector('#e1-login')!, { target: { value: 'x' } })
    expect(onEvent).not.toHaveBeenCalled()
  })
})
