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
// P4.1 pins: export emits the canonical v2 FormDocument verbatim as form_document.
// - ids kept (no strip), no RichTextContent wrapper, no SYNCED_PROPERTIES harmonize
// - undesigned steps (no formDocument / no blocks) emit NOTHING (no default-button backfill)
// - form_element_images walks v2 image blocks (placeholder + remote srcs excluded)
import { describe, expect, it } from 'vitest'
import type { FormDocument } from '@mission/form-schema'
import { extractFormDocument, extractFormElementImages } from '../step-extractors'

const designedDoc: FormDocument = {
  version: 2,
  sections: [
    {
      id: 'content',
      role: 'content',
      rows: [
        { id: 'r1', blocks: [{ id: 'b-text', type: 'text', content: '<b>Hello</b>' }] },
        {
          id: 'r2',
          blocks: [
            { id: 'b-img', type: 'image', src: 'photo.png', imageOid: 'IMGOID1', layout: { aspectRatio: '16/9' } },
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
              src: 'No image selected',
              imageOid: 'IMGOID3',
              layout: { aspectRatio: '16/9' },
            },
          ],
        },
      ],
    },
  ],
}

describe('extractFormDocument', () => {
  it('returns the persisted document verbatim (same reference, ids and HTML content intact)', () => {
    const out = extractFormDocument({ formDocument: designedDoc })
    expect(out).toBe(designedDoc)
    expect(out!.sections[0].rows[0].blocks[0]).toEqual({ id: 'b-text', type: 'text', content: '<b>Hello</b>' })
  })
  it('returns undefined when formDocument is absent (undesigned step — NO backfill)', () => {
    expect(extractFormDocument({})).toBeUndefined()
  })
  it('returns undefined for an empty document (sections with no blocks)', () => {
    const empty: FormDocument = { version: 2, sections: [{ id: 'content', role: 'content', rows: [] }] }
    expect(extractFormDocument({ formDocument: empty })).toBeUndefined()
  })
})

describe('extractFormElementImages (v2)', () => {
  it('collects {image_oid, filename} from local image blocks, deduped by imageOid', () => {
    expect(extractFormElementImages({ formDocument: designedDoc })).toEqual([
      { image_oid: 'IMGOID1', filename: 'photo.png' },
    ])
  })
  it('excludes http(s)/data: srcs and the "No image selected" placeholder', () => {
    const out = extractFormElementImages({ formDocument: designedDoc })
    expect(out!.some((i) => i.image_oid === 'IMGOID2' || i.image_oid === 'IMGOID3')).toBe(false)
  })
  it('returns undefined when there is no formDocument', () => {
    expect(extractFormElementImages({})).toBeUndefined()
  })
})
