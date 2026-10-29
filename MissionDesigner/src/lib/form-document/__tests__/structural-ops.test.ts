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
import type { Block, FormDocument } from '@mission/form-schema'
import { validateFormDocument } from '@mission/form-schema'
import { moveBlock, moveRow, insertBlockAt } from '../structural-ops'

const blk = (id: string, span?: number): Block => ({
  id,
  type: 'text',
  content: id,
  layout: span ? { span: { base: span as never } } : undefined,
})
const doc = (): FormDocument => ({
  version: 2,
  sections: [
    {
      id: 's',
      role: 'content',
      rows: [
        { id: 'r1', blocks: [blk('a')] },
        { id: 'r2', blocks: [blk('b', 6), blk('c', 6)] },
      ],
    },
  ],
})

describe('moveBlock', () => {
  it('reorders within a row (spans unchanged, new reference)', () => {
    const next = moveBlock(doc(), 'c', { kind: 'in-row', rowId: 'r2', beforeBlockId: 'b' })
    expect(next.sections[0].rows[1].blocks.map((x) => x.id)).toEqual(['c', 'b'])
    expect(next).not.toBe(doc())
    expect(validateFormDocument(next).ok).toBe(true)
  })
  it('drop-beside joins a row and auto-apportions (6·6 → 4·4·4)', () => {
    // move sole block "a" beside b/c in r2 (before 'b')
    const next = moveBlock(doc(), 'a', { kind: 'in-row', rowId: 'r2', beforeBlockId: 'b' })
    const r2 = next.sections[0].rows.find((r) => r.id === 'r2')!
    expect(r2.blocks.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(r2.blocks.map((x) => x.layout?.span?.base)).toEqual([4, 4, 4])
    // source row r1 held only 'a' → pruned
    expect(next.sections[0].rows.some((r) => r.id === 'r1')).toBe(false)
    expect(validateFormDocument(next).ok).toBe(true)
  })
  it('moving a block OUT of a multi-block row re-apportions the survivors', () => {
    const next = moveBlock(doc(), 'b', { kind: 'new-row', sectionId: 's', afterRowId: 'r2' })
    const r2 = next.sections[0].rows.find((r) => r.id === 'r2')!
    expect(r2.blocks.map((x) => x.id)).toEqual(['c'])
    expect(r2.blocks[0].layout?.span?.base).toBe(12) // lone survivor → full width
  })
  it('drop-between creates a new full-width row at the target position', () => {
    const next = moveBlock(doc(), 'b', { kind: 'new-row', sectionId: 's', afterRowId: 'r1' })
    // 'b' left r2 (now [c]); new row with 'b' sits right after r1
    const ids = next.sections[0].rows.map((r) => r.blocks.map((x) => x.id).join(''))
    expect(ids).toEqual(['a', 'b', 'c'])
    const bRow = next.sections[0].rows[1]
    expect(bRow.blocks[0].layout?.span?.base).toBe(12)
  })
  it('a sole block dropped after its own row is a no-op (same reference)', () => {
    const d = doc()
    expect(moveBlock(d, 'a', { kind: 'new-row', sectionId: 's', afterRowId: 'r1' })).toBe(d)
  })
  it('a sole block dropped into its own row is a no-op (same reference)', () => {
    const d = doc()
    expect(moveBlock(d, 'a', { kind: 'in-row', rowId: 'r1', beforeBlockId: null })).toBe(d)
  })
  it('preserves per-breakpoint span overrides when moving to a new row (base→12)', () => {
    const d: FormDocument = {
      version: 2,
      sections: [
        {
          id: 'c',
          role: 'content',
          rows: [
            {
              id: 'r',
              blocks: [
                { id: 'x', type: 'text', content: 'x', layout: { span: { base: 6, phone: 3 } } },
                { id: 'y', type: 'text', content: 'y', layout: { span: { base: 6 } } },
              ],
            },
          ],
        },
      ],
    }
    const next = moveBlock(d, 'x', { kind: 'new-row', sectionId: 'c', afterRowId: 'r' })
    const xRow = next.sections[0].rows.find((r) => r.blocks[0].id === 'x')!
    expect(xRow.blocks[0].layout?.span).toEqual({ base: 12, phone: 3 })
  })
  it('is a no-op when the block is absent (same reference)', () => {
    const d = doc()
    expect(moveBlock(d, 'nope', { kind: 'new-row', sectionId: 's', afterRowId: null })).toBe(d)
  })
  it('an in-place in-row reorder is a no-op (same reference — no phantom undo)', () => {
    // r2 = [b, c]; moving b to before c is its current position → structuresEqual → same ref.
    const d = doc()
    expect(moveBlock(d, 'b', { kind: 'in-row', rowId: 'r2', beforeBlockId: 'c' })).toBe(d)
  })
  it('an unknown target row/section is a no-op (does not drop the block)', () => {
    const d = doc()
    expect(moveBlock(d, 'a', { kind: 'in-row', rowId: 'nope', beforeBlockId: null })).toBe(d)
    expect(moveBlock(d, 'a', { kind: 'new-row', sectionId: 'nope', afterRowId: null })).toBe(d)
  })
  it('a missing beforeBlockId appends rather than front-inserting', () => {
    const next = moveBlock(doc(), 'a', { kind: 'in-row', rowId: 'r2', beforeBlockId: 'ghost' })
    expect(next.sections[0].rows.find((r) => r.id === 'r2')!.blocks.map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('moveRow', () => {
  const twoContentPlusFooter = (): import('@mission/form-schema').FormDocument => ({
    version: 2,
    sections: [
      {
        id: 'c',
        role: 'content',
        rows: [
          { id: 'r1', blocks: [{ id: 'a', type: 'text', content: 'a' }] },
          { id: 'r2', blocks: [{ id: 'b', type: 'text', content: 'b' }] },
        ],
      },
      { id: 'f', role: 'footer', rows: [] },
    ],
  })
  it('reorders rows within a section', () => {
    const next = moveRow(twoContentPlusFooter(), 'r2', { sectionId: 'c', afterRowId: null })
    expect(next.sections[0].rows.map((r) => r.id)).toEqual(['r2', 'r1'])
  })
  it('moves a row into the footer section, blocks intact', () => {
    const next = moveRow(twoContentPlusFooter(), 'r1', { sectionId: 'f', afterRowId: null })
    expect(next.sections[0].rows.map((r) => r.id)).toEqual(['r2'])
    expect(next.sections[1].rows.map((r) => r.id)).toEqual(['r1'])
    expect(next.sections[1].rows[0].blocks[0].id).toBe('a')
  })
  it('is a no-op (same reference) when dropped in place', () => {
    const d = twoContentPlusFooter()
    expect(moveRow(d, 'r2', { sectionId: 'c', afterRowId: 'r1' })).toBe(d)
    expect(moveRow(d, 'r1', { sectionId: 'c', afterRowId: 'r1' })).toBe(d) // "after self" guard
  })
  it('is a no-op when the row is absent', () => {
    const d = twoContentPlusFooter()
    expect(moveRow(d, 'nope', { sectionId: 'c', afterRowId: null })).toBe(d)
  })
  it('an unknown target section is a no-op (does not drop the row)', () => {
    const d = twoContentPlusFooter()
    expect(moveRow(d, 'r1', { sectionId: 'nope', afterRowId: null })).toBe(d)
  })
})

describe('insertBlockAt', () => {
  const oneRow = (): import('@mission/form-schema').FormDocument => ({
    version: 2,
    sections: [{ id: 'c', role: 'content', rows: [{ id: 'r', blocks: [{ id: 'a', type: 'text', content: 'a' }] }] }],
  })
  const fresh = (): Block => ({ id: 'z', type: 'text', content: 'z' })
  it('inserts beside an existing block and apportions (→ 6·6)', () => {
    const next = insertBlockAt(oneRow(), fresh(), { kind: 'in-row', rowId: 'r', beforeBlockId: null })
    const r = next.sections[0].rows[0]
    expect(r.blocks.map((b) => b.id)).toEqual(['a', 'z'])
    expect(r.blocks.map((b) => b.layout?.span?.base)).toEqual([6, 6])
  })
  it('inserts as a new full-width row at the target position', () => {
    const next = insertBlockAt(oneRow(), fresh(), { kind: 'new-row', sectionId: 'c', afterRowId: 'r' })
    expect(next.sections[0].rows).toHaveLength(2)
    expect(next.sections[0].rows[1].blocks[0].id).toBe('z')
  })
  it('apportions the block on a new-row insert (span.base normalised to 12)', () => {
    const spanned: Block = { id: 'z', type: 'text', content: 'z', layout: { span: { base: 6 as never } } }
    const next = insertBlockAt(oneRow(), spanned, { kind: 'new-row', sectionId: 'c', afterRowId: 'r' })
    const zRow = next.sections[0].rows.find((r) => r.blocks[0]?.id === 'z')!
    expect(zRow.blocks[0].layout?.span?.base).toBe(12)
  })
})
