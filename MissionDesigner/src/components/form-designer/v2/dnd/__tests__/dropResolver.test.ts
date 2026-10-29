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
import {
  blockDragId,
  rowDragId,
  paletteDragId,
  gapDropId,
  slotDropId,
  barDropId,
  preferPreciseZones,
} from '../dragTypes'
import { BOTTOM_BAR_PLACEHOLDER_ID } from '@/lib/form-document/document-ops'
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

describe('dropResolver: bottom bar is buttons only', () => {
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
  it('rejects a text block / its row / a text palette item into a footer or the placeholder', () => {
    expect(dropResolver(blockDragId('t'), gapDropId('f', null), doc)).toBeNull()
    expect(dropResolver(rowDragId('rt'), gapDropId('f', 'rf'), doc)).toBeNull()
    expect(dropResolver(paletteDragId('text'), gapDropId(BOTTOM_BAR_PLACEHOLDER_ID, null), doc)).toBeNull()
    expect(dropResolver(blockDragId('t'), slotDropId('rf', null), doc)).toBeNull()
  })
  it('a button dropped on the placeholder resolves to a new-row move targeting it', () => {
    expect(dropResolver(blockDragId('b'), gapDropId(BOTTOM_BAR_PLACEHOLDER_ID, null), doc)).toEqual({
      op: 'moveBlock',
      blockId: 'b',
      target: { kind: 'new-row', sectionId: BOTTOM_BAR_PLACEHOLDER_ID, afterRowId: null },
    })
  })
  it('moving a button out of the footer into content is allowed', () => {
    expect(dropResolver(blockDragId('b'), gapDropId('c', null), doc)).not.toBeNull()
  })
})

describe('dropResolver: the whole bottom bar is a drop target', () => {
  const button = (id: string) => ({ id, type: 'button' as const, label: '', job: 'yes' as const, outputValue: 'true' })
  const docWithBar = (rows: { id: string; blocks: ReturnType<typeof button>[] }[]) => ({
    version: 2 as const,
    sections: [
      { id: 'c', role: 'content' as const, rows: [] },
      { id: 'f', role: 'footer' as const, rows },
    ],
  })
  it('a palette Button dropped on the bar body joins the last row, beside the last button', () => {
    expect(
      dropResolver(paletteDragId('button'), barDropId('f'), docWithBar([{ id: 'rf', blocks: [button('y')] }])),
    ).toEqual({
      op: 'insertBlockAt',
      type: 'button',
      target: { kind: 'in-row', rowId: 'rf', beforeBlockId: null },
    })
  })
  it('a moved button dropped on the bar body joins the last row too', () => {
    const doc = docWithBar([
      { id: 'r1', blocks: [button('a')] },
      { id: 'r2', blocks: [button('b')] },
    ])
    expect(dropResolver(blockDragId('a'), barDropId('f'), doc)).toEqual({
      op: 'moveBlock',
      blockId: 'a',
      target: { kind: 'in-row', rowId: 'r2', beforeBlockId: null },
    })
  })
  it('a full last row (12 blocks) gets a new row after it', () => {
    const blocks = Array.from({ length: 12 }, (_, i) => button(`b${i}`))
    expect(dropResolver(paletteDragId('button'), barDropId('f'), docWithBar([{ id: 'full', blocks }]))).toEqual({
      op: 'insertBlockAt',
      type: 'button',
      target: { kind: 'new-row', sectionId: 'f', afterRowId: 'full' },
    })
  })
  it('the empty placeholder bar gets a new first row', () => {
    const doc = { version: 2 as const, sections: [{ id: 'c', role: 'content' as const, rows: [] }] }
    expect(dropResolver(paletteDragId('button'), barDropId(BOTTOM_BAR_PLACEHOLDER_ID), doc)).toEqual({
      op: 'insertBlockAt',
      type: 'button',
      target: { kind: 'new-row', sectionId: BOTTOM_BAR_PLACEHOLDER_ID, afterRowId: null },
    })
  })
  it('non-buttons and rows are refused on the bar body', () => {
    const doc = docWithBar([{ id: 'rf', blocks: [button('y')] }])
    expect(dropResolver(paletteDragId('text'), barDropId('f'), doc)).toBeNull()
    expect(dropResolver(rowDragId('rf'), barDropId('f'), doc)).toBeNull()
  })
})

describe('preferPreciseZones', () => {
  it('puts the bar body behind every precise gap/slot the pointer is also within', () => {
    const c = (id: string) => ({ id, data: { value: 0 } })
    const out = preferPreciseZones([c(barDropId('f')), c(slotDropId('r', null)), c(gapDropId('f', 'r'))])
    expect(out.map((x) => x.id)).toEqual([slotDropId('r', null), gapDropId('f', 'r'), barDropId('f')])
  })
})
