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
import { isFormDesigned } from '../is-form-designed'

describe('isFormDesigned', () => {
  it('is false for an empty node', () => {
    expect(isFormDesigned({})).toBe(false)
  })
  it('P4.2: an object with no formDocument is NOT designed (formLayouts dropped from the Pick — strict v2 authority; migration/import/sync-write guarantee formDocument)', () => {
    const noFormDocument = {}
    expect(isFormDesigned(noFormDocument)).toBe(false)
  })
  it('is true when the v2 document has a block', () => {
    expect(
      isFormDesigned({
        formDocument: {
          version: 2,
          sections: [
            { id: 's', role: 'content', rows: [{ id: 'r', blocks: [{ id: 'b', type: 'text', content: 'hi' }] }] },
          ],
        },
      }),
    ).toBe(true)
  })
  it('is false when the v2 document has only empty sections', () => {
    expect(isFormDesigned({ formDocument: { version: 2, sections: [{ id: 's', role: 'content', rows: [] }] } })).toBe(
      false,
    )
  })
})
