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
import { injectSpecImagesAsDataUris } from '../injectSpecImages'
import type { ImportPlan } from '../parseEnvelope'
import type { SafeZipImage } from '../safeZipReader'

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000000500' +
    '010da25e6c0000000049454e44ae426082',
  'hex',
)
const PNG_DATA_URI = `data:image/png;base64,${PNG_BYTES.toString('base64')}`

function makeSpec(sourceId: string, data: object): ImportPlan['specs'][number] {
  return {
    sourceId,
    parentSourceId: null,
    rootSourceId: sourceId,
    name: sourceId,
    description: null,
    version: '1.0.0',
    state: 'Draft',
    dataJson: JSON.stringify(data),
    dataSchemaVersion: 3,
  }
}

function emptyPlan(specs: ImportPlan['specs'], imageRefs: ImportPlan['imageRefs']): ImportPlan {
  return { specs, imageRefs, proxyRefs: [], specEnvs: [], pendingEnvLibraryLinks: [] }
}

const ZIP_IMAGE_FORM_ELEMENT: SafeZipImage = {
  filename: 'oid-cover-cover.png', // form-element naming: {imageOid}-{filename}
  mimeType: 'image/png',
  bytes: PNG_BYTES,
}

describe('injectSpecImagesAsDataUris', () => {
  it('writes a data URI under spec.data.images for a form-element imageRef', () => {
    const spec = makeSpec('spec-1', {})
    const plan = emptyPlan([spec], [{ specSourceId: 'spec-1', filename: 'cover.png' }])

    injectSpecImagesAsDataUris(plan, [ZIP_IMAGE_FORM_ELEMENT])

    const data = JSON.parse(plan.specs[0].dataJson) as { images?: Record<string, string> }
    expect(data.images?.['cover.png']).toBe(PNG_DATA_URI)
  })

  it('dedupes refs with the same filename across multiple form layouts', () => {
    const spec = makeSpec('spec-1', {})
    const plan = emptyPlan(
      [spec],
      [
        { specSourceId: 'spec-1', filename: 'cover.png' },
        { specSourceId: 'spec-1', filename: 'cover.png' },
        { specSourceId: 'spec-1', filename: 'cover.png' },
      ],
    )

    injectSpecImagesAsDataUris(plan, [ZIP_IMAGE_FORM_ELEMENT])

    const data = JSON.parse(plan.specs[0].dataJson) as { images: Record<string, string> }
    expect(Object.keys(data.images)).toEqual(['cover.png'])
  })

  it('preserves an existing images map and adds new entries alongside it', () => {
    const spec = makeSpec('spec-1', { images: { 'logo.png': 'data:image/svg+xml;base64,XYZ' } })
    const plan = emptyPlan([spec], [{ specSourceId: 'spec-1', filename: 'cover.png' }])

    injectSpecImagesAsDataUris(plan, [ZIP_IMAGE_FORM_ELEMENT])

    const data = JSON.parse(plan.specs[0].dataJson) as { images: Record<string, string> }
    expect(data.images['logo.png']).toBe('data:image/svg+xml;base64,XYZ')
    expect(data.images['cover.png']).toBe(PNG_DATA_URI)
  })

  it('keys images map by bare filename even when ZIP entry has a stepOid prefix', () => {
    const spec = makeSpec('spec-1', {})
    const plan = emptyPlan([spec], [{ specSourceId: 'spec-1', filename: 'cover.png' }])

    injectSpecImagesAsDataUris(plan, [{ filename: 'oid-banner-cover.png', mimeType: 'image/png', bytes: PNG_BYTES }])

    const data = JSON.parse(plan.specs[0].dataJson) as { images: Record<string, string> }
    expect(Object.keys(data.images)).toEqual(['cover.png'])
  })

  it('isolates images per spec — refs do not bleed across specs', () => {
    const a = makeSpec('spec-a', {})
    const b = makeSpec('spec-b', {})
    const plan = emptyPlan(
      [a, b],
      [
        { specSourceId: 'spec-a', filename: 'cover.png' },
        { specSourceId: 'spec-b', filename: 'logo.png' },
      ],
    )

    injectSpecImagesAsDataUris(plan, [
      ZIP_IMAGE_FORM_ELEMENT,
      { filename: 'oid-x-logo.png', mimeType: 'image/png', bytes: PNG_BYTES },
    ])

    const dataA = JSON.parse(plan.specs[0].dataJson) as { images: Record<string, string> }
    const dataB = JSON.parse(plan.specs[1].dataJson) as { images: Record<string, string> }
    expect(Object.keys(dataA.images)).toEqual(['cover.png'])
    expect(Object.keys(dataB.images)).toEqual(['logo.png'])
  })

  it('skips refs whose bytes are not in the ZIP and leaves data unchanged', () => {
    const spec = makeSpec('spec-1', {})
    const plan = emptyPlan([spec], [{ specSourceId: 'spec-1', filename: 'gone.png' }])

    injectSpecImagesAsDataUris(plan, [ZIP_IMAGE_FORM_ELEMENT])

    const data = JSON.parse(plan.specs[0].dataJson) as { images?: Record<string, string> }
    expect(data.images).toBeUndefined()
  })

  it('is a no-op when there are no imageRefs at all', () => {
    const spec = makeSpec('spec-1', { foo: 'bar' })
    const plan = emptyPlan([spec], [])

    injectSpecImagesAsDataUris(plan, [ZIP_IMAGE_FORM_ELEMENT])

    expect(plan.specs[0].dataJson).toBe(JSON.stringify({ foo: 'bar' }))
  })

  it('matches by exact bare filename when the ZIP entry has no prefix (UI parameter image)', () => {
    const spec = makeSpec('spec-1', {})
    const plan = emptyPlan([spec], [{ specSourceId: 'spec-1', filename: 'banner.png' }])

    injectSpecImagesAsDataUris(plan, [{ filename: 'banner.png', mimeType: 'image/png', bytes: PNG_BYTES }])

    const data = JSON.parse(plan.specs[0].dataJson) as { images: Record<string, string> }
    expect(data.images['banner.png']).toBe(PNG_DATA_URI)
  })
})
