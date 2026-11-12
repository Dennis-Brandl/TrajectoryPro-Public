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
import { blockDragId, rowDragId, paletteDragId, gapDropId, slotDropId, parseDropId } from '../dragTypes'
import { dropResolver } from '../dropResolver'

describe('dropResolver', () => {
  it('block over a gap → moveBlock new-row', () => {
    expect(dropResolver(blockDragId('b'), gapDropId('sec', 'r1'))).toEqual({
      op: 'moveBlock',
      blockId: 'b',
      target: { kind: 'new-row', sectionId: 'sec', afterRowId: 'r1' },
    })
  })
  it('gap @top decodes to afterRowId null', () => {
    expect(dropResolver(blockDragId('b'), gapDropId('sec', null))).toEqual({
      op: 'moveBlock',
      blockId: 'b',
      target: { kind: 'new-row', sectionId: 'sec', afterRowId: null },
    })
  })
  it('block over a slot → moveBlock in-row', () => {
    expect(dropResolver(blockDragId('b'), slotDropId('r2', 'c'))).toEqual({
      op: 'moveBlock',
      blockId: 'b',
      target: { kind: 'in-row', rowId: 'r2', beforeBlockId: 'c' },
    })
  })
  it('slot @end decodes to beforeBlockId null', () => {
    expect(dropResolver(blockDragId('b'), slotDropId('r2', null))).toEqual({
      op: 'moveBlock',
      blockId: 'b',
      target: { kind: 'in-row', rowId: 'r2', beforeBlockId: null },
    })
  })
  it('palette over a slot → insertBlockAt in-row', () => {
    expect(dropResolver(paletteDragId('divider'), slotDropId('r', null))).toEqual({
      op: 'insertBlockAt',
      type: 'divider',
      target: { kind: 'in-row', rowId: 'r', beforeBlockId: null },
    })
  })
  it('row over a gap → moveRow', () => {
    expect(dropResolver(rowDragId('r2'), gapDropId('sec', 'r1'))).toEqual({
      op: 'moveRow',
      rowId: 'r2',
      target: { sectionId: 'sec', afterRowId: 'r1' },
    })
  })
  it('row over a slot → null (rows cannot go inside a row)', () => {
    expect(dropResolver(rowDragId('r2'), slotDropId('r1', null))).toBeNull()
  })
  it('no droppable → null', () => {
    expect(dropResolver(blockDragId('b'), null)).toBeNull()
  })
})

describe('dropResolver: an old bottom bar is buttons only', () => {
  const doc = {
    version: 2 as const,
    sections: [
      {
        id: 'c',
        role: 'content' as const,
        rows: [{ id: 'rt', blocks: [{ id: 't', type: 'text' as const, content: 'x' }] }],
      },
      {
        id: 'f',
        role: 'footer' as const,
        rows: [{ id: 'rf', blocks: [{ id: 'b', type: 'button' as const, label: 'Go', outputValue: 'continue' }] }],
      },
    ],
  }
  it('rejects a text block / its row / a text palette item into a footer', () => {
    expect(dropResolver(blockDragId('t'), gapDropId('f', null), doc)).toBeNull()
    expect(dropResolver(rowDragId('rt'), gapDropId('f', 'rf'), doc)).toBeNull()
    expect(dropResolver(paletteDragId('text'), gapDropId('f', null), doc)).toBeNull()
    expect(dropResolver(blockDragId('t'), slotDropId('rf', null), doc)).toBeNull()
  })
  it('an old button can still move within its footer', () => {
    expect(dropResolver(blockDragId('b'), gapDropId('f', null), doc)).toEqual({
      op: 'moveBlock',
      blockId: 'b',
      target: { kind: 'new-row', sectionId: 'f', afterRowId: null },
    })
  })
  it('moving a button out of the footer into content is allowed', () => {
    expect(dropResolver(blockDragId('b'), gapDropId('c', null), doc)).not.toBeNull()
  })
})

describe('dropResolver: bottom bar drop zone no longer exists', () => {
  const doc = {
    version: 2 as const,
    sections: [
      { id: 'c', role: 'content' as const, rows: [] },
      {
        id: 'f',
        role: 'footer' as const,
        rows: [{ id: 'rf', blocks: [{ id: 'y', type: 'button' as const, label: '', outputValue: 'continue' }] }],
      },
    ],
  }
  it('a bar: id is not a drop target', () => {
    expect(parseDropId('bar:f')).toBeNull()
    expect(dropResolver(blockDragId('y'), 'bar:f', doc)).toBeNull()
    expect(dropResolver(paletteDragId('text'), 'bar:f', doc)).toBeNull()
  })
  it('a palette Button drag is not recognised', () => {
    expect(dropResolver('palette:button', gapDropId('c', null), doc)).toBeNull()
  })
})
