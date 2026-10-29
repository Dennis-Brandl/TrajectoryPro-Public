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
import type { FormDocument } from '@mission/form-schema'
import { moveRow } from '../structural-ops'

// content section (2 rows) + footer section (1 row) — a footer only arises via v1-convert
// or a multi-section doc, so it is not reachable from emptyDocument()'s single content section.
function multiSectionDoc(): FormDocument {
  return {
    version: 2,
    sections: [
      {
        id: 'content',
        role: 'content',
        rows: [
          { id: 'r1', blocks: [{ id: 'b1', type: 'text', content: 'A' }] },
          { id: 'r2', blocks: [{ id: 'b2', type: 'text', content: 'B' }] },
        ],
      },
      { id: 'footer', role: 'footer', rows: [{ id: 'rf', blocks: [{ id: 'bf', type: 'text', content: 'F' }] }] },
    ],
  } as FormDocument
}

describe('moveRow — row → footer cross-section drop', () => {
  it('moves a content row into the footer section', () => {
    const moved = moveRow(multiSectionDoc(), 'r1', { sectionId: 'footer', afterRowId: null })
    const content = moved.sections.find((s) => s.id === 'content')!
    const footer = moved.sections.find((s) => s.id === 'footer')!
    expect(content.rows.map((r) => r.id)).toEqual(['r2']) // r1 left the content section
    expect(footer.rows.map((r) => r.id)).toEqual(['r1', 'rf']) // afterRowId:null prepends at section top
  })

  it('places the moved row after a named footer row', () => {
    const moved = moveRow(multiSectionDoc(), 'r1', { sectionId: 'footer', afterRowId: 'rf' })
    const footer = moved.sections.find((s) => s.id === 'footer')!
    expect(footer.rows.map((r) => r.id)).toEqual(['rf', 'r1'])
  })
})
