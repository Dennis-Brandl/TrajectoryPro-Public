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
import { validateFormDocument, type Block, type FormDocument, type LayoutRow, type Section } from '@mission/form-schema'
import { applyScreenEdit, normalizeForSave, projectForScreen, resetScreenRows, screenRowsSource } from '../screen-rows'
import { moveBlock, moveRow, insertBlockAt } from '../structural-ops'
import { arrangeColumns, ownRowTarget, rowAboveTarget } from '../column-ops'
import { resizeSpan } from '../span-resize'
import {
  deleteBlockFromDocument,
  duplicateBlockInDocument,
  insertBlockIntoBottomBar,
  insertBlockIntoDocument,
} from '../document-ops'

const text = (id: string, extra: Partial<Block> = {}): Block => ({ id, type: 'text', content: id, ...extra }) as Block
const button = (id: string): Block => ({ id, type: 'button', label: id, job: 'continue' }) as unknown as Block

/** rows: one string per row, e.g. ['A', 'BC'] = row r0 holds A, row r1 holds B and C. */
function section(id: string, rows: string[], rowsAt?: Section['rowsAt'], role: Section['role'] = 'content'): Section {
  return {
    id,
    role,
    rows: rows.map((r, i) => ({ id: `${id}r${i}`, blocks: [...r].map((b) => text(b)) })),
    ...(rowsAt ? { rowsAt } : {}),
  }
}
const lr = (id: string, ids: string): LayoutRow => ({ id, blockIds: [...ids] })
const docOf = (...sections: Section[]): FormDocument => ({ version: 2, sections })

const desktop = (d: FormDocument, si = 0) => d.sections[si].rows.map((r) => r.blocks.map((b) => b.id).join(''))
const layout = (rows: LayoutRow[] | undefined) => rows?.map((r) => r.blockIds.join(''))
const shown = (d: FormDocument, bp: 'base' | 'tablet' | 'phone', si = 0) => desktop(projectForScreen(d, bp), si)

let n = 0
const newId = () => `new${++n}`

describe('projectForScreen', () => {
  it('returns the document itself when no section has rowsAt, on every screen', () => {
    const d = docOf(section('s', ['A', 'B']))
    expect(projectForScreen(d, 'base')).toBe(d)
    expect(projectForScreen(d, 'tablet')).toBe(d)
    expect(projectForScreen(d, 'phone')).toBe(d)
  })

  it("shows each screen's rows, with no rowsAt and the same block objects", () => {
    const d = docOf(section('s', ['A', 'B', 'C'], { tablet: [lr('t', 'AB'), lr('u', 'C')] }))
    const t = projectForScreen(d, 'tablet')
    expect(desktop(t)).toEqual(['AB', 'C'])
    expect(t.sections[0].rowsAt).toBeUndefined()
    expect(t.sections[0].rows[0].blocks[0]).toBe(d.sections[0].rows[0].blocks[0])
    expect(shown(d, 'phone')).toEqual(['AB', 'C']) // Phone inherits Tablet
    expect(shown(d, 'base')).toEqual(['A', 'B', 'C'])
  })
})

describe('applyScreenEdit', () => {
  it('on Desktop runs the edit on the document itself and carries rowsAt through', () => {
    const d = docOf(section('s', ['A', 'B'], { tablet: [lr('t', 'AB')] }))
    const out = applyScreenEdit(d, 'base', (v) => moveBlock(v, 'B', rowAboveTarget(v, 'B')!), newId)
    expect(desktop(out)).toEqual(['AB'])
    expect(layout(out.sections[0].rowsAt?.tablet)).toEqual(['AB'])
  })

  it('a move on Tablet leaves the desktop rows alone and writes only rowsAt.tablet', () => {
    const d = docOf(section('s', ['A', 'B', 'C']))
    const out = applyScreenEdit(d, 'tablet', (v) => moveBlock(v, 'B', rowAboveTarget(v, 'B')!, 'tablet'), newId)
    expect(desktop(out)).toEqual(['A', 'B', 'C'])
    expect(layout(out.sections[0].rowsAt?.tablet)).toEqual(['AB', 'C'])
    expect(out.sections[0].rowsAt?.phone).toBeUndefined()
    expect(shown(out, 'phone')).toEqual(['AB', 'C'])
  })

  it('writes the tablet spans of a Tablet move, never the desktop spans', () => {
    const d = docOf(section('s', ['A', 'B']))
    const out = applyScreenEdit(d, 'tablet', (v) => moveBlock(v, 'B', rowAboveTarget(v, 'B')!, 'tablet'), newId)
    const [a, b] = projectForScreen(out, 'tablet').sections[0].rows[0].blocks
    expect(a.layout?.span).toEqual({ base: 12, tablet: 6 })
    expect(b.layout?.span).toEqual({ base: 12, tablet: 6 })
  })

  it('a Phone edit while Phone inherits Tablet writes only rowsAt.phone', () => {
    const d = docOf(section('s', ['A', 'B', 'C'], { tablet: [lr('t', 'AB'), lr('u', 'C')] }))
    const out = applyScreenEdit(d, 'phone', (v) => moveBlock(v, 'B', ownRowTarget(v, 'B')!, 'phone'), newId)
    expect(desktop(out)).toEqual(['A', 'B', 'C'])
    expect(layout(out.sections[0].rowsAt?.tablet)).toEqual(['AB', 'C'])
    expect(layout(out.sections[0].rowsAt?.phone)).toEqual(['A', 'B', 'C'])
  })

  it('a delete on Tablet removes the element everywhere', () => {
    const d = docOf(section('s', ['AB', 'C'], { tablet: [lr('t', 'A'), lr('u', 'BC')] }))
    const out = applyScreenEdit(d, 'tablet', (v) => deleteBlockFromDocument(v, 'B'), newId)
    expect(desktop(out)).toEqual(['A', 'C'])
    expect(layout(out.sections[0].rowsAt?.tablet)).toEqual(['A', 'C'])
  })

  it('a delete on Tablet while Tablet inherits Desktop does not give Tablet rows of its own', () => {
    const d = docOf(section('s', ['A', 'B', 'C']))
    const out = applyScreenEdit(d, 'tablet', (v) => deleteBlockFromDocument(v, 'B'), newId)
    expect(desktop(out)).toEqual(['A', 'C'])
    expect(out.sections[0].rowsAt).toBeUndefined()
  })

  it("an element added on Phone gets its own desktop row after its predecessor's row", () => {
    const d = docOf(section('s', ['AB', 'C'], { phone: [lr('p', 'A'), lr('q', 'C'), lr('r', 'B')] }))
    // Phone shows A | C | B; insert X beside C on Phone.
    const view = projectForScreen(d, 'phone')
    const out = applyScreenEdit(
      d,
      'phone',
      (v) => insertBlockAt(v, text('X'), { kind: 'in-row', rowId: 'q', beforeBlockId: null }, 'phone'),
      newId,
    )
    expect(desktop(view)).toEqual(['A', 'C', 'B'])
    expect(desktop(out)).toEqual(['AB', 'C', 'X'])
    expect(layout(out.sections[0].rowsAt?.phone)).toEqual(['A', 'CX', 'B'])
    expect(out.sections[0].rows[2].id).toMatch(/^new/)
  })

  it('an element added with nothing before it goes at the start of the section on desktop', () => {
    const d = docOf(section('s', ['A', 'B'], { tablet: [lr('t', 'B'), lr('u', 'A')] }))
    const out = applyScreenEdit(
      d,
      'tablet',
      (v) => insertBlockAt(v, text('X'), { kind: 'new-row', sectionId: 's', afterRowId: null }, 'tablet'),
      newId,
    )
    expect(desktop(out)).toEqual(['X', 'A', 'B'])
    expect(layout(out.sections[0].rowsAt?.tablet)).toEqual(['X', 'B', 'A'])
  })

  it('duplicate on Phone places the copy on desktop after the original', () => {
    const d = docOf(section('s', ['AB', 'C'], { phone: [lr('p', 'C'), lr('q', 'AB')] }))
    let copyId = ''
    const out = applyScreenEdit(
      d,
      'phone',
      (v) => {
        const r = duplicateBlockInDocument(v, 'A')
        copyId = r.newId
        return r.document
      },
      newId,
    )
    const rows = out.sections[0].rows.map((r) => r.blocks.map((b) => b.id))
    expect(rows).toEqual([['A', 'B'], [copyId], ['C']])
    expect(out.sections[0].rowsAt?.phone?.map((r) => r.blockIds)).toEqual([['C'], ['A', 'B'], [copyId]])
  })

  it('paste on Phone (append) puts the element after the last element of the section', () => {
    const d = docOf(section('s', ['A', 'B'], { phone: [lr('p', 'B'), lr('q', 'A')] }))
    const out = applyScreenEdit(d, 'phone', (v) => insertBlockIntoDocument(v, text('X')), newId)
    expect(desktop(out)).toEqual(['A', 'X', 'B'])
    expect(layout(out.sections[0].rowsAt?.phone)).toEqual(['B', 'A', 'X'])
  })

  it('a move into the bottom bar on Tablet moves it on desktop too', () => {
    const d: FormDocument = docOf(section('s', ['AB', 'C']), {
      id: 'f',
      role: 'footer',
      rows: [{ id: 'fr0', blocks: [button('Y')] }],
    })
    const out = applyScreenEdit(
      d,
      'tablet',
      (v) => moveBlock(v, 'B', { kind: 'in-row', rowId: 'fr0', beforeBlockId: null }, 'tablet'),
      newId,
    )
    expect(desktop(out, 0)).toEqual(['A', 'C'])
    expect(out.sections[0].rows[0].blocks[0].layout?.span?.base).toBe(12) // desktop row re-divided
    expect(desktop(out, 1)).toEqual(['Y', 'B'])
    expect(shown(out, 'tablet', 1)).toEqual(['YB'])
    expect(layout(out.sections[1].rowsAt?.tablet)).toEqual(['YB'])
  })

  it('a section the edit adds (the realized bottom bar) is added with its rows as desktop rows', () => {
    const d = docOf(section('s', ['A', 'B']))
    const out = applyScreenEdit(d, 'tablet', (v) => insertBlockIntoBottomBar(v, button('Y'), newId), newId)
    expect(out.sections).toHaveLength(2)
    expect(out.sections[1].role).toBe('footer')
    expect(desktop(out, 1)).toEqual(['Y'])
    expect(out.sections[1].rowsAt).toBeUndefined()
  })

  it('a no-op returns the same reference', () => {
    const d = docOf(section('s', ['A', 'B'], { tablet: [lr('t', 'AB')] }))
    expect(applyScreenEdit(d, 'tablet', (v) => v, newId)).toBe(d)
    // moving a lone block into the gap after its own row is a no-op in moveBlock
    expect(
      applyScreenEdit(
        d,
        'phone',
        (v) => moveBlock(v, 'A', { kind: 'in-row', rowId: 'nope', beforeBlockId: null }, 'phone'),
        newId,
      ),
    ).toBe(d)
    // an edit that builds a new but identical document is still a no-op
    expect(applyScreenEdit(d, 'tablet', (v) => ({ ...v, sections: v.sections.map((s) => ({ ...s })) }), newId)).toBe(d)
  })

  it('resize on Tablet writes tablet spans only, and no arrangement', () => {
    const half = { layout: { span: { base: 6 as const } } }
    const d = docOf({ id: 's', role: 'content', rows: [{ id: 'r', blocks: [text('A', half), text('B', half)] }] })
    const out = applyScreenEdit(d, 'tablet', (v) => resizeSpan(v, 'A', 'B', 2, 'tablet'), newId)
    const [a, b] = out.sections[0].rows[0].blocks
    expect(a.layout?.span).toEqual({ base: 6, tablet: 8 })
    expect(b.layout?.span).toEqual({ base: 6, tablet: 4 })
    expect(out.sections[0].rowsAt).toBeUndefined()
  })

  it('arrange columns on Tablet writes tablet spans and the tablet rows only', () => {
    const d = docOf(section('s', ['A', 'B', 'C']))
    const out = applyScreenEdit(d, 'tablet', (v) => arrangeColumns(v, 'A', 3, 'tablet'), newId)
    expect(desktop(out)).toEqual(['A', 'B', 'C'])
    expect(out.sections[0].rows.map((r) => r.blocks[0].layout?.span?.base)).toEqual([12, 12, 12])
    expect(layout(out.sections[0].rowsAt?.tablet)).toEqual(['ABC'])
    expect(projectForScreen(out, 'tablet').sections[0].rows[0].blocks.map((b) => b.layout?.span?.tablet)).toEqual([
      4, 4, 4,
    ])
  })

  it('an untouched section keeps inheriting', () => {
    const d = docOf(section('s', ['A', 'B']), {
      id: 'f',
      role: 'footer',
      rows: [
        { id: 'fr0', blocks: [button('Y')] },
        { id: 'fr1', blocks: [button('Z')] },
      ],
    })
    const out = applyScreenEdit(d, 'tablet', (v) => moveRow(v, 'fr1', { sectionId: 'f', afterRowId: null }), newId)
    expect(out.sections[0].rowsAt).toBeUndefined()
    expect(layout(out.sections[1].rowsAt?.tablet)).toEqual(['Z', 'Y'])
    expect(desktop(out, 1)).toEqual(['Y', 'Z'])
  })
})

describe('resetScreenRows', () => {
  it("drops one screen's arrangement in every section, keeping the other", () => {
    const d = docOf(
      section('s', ['A', 'B'], { tablet: [lr('t', 'AB')], phone: [lr('p', 'B'), lr('q', 'A')] }),
      section('f', ['C'], { phone: [lr('p2', 'C')] }, 'footer'),
    )
    const out = resetScreenRows(d, 'phone')
    expect(out.sections[0].rowsAt).toEqual({ tablet: [lr('t', 'AB')] })
    expect('rowsAt' in out.sections[1]).toBe(false)
    expect(resetScreenRows(out, 'phone')).toBe(out)
  })
})

describe('screenRowsSource', () => {
  it('reports own / same as Tablet / same as Desktop', () => {
    const plain = docOf(section('s', ['A']))
    expect(screenRowsSource(plain, 'tablet')).toBe('base')
    expect(screenRowsSource(plain, 'phone')).toBe('base')
    const tab = docOf(section('s', ['A']), section('f', ['B'], { tablet: [lr('t', 'B')] }, 'footer'))
    expect(screenRowsSource(tab, 'tablet')).toBe('tablet')
    expect(screenRowsSource(tab, 'phone')).toBe('tablet')
    const ph = docOf(section('s', ['A'], { phone: [lr('p', 'A')] }))
    expect(screenRowsSource(ph, 'phone')).toBe('phone')
    expect(screenRowsSource(ph, 'tablet')).toBe('base')
  })
})

describe('normalizeForSave', () => {
  it('tidies stale ids and empty arrangements; returns the document when tidy', () => {
    const tidy = docOf(section('s', ['A', 'B'], { tablet: [lr('t', 'BA')] }))
    expect(normalizeForSave(tidy)).toBe(tidy)
    const stale = docOf(section('s', ['A'], { tablet: [lr('t', 'AZ'), lr('u', 'Z')], phone: [lr('p', 'Q')] }))
    const out = normalizeForSave(stale)
    expect(out.sections[0].rowsAt).toEqual({ tablet: [lr('t', 'A')] })
    expect(validateFormDocument(out).ok).toBe(true)
  })
})
