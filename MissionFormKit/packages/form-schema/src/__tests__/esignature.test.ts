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
import { findESignatureBlock, isSignatureDraftComplete, signedLabel } from '../esignature'
import { validateFormDocument } from '../validate'
import type { FormDocument } from '../types'

const esig = {
  id: 'e1',
  type: 'esignature' as const,
  fieldName: 'approval',
  label: 'Approve',
  meaning: 'I approve this record',
  roleName: 'Supervisor',
  requireDifferentUser: true,
  outputParameter: 'approver',
}

function doc(blocks: FormDocument['sections'][0]['rows'][0]['blocks']): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}

describe('esignature block', () => {
  it('validates a well-formed block and rejects unknown properties', () => {
    expect(validateFormDocument(doc([esig]))).toEqual({ ok: true, errors: [] })
    expect(validateFormDocument(doc([{ ...esig, foo: 1 } as never])).ok).toBe(false)
    expect(validateFormDocument(doc([{ id: 'e2', type: 'esignature' } as never])).ok).toBe(false) // fieldName required
    expect(validateFormDocument(doc([{ id: 'e3', type: 'esignature', fieldName: 'x' }])).ok).toBe(true) // everything else optional
  })

  it('findESignatureBlock returns the first block in document order, or null', () => {
    expect(findESignatureBlock(doc([{ id: 't', type: 'text', content: 'hi' }]))).toBeNull()
    const second = { ...esig, id: 'e2', fieldName: 'second' }
    expect(findESignatureBlock(doc([{ id: 't', type: 'text', content: 'hi' }, esig, second]))?.id).toBe('e1')
  })

  it('isSignatureDraftComplete requires both fields non-blank after trimming', () => {
    expect(isSignatureDraftComplete(null)).toBe(false)
    expect(isSignatureDraftComplete(undefined)).toBe(false)
    expect(isSignatureDraftComplete({ loginName: ' ', password: 'pw' })).toBe(false)
    expect(isSignatureDraftComplete({ loginName: 'jane', password: '  ' })).toBe(false)
    expect(isSignatureDraftComplete({ loginName: 'jane', password: 'pw' })).toBe(true)
  })
})

describe('signedLabel (a signing button says so, once)', () => {
  it('prefixes "Sign & " to a label that does not already start with Sign', () => {
    expect(signedLabel('Submit')).toBe('Sign & Submit')
    expect(signedLabel('Approve')).toBe('Sign & Approve')
    // "Signed off" starts with a different word, so it still gets the prefix.
    expect(signedLabel('Signed off')).toBe('Sign & Signed off')
  })

  it('leaves a label that already starts with the word Sign as it is', () => {
    expect(signedLabel('Sign and Save')).toBe('Sign and Save')
    expect(signedLabel('sign off')).toBe('sign off')
    expect(signedLabel('Sign')).toBe('Sign')
    expect(signedLabel('  Sign & Submit')).toBe('  Sign & Submit')
  })
})

describe('signedLabel edge cases (review)', () => {
  it('an empty or blank label signs as plain "Sign", never "Sign & "', () => {
    expect(signedLabel('')).toBe('Sign')
    expect(signedLabel('   ')).toBe('Sign')
  })
})
