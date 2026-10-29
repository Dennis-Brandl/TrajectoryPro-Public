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
import { validateFormDocument } from '@mission/form-schema'
import {
  emptyDocument,
  seedDocument,
  findBlock,
  updateBlockInDocument,
  deleteBlockFromDocument,
  insertBlockIntoDocument,
  duplicateBlockInDocument,
  insertBlockIntoBottomBar,
  withBottomBarPlaceholder,
  pruneEmptyFooters,
  isButtonsOnlyDrop,
  BOTTOM_BAR_PLACEHOLDER_ID,
} from '../document-ops'
import { createDefaultBlock } from '../create-block'

const docWithBlock: FormDocument = {
  version: 2,
  sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [{ id: 'b', type: 'text', content: 'hi' }] }] }],
}

describe('document-ops', () => {
  it('emptyDocument has one empty content section with a real id', () => {
    const d = emptyDocument()
    expect(d.version).toBe(2)
    expect(d.sections).toHaveLength(1)
    expect(d.sections[0].role).toBe('content')
    expect(d.sections[0].rows).toEqual([])
    expect(d.sections[0].id.length).toBeGreaterThan(0)
  })
  it('seedDocument returns an existing formDocument as-is', () => {
    expect(seedDocument({ formDocument: docWithBlock })).toBe(docWithBlock)
  })
  it('seedDocument returns an empty document for a blank node', () => {
    expect(seedDocument({}).sections[0].rows).toEqual([])
  })
  it('findBlock locates a nested block', () => {
    expect(findBlock(docWithBlock, 'b')?.type).toBe('text')
  })
  it('updateBlockInDocument patches immutably', () => {
    const next = updateBlockInDocument(docWithBlock, 'b', { content: 'bye' } as never)
    expect((findBlock(next, 'b') as { content: string }).content).toBe('bye')
    expect((findBlock(docWithBlock, 'b') as { content: string }).content).toBe('hi') // original untouched
    expect(next).not.toBe(docWithBlock)
  })
  it('deleteBlockFromDocument removes the block and prunes the now-empty row', () => {
    const result = deleteBlockFromDocument(docWithBlock, 'b')
    expect(findBlock(result, 'b')).toBeUndefined()
    // schema: row.blocks has minItems 1 — a row left with blocks: [] is invalid, so deleting
    // a row's sole block must prune the row itself, not just empty its blocks array.
    expect(result.sections[0].rows).toHaveLength(0)
    expect(validateFormDocument(result).ok).toBe(true)
  })
})

describe('insertBlockIntoDocument', () => {
  it('appends a new single-block row to the last content section', () => {
    const doc = { version: 2 as const, sections: [{ id: 's1', role: 'content' as const, rows: [] }] }
    const block = createDefaultBlock('text')
    const next = insertBlockIntoDocument(doc, block)
    expect(next.sections[0].rows).toHaveLength(1)
    expect(next.sections[0].rows[0].blocks[0].id).toBe(block.id)
    expect(doc.sections[0].rows).toHaveLength(0) // immutable
  })

  it('targets the last content section, not a footer', () => {
    const doc = {
      version: 2 as const,
      sections: [
        { id: 'c', role: 'content' as const, rows: [] },
        { id: 'f', role: 'footer' as const, rows: [] },
      ],
    }
    const next = insertBlockIntoDocument(doc, createDefaultBlock('divider'))
    expect(next.sections[0].rows).toHaveLength(1)
    expect(next.sections[1].rows).toHaveLength(0)
  })
})

describe('duplicateBlockInDocument', () => {
  it('inserts a fresh-identity clone in a new row right after the source row', () => {
    const src = createDefaultBlock('textInput') as { id: string; fieldName: string }
    const doc = {
      version: 2 as const,
      sections: [{ id: 's', role: 'content' as const, rows: [{ id: 'r0', blocks: [src as never] }] }],
    }
    const { document, newId } = duplicateBlockInDocument(doc, src.id)
    expect(document.sections[0].rows).toHaveLength(2)
    expect(document.sections[0].rows[1].blocks[0].id).toBe(newId)
    expect(newId).not.toBe(src.id)
    expect((document.sections[0].rows[1].blocks[0] as { fieldName: string }).fieldName).not.toBe(src.fieldName)
  })

  it('is a no-op when the block is absent', () => {
    const doc = { version: 2 as const, sections: [{ id: 's', role: 'content' as const, rows: [] }] }
    const { document, newId } = duplicateBlockInDocument(doc, 'nope')
    expect(document).toBe(doc)
    expect(newId).toBe('nope')
  })
})

describe('insertBlockIntoBottomBar', () => {
  let n = 0
  const newId = () => `id${++n}`
  it('creates a footer section when there is none', () => {
    const btn = createDefaultBlock('button')
    const out = insertBlockIntoBottomBar(docWithBlock, btn, newId)
    const footer = out.sections.find((s) => s.role === 'footer')!
    expect(out.sections[out.sections.length - 1]).toBe(footer)
    expect(footer.rows).toHaveLength(1)
    expect(footer.rows[0].blocks[0]).toBe(btn)
    expect(validateFormDocument(out).ok).toBe(true)
  })
  it('reuses an existing footer', () => {
    const one = insertBlockIntoBottomBar(docWithBlock, createDefaultBlock('button'), newId)
    const two = insertBlockIntoBottomBar(one, createDefaultBlock('button', { stepKind: 'yesno' }), newId)
    expect(two.sections.filter((s) => s.role === 'footer')).toHaveLength(1)
    expect(two.sections.find((s) => s.role === 'footer')!.rows).toHaveLength(2)
  })
})

describe('bottom bar helpers', () => {
  const content = {
    id: 's1',
    role: 'content' as const,
    rows: [{ id: 'r1', blocks: [{ id: 't', type: 'text' as const, content: 'x' }] }],
  }
  const btnRow = { id: 'rb', blocks: [{ id: 'b', type: 'button' as const, label: 'Go', outputValue: 'continue' }] }
  const base = { version: 2 as const, sections: [content] }

  it('withBottomBarPlaceholder adds one placeholder only when no footer exists', () => {
    const out = withBottomBarPlaceholder(base)
    expect(out.sections.filter((s) => s.role === 'footer')).toEqual([
      { id: BOTTOM_BAR_PLACEHOLDER_ID, role: 'footer', rows: [] },
    ])
    expect(base.sections).toHaveLength(1)
    const withFooter = { ...base, sections: [content, { id: 'f', role: 'footer' as const, rows: [btnRow] }] }
    expect(withBottomBarPlaceholder(withFooter)).toBe(withFooter)
  })

  it('pruneEmptyFooters removes an emptied footer, keeps a non-empty one, same ref when nothing to drop', () => {
    const empty = { ...base, sections: [content, { id: 'f', role: 'footer' as const, rows: [] }] }
    expect(pruneEmptyFooters(empty).sections.map((s) => s.id)).toEqual(['s1'])
    const full = { ...base, sections: [content, { id: 'f', role: 'footer' as const, rows: [btnRow] }] }
    expect(pruneEmptyFooters(full)).toBe(full)
  })

  it('isButtonsOnlyDrop: footer takes buttons only; content takes anything', () => {
    const doc = { ...base, sections: [content, { id: 'f', role: 'footer' as const, rows: [btnRow] }] }
    expect(isButtonsOnlyDrop(doc, { kind: 'block', id: 'b' }, 'f')).toBe(true)
    expect(isButtonsOnlyDrop(doc, { kind: 'block', id: 't' }, 'f')).toBe(false)
    expect(isButtonsOnlyDrop(doc, { kind: 'row', id: 'r1' }, 'f')).toBe(false)
    expect(isButtonsOnlyDrop(doc, { kind: 'row', id: 'rb' }, 'f')).toBe(true)
    expect(isButtonsOnlyDrop(doc, { kind: 'palette', type: 'text' }, BOTTOM_BAR_PLACEHOLDER_ID)).toBe(false)
    expect(isButtonsOnlyDrop(doc, { kind: 'palette', type: 'button' }, BOTTOM_BAR_PLACEHOLDER_ID)).toBe(true)
    expect(isButtonsOnlyDrop(doc, { kind: 'block', id: 'b' }, 's1')).toBe(true)
    expect(isButtonsOnlyDrop(doc, { kind: 'block', id: 't' }, 's1')).toBe(true)
  })
})
