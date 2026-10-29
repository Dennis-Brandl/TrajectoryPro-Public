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

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSpecificationStore } from '../../specificationStore'
import {
  getSpecImages,
  setSpecImage,
  removeSpecImage,
  setSpecImages,
  snapshotReferencedImages,
  dedupeImageFilename,
} from '../imageHelpers'
import type { Specification } from '../types'
import type { WorkflowNode } from '@/types/nodes'

// Mock the saveScheduler so tests don't fire real timers
vi.mock('../saveScheduler', () => ({ scheduleFlush: vi.fn() }))

function makeSpec(overrides: Partial<Specification> = {}): Specification {
  return {
    id: 'spec-1',
    parentSpecificationId: null,
    rootSpecificationId: 'spec-1',
    libraryId: 'lib-1',
    name: 'Test Spec',
    description: null,
    typeName: null,
    version: '1.0.0',
    state: 'Draft',
    data: {},
    dataSchemaVersion: 3,
    history: [],
    createdAt: 1000,
    updatedAt: 1000,
    lastEditedByUserId: null,
    ...overrides,
  }
}

function seedSpec(overrides: Partial<Specification> = {}): Specification {
  const spec = makeSpec(overrides)
  useSpecificationStore.setState((s) => {
    s.specs.set(spec.id, { ...spec })
  })
  return spec
}

beforeEach(() => {
  useSpecificationStore.getState()._reset()
})

// ─── getSpecImages ───────────────────────────────────────────────────────────

describe('getSpecImages', () => {
  it('returns the images map when present', () => {
    seedSpec({ data: { images: { 'foo.png': 'data:image/png;base64,abc' } } })
    expect(getSpecImages('spec-1')).toEqual({ 'foo.png': 'data:image/png;base64,abc' })
  })

  it('returns empty object when data has no images key', () => {
    seedSpec({ data: { nodes: [] } })
    expect(getSpecImages('spec-1')).toEqual({})
  })

  it('returns empty object when spec does not exist', () => {
    expect(getSpecImages('nonexistent')).toEqual({})
  })

  it('returns empty object for null specId', () => {
    expect(getSpecImages(null)).toEqual({})
  })
})

// ─── setSpecImage ────────────────────────────────────────────────────────────

describe('setSpecImage', () => {
  it('adds an image to a spec with empty data', () => {
    seedSpec({ data: {} })
    setSpecImage('spec-1', 'hero.png', 'data:image/png;base64,XYZ')
    const images = getSpecImages('spec-1')
    expect(images).toEqual({ 'hero.png': 'data:image/png;base64,XYZ' })
  })

  it('merges without clobbering existing images', () => {
    seedSpec({ data: { images: { 'existing.png': 'data:image/png;base64,AAA' } } })
    setSpecImage('spec-1', 'new.png', 'data:image/png;base64,BBB')
    const images = getSpecImages('spec-1')
    expect(images).toEqual({
      'existing.png': 'data:image/png;base64,AAA',
      'new.png': 'data:image/png;base64,BBB',
    })
  })

  it('replaces an existing image with the same filename', () => {
    seedSpec({ data: { images: { 'photo.jpg': 'data:image/jpeg;base64,OLD' } } })
    setSpecImage('spec-1', 'photo.jpg', 'data:image/jpeg;base64,NEW')
    const images = getSpecImages('spec-1')
    expect(images).toEqual({ 'photo.jpg': 'data:image/jpeg;base64,NEW' })
  })

  it('does not clobber other data keys on the spec', () => {
    seedSpec({ data: { nodes: [{ id: 'n1' }], edges: [] } })
    setSpecImage('spec-1', 'img.png', 'data:image/png;base64,ZZZ')
    const spec = useSpecificationStore.getState().specs.get('spec-1')!
    expect(spec.data.nodes).toEqual([{ id: 'n1' }])
    expect(spec.data.edges).toEqual([])
  })

  it('is a no-op on null specId', () => {
    // Should not throw
    expect(() => setSpecImage(null, 'img.png', 'data:image/png;base64,XYZ')).not.toThrow()
  })
})

// ─── removeSpecImage ─────────────────────────────────────────────────────────

describe('removeSpecImage', () => {
  it('removes an existing image by filename', () => {
    seedSpec({
      data: {
        images: {
          'keep.png': 'data:image/png;base64,AAA',
          'remove.png': 'data:image/png;base64,BBB',
        },
      },
    })
    removeSpecImage('spec-1', 'remove.png')
    expect(getSpecImages('spec-1')).toEqual({ 'keep.png': 'data:image/png;base64,AAA' })
  })

  it('is idempotent on a missing filename', () => {
    seedSpec({ data: { images: { 'only.png': 'data:image/png;base64,CCC' } } })
    expect(() => removeSpecImage('spec-1', 'nonexistent.png')).not.toThrow()
    expect(getSpecImages('spec-1')).toEqual({ 'only.png': 'data:image/png;base64,CCC' })
  })

  it('is idempotent when no images key exists', () => {
    seedSpec({ data: {} })
    expect(() => removeSpecImage('spec-1', 'img.png')).not.toThrow()
    expect(getSpecImages('spec-1')).toEqual({})
  })

  it('is a no-op on null specId', () => {
    expect(() => removeSpecImage(null, 'img.png')).not.toThrow()
  })
})

// ─── setSpecImages ────────────────────────────────────────────────────────────

describe('setSpecImages', () => {
  it('replaces the entire images map', () => {
    seedSpec({ data: { images: { 'old.png': 'data:image/png;base64,OLD' } } })
    setSpecImages('spec-1', { 'new1.png': 'data:AAA', 'new2.png': 'data:BBB' })
    expect(getSpecImages('spec-1')).toEqual({ 'new1.png': 'data:AAA', 'new2.png': 'data:BBB' })
  })

  it('can set an empty map (clearing all images)', () => {
    seedSpec({ data: { images: { 'old.png': 'data:image/png;base64,OLD' } } })
    setSpecImages('spec-1', {})
    expect(getSpecImages('spec-1')).toEqual({})
  })

  it('is a no-op on null specId', () => {
    expect(() => setSpecImages(null, { 'img.png': 'data:AAA' })).not.toThrow()
  })
})

// ─── snapshotReferencedImages ─────────────────────────────────────────────────

describe('snapshotReferencedImages', () => {
  type DocBlock = { id: string; type: string; src?: string }

  /** Builds a WorkflowNode with a single-section/single-row v2 formDocument containing
   *  `blocks`, mirroring the old v1 makeNode(formLayouts) fixture shape this replaces. */
  function makeNode(blocks: DocBlock[] | undefined = undefined, id = 'node-1'): WorkflowNode {
    return {
      id,
      type: 'userInteractionStep',
      position: { x: 0, y: 0 },
      data: {
        label: 'Test Node',
        stepType: 'userInteractionStep',
        ...(blocks !== undefined
          ? {
              formDocument: {
                version: 2,
                sections: [{ id: 'sec', role: 'content', rows: [{ id: 'row', blocks }] }],
              },
            }
          : {}),
      },
    } as WorkflowNode
  }

  it('collects local image srcs from formDocument blocks', () => {
    seedSpec({
      data: {
        images: {
          'photo.jpg': 'data:image/jpeg;base64,IMG1',
          'icon.png': 'data:image/png;base64,IMG2',
        },
      },
    })

    const node = makeNode([
      { id: 'b1', type: 'image', src: 'photo.jpg' },
      { id: 'b2', type: 'image', src: 'icon.png' },
    ])

    const result = snapshotReferencedImages('spec-1', [node])
    expect(result).toEqual({
      'photo.jpg': 'data:image/jpeg;base64,IMG1',
      'icon.png': 'data:image/png;base64,IMG2',
    })
  })

  it('ignores blocks with external http/https URLs', () => {
    seedSpec({ data: { images: { 'local.png': 'data:image/png;base64,LOCAL' } } })

    const node = makeNode([
      { id: 'b1', type: 'image', src: 'https://example.com/photo.jpg' },
      { id: 'b2', type: 'image', src: 'http://cdn.example.com/icon.png' },
      { id: 'b3', type: 'image', src: 'local.png' },
    ])

    const result = snapshotReferencedImages('spec-1', [node])
    expect(result).toEqual({ 'local.png': 'data:image/png;base64,LOCAL' })
  })

  it('collects from multiple rows/sections and multiple nodes, deduplicates', () => {
    seedSpec({
      data: {
        images: {
          'shared.png': 'data:image/png;base64,SHARED',
          'other.png': 'data:image/png;base64,OTHER',
        },
      },
    })

    const node1: WorkflowNode = {
      id: 'node-1',
      type: 'userInteractionStep',
      position: { x: 0, y: 0 },
      data: {
        label: 'Test Node',
        stepType: 'userInteractionStep',
        formDocument: {
          version: 2,
          sections: [
            {
              id: 'sec',
              role: 'content',
              rows: [
                { id: 'row1', blocks: [{ id: 'b1', type: 'image', src: 'shared.png' }] },
                { id: 'row2', blocks: [{ id: 'b2', type: 'image', src: 'shared.png' }] },
              ],
            },
          ],
        },
      },
    } as WorkflowNode
    const node2 = makeNode([{ id: 'b3', type: 'image', src: 'other.png' }], 'node-2')

    const result = snapshotReferencedImages('spec-1', [node1, node2])
    expect(result).toEqual({
      'shared.png': 'data:image/png;base64,SHARED',
      'other.png': 'data:image/png;base64,OTHER',
    })
  })

  it('ignores non-image blocks', () => {
    seedSpec({ data: { images: { 'photo.png': 'data:image/png;base64,PHOTO' } } })

    const node = makeNode([
      { id: 'b1', type: 'text', src: 'should-be-ignored' },
      { id: 'b2', type: 'button', src: 'also-ignored' },
      { id: 'b3', type: 'image', src: 'photo.png' },
    ])

    const result = snapshotReferencedImages('spec-1', [node])
    expect(result).toEqual({ 'photo.png': 'data:image/png;base64,PHOTO' })
  })

  it('skips images not found in the spec images map', () => {
    seedSpec({ data: { images: { 'present.png': 'data:image/png;base64,PRESENT' } } })

    const node = makeNode([
      { id: 'b1', type: 'image', src: 'missing.png' },
      { id: 'b2', type: 'image', src: 'present.png' },
    ])

    const result = snapshotReferencedImages('spec-1', [node])
    expect(result).toEqual({ 'present.png': 'data:image/png;base64,PRESENT' })
  })

  it('returns empty object on null specId', () => {
    const node = makeNode([{ id: 'b1', type: 'image', src: 'photo.png' }])
    expect(snapshotReferencedImages(null, [node])).toEqual({})
  })

  it('returns empty object when no nodes have formDocument', () => {
    seedSpec({ data: { images: { 'photo.png': 'data:image/png;base64,X' } } })
    const node = makeNode(undefined)
    expect(snapshotReferencedImages('spec-1', [node])).toEqual({})
  })

  it('collects from v2 formDocument image blocks (imageOid + layout carried, unrelated to src matching)', () => {
    seedSpec({ data: { images: { 'photo.png': 'data:image/png;base64,AAA' } } })

    const nodes = [
      {
        id: 'n1',
        data: {
          formDocument: {
            version: 2,
            sections: [
              {
                id: 'c',
                role: 'content',
                rows: [
                  {
                    id: 'r',
                    blocks: [
                      { id: 'b', type: 'image', src: 'photo.png', imageOid: 'O1', layout: { aspectRatio: '16/9' } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    ]

    const result = snapshotReferencedImages('spec-1', nodes as never)
    expect(result).toEqual({ 'photo.png': 'data:image/png;base64,AAA' })
  })
})

describe('dedupeImageFilename', () => {
  it('returns the name unchanged when unused', () => {
    expect(dedupeImageFilename({}, 'photo.png')).toBe('photo.png')
    expect(dedupeImageFilename({ 'other.png': 'x' }, 'photo.png')).toBe('photo.png')
  })
  it('inserts a counter before the extension on collision', () => {
    expect(dedupeImageFilename({ 'photo.png': 'x' }, 'photo.png')).toBe('photo-1.png')
    expect(dedupeImageFilename({ 'photo.png': 'x', 'photo-1.png': 'y' }, 'photo.png')).toBe('photo-2.png')
  })
  it('handles names without an extension', () => {
    expect(dedupeImageFilename({ photo: 'x' }, 'photo')).toBe('photo-1')
  })
})
