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
//
// P4.1 Task 6: collectFormElementImages ported from the retired v1
// form_layout_config walk (dead since Task 3 — export never emits that field
// any more) to the v2 form_document walk. This function's only direct unit
// tests were deleted when Task 3 wholesale-replaced form-layout-export.test.ts
// (see task-3-report.md); this file replaces them for the v2 shape.
import { describe, expect, it } from 'vitest'
import type { FormDocument } from '@mission/form-schema'
import type { MasterWorkflowStep } from '../export-types'
import { collectFormElementImages } from '../image-collectors'

function stepWithDoc(oid: string, doc: FormDocument): MasterWorkflowStep {
  return {
    local_id: 'Form',
    oid,
    version: '1.0.0',
    last_modified_date: '2026-07-23T00:00:00.000Z',
    step_type: 'USER_INTERACTION',
    form_document: doc,
  }
}

const designedDoc: FormDocument = {
  version: 2,
  sections: [
    {
      id: 'content',
      role: 'content',
      rows: [
        { id: 'r1', blocks: [{ id: 'b-text', type: 'text', content: 'Hello' }] },
        {
          id: 'r2',
          blocks: [
            { id: 'b-img', type: 'image', src: 'photo.png', imageOid: 'IMGOID1', layout: { aspectRatio: '16/9' } },
            // Duplicate reference to the SAME underlying image (e.g. a copy-pasted
            // block) — same imageOid + src, different layout. Must dedupe to 1 entry.
            { id: 'b-img2', type: 'image', src: 'photo.png', imageOid: 'IMGOID1', layout: { aspectRatio: '4/3' } },
            {
              id: 'b-img3',
              type: 'image',
              src: 'https://cdn.example/x.png',
              imageOid: 'IMGOID2',
              layout: { aspectRatio: '16/9' },
            },
            {
              id: 'b-img4',
              type: 'image',
              src: 'data:image/png;base64,AAAA',
              imageOid: 'IMGOID3',
              layout: { aspectRatio: '16/9' },
            },
            {
              id: 'b-img5',
              type: 'image',
              src: 'No image selected',
              imageOid: 'IMGOID4',
              layout: { aspectRatio: '16/9' },
            },
          ],
        },
      ],
    },
  ],
}

describe('collectFormElementImages (v2 form_document walk)', () => {
  it('collects a local image block as an imageOid-prefixed zipPath entry', () => {
    const out = collectFormElementImages([stepWithDoc('oid-step', designedDoc)])
    expect(out).toEqual([{ zipPath: 'IMGOID1-photo.png', imageStoreKey: 'photo.png' }])
  })

  it('excludes http(s):, data:, and the "No image selected" placeholder', () => {
    const out = collectFormElementImages([stepWithDoc('oid-step', designedDoc)])
    expect(out.some((e) => e.zipPath.includes('IMGOID2'))).toBe(false)
    expect(out.some((e) => e.zipPath.includes('IMGOID3'))).toBe(false)
    expect(out.some((e) => e.zipPath.includes('IMGOID4'))).toBe(false)
  })

  it('dedupes two blocks that reference the same imageOid to a single ZIP entry', () => {
    const out = collectFormElementImages([stepWithDoc('oid-step', designedDoc)])
    // b-img and b-img2 both carry imageOid 'IMGOID1' — collapsed to one entry.
    expect(out.filter((e) => e.zipPath.startsWith('IMGOID1-'))).toHaveLength(1)
  })

  it('falls back to the step oid as the zipPath prefix when a block has no imageOid', () => {
    const doc: FormDocument = {
      version: 2,
      sections: [
        {
          id: 'content',
          role: 'content',
          rows: [
            {
              id: 'r1',
              blocks: [{ id: 'b1', type: 'image', src: 'banner.png', layout: { aspectRatio: '16/9' } }],
            },
          ],
        },
      ],
    }
    const out = collectFormElementImages([stepWithDoc('oid-step-42', doc)])
    expect(out).toEqual([{ zipPath: 'oid-step-42-banner.png', imageStoreKey: 'banner.png' }])
  })

  it('returns [] for a step with no form_document (e.g. a non-form step type)', () => {
    const other: MasterWorkflowStep = {
      local_id: 'Start',
      oid: 'oid-start',
      version: '1.0.0',
      last_modified_date: '2026-07-23T00:00:00.000Z',
      step_type: 'START',
    }
    expect(collectFormElementImages([other])).toEqual([])
  })

  it('walks multiple steps, each keeping its own oid-prefixed entries', () => {
    const docA: FormDocument = {
      version: 2,
      sections: [
        {
          id: 'content',
          role: 'content',
          rows: [
            {
              id: 'r1',
              blocks: [{ id: 'a1', type: 'image', src: 'a.png', imageOid: 'OID-A', layout: { aspectRatio: '16/9' } }],
            },
          ],
        },
      ],
    }
    const docB: FormDocument = {
      version: 2,
      sections: [
        {
          id: 'content',
          role: 'content',
          rows: [
            {
              id: 'r1',
              blocks: [{ id: 'b1', type: 'image', src: 'b.png', imageOid: 'OID-B', layout: { aspectRatio: '16/9' } }],
            },
          ],
        },
      ],
    }
    const out = collectFormElementImages([stepWithDoc('step-a', docA), stepWithDoc('step-b', docB)])
    expect(out).toEqual([
      { zipPath: 'OID-A-a.png', imageStoreKey: 'a.png' },
      { zipPath: 'OID-B-b.png', imageStoreKey: 'b.png' },
    ])
  })
})
