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
import type { FormDocument, Row, Section } from '../types'
import {
  documentHasRowsAt,
  layoutRowsFor,
  pruneRowsAt,
  resolveSectionRows,
  rowsSourceOf,
  toLayoutRows,
} from '../layout-rows'
import { validateFormDocument } from '../validate'

const t = (id: string) => ({ id, type: 'text' as const, content: id })

// Desktop: [a b c] [d]
const section = (rowsAt?: Section['rowsAt']): Section => ({
  id: 's1',
  role: 'content',
  rows: [
    { id: 'r1', gap: 'lg', blocks: [t('a'), t('b'), t('c')] },
    { id: 'r2', blocks: [t('d')] },
  ],
  ...(rowsAt ? { rowsAt } : {}),
})

const ids = (rows: Row[]) => rows.map((r) => `${r.id}:${r.blocks.map((b) => b.id).join('')}`)

describe('resolveSectionRows', () => {
  it('shows the desktop rows (same array) on every screen when there is no rowsAt', () => {
    const s = section()
    expect(resolveSectionRows(s, 'base')).toBe(s.rows)
    expect(resolveSectionRows(s, 'tablet')).toBe(s.rows)
    expect(resolveSectionRows(s, 'phone')).toBe(s.rows)
  })

  it('uses the tablet arrangement on tablet, and on phone when phone has none', () => {
    const s = section({ tablet: [{ id: 't1', blockIds: ['a', 'd'] }, { id: 't2', gap: 'xs', blockIds: ['b', 'c'] }] })
    expect(ids(resolveSectionRows(s, 'base'))).toEqual(['r1:abc', 'r2:d'])
    expect(ids(resolveSectionRows(s, 'tablet'))).toEqual(['t1:ad', 't2:bc'])
    expect(ids(resolveSectionRows(s, 'phone'))).toEqual(['t1:ad', 't2:bc'])
    expect(resolveSectionRows(s, 'tablet')[1]?.gap).toBe('xs')
    expect(resolveSectionRows(s, 'tablet')[0]?.gap).toBeUndefined()
  })

  it('uses the phone arrangement on phone only', () => {
    const s = section({ phone: [{ id: 'p1', blockIds: ['d', 'c', 'b', 'a'] }] })
    expect(ids(resolveSectionRows(s, 'tablet'))).toEqual(['r1:abc', 'r2:d'])
    expect(ids(resolveSectionRows(s, 'phone'))).toEqual(['p1:dcba'])
  })

  it('returns the same block objects, never copies', () => {
    const s = section({ tablet: [{ id: 't1', blockIds: ['c'] }] })
    expect(resolveSectionRows(s, 'tablet')[0]?.blocks[0]).toBe(s.rows[0]?.blocks[2])
  })

  it('skips unknown and repeated ids, drops emptied rows, and never loses a block', () => {
    const s = section({
      tablet: [
        { id: 't1', blockIds: ['zz', 'b'] },
        { id: 't2', blockIds: ['b', 'gone'] },
        { id: 't3', blockIds: ['d'] },
      ],
    })
    // a and c are not arranged: they follow, grouped as on desktop, under the desktop row id
    expect(ids(resolveSectionRows(s, 'tablet'))).toEqual(['t1:b', 't3:d', 'r1:ac'])
    expect(resolveSectionRows(s, 'tablet')[2]?.gap).toBe('lg')
  })

  it('gives a left-over row a fresh id when its desktop id is taken by an arranged row', () => {
    const s = section({ tablet: [{ id: 'r1', blockIds: ['d'] }] })
    const rows = resolveSectionRows(s, 'tablet')
    expect(ids(rows)).toEqual(['r1:d', 'r1~tablet:abc'])
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  })

  it('a repeated row id is skipped and its blocks still show', () => {
    const s = section({ tablet: [{ id: 'x', blockIds: ['a'] }, { id: 'x', blockIds: ['b'] }] })
    expect(ids(resolveSectionRows(s, 'tablet'))).toEqual(['x:a', 'r1:bc', 'r2:d'])
  })

  it('an empty arrangement shows the desktop grouping', () => {
    expect(ids(resolveSectionRows(section({ tablet: [] }), 'tablet'))).toEqual(['r1:abc', 'r2:d'])
  })
})

describe('layoutRowsFor / rowsSourceOf', () => {
  it('reports where each screen gets its rows from', () => {
    const none = section()
    expect([rowsSourceOf(none, 'base'), rowsSourceOf(none, 'tablet'), rowsSourceOf(none, 'phone')]).toEqual([
      'base',
      'base',
      'base',
    ])
    const tab = section({ tablet: [{ id: 't', blockIds: ['a'] }] })
    expect([rowsSourceOf(tab, 'tablet'), rowsSourceOf(tab, 'phone')]).toEqual(['tablet', 'tablet'])
    const ph = section({ phone: [{ id: 'p', blockIds: ['a'] }] })
    expect([rowsSourceOf(ph, 'tablet'), rowsSourceOf(ph, 'phone')]).toEqual(['base', 'phone'])
    expect(layoutRowsFor(ph, 'base')).toBeUndefined()
    expect(layoutRowsFor(ph, 'phone')).toEqual([{ id: 'p', blockIds: ['a'] }])
  })
})

describe('toLayoutRows', () => {
  it('stores ids and gap, and drops empty rows', () => {
    const s = section()
    expect(toLayoutRows([...s.rows, { id: 'empty', blocks: [] }])).toEqual([
      { id: 'r1', gap: 'lg', blockIds: ['a', 'b', 'c'] },
      { id: 'r2', blockIds: ['d'] },
    ])
  })
})

describe('pruneRowsAt', () => {
  it('drops stale ids, repeats, empty rows and empty arrangements', () => {
    const s = section({
      tablet: [
        { id: 't1', blockIds: ['a', 'zz', 'a'] },
        { id: 't2', blockIds: ['gone'] },
      ],
      phone: [{ id: 'p1', blockIds: ['gone'] }],
    })
    expect(pruneRowsAt(s).rowsAt).toEqual({ tablet: [{ id: 't1', blockIds: ['a'] }] })
  })

  it('removes rowsAt entirely when nothing is left, and leaves a clean section as it is', () => {
    const stale = section({ tablet: [{ id: 't', blockIds: ['gone'] }] })
    expect('rowsAt' in pruneRowsAt(stale)).toBe(false)
    const clean = section()
    expect(pruneRowsAt(clean)).toBe(clean)
  })

  it('does not change what any screen shows', () => {
    const s = section({ tablet: [{ id: 't1', blockIds: ['c', 'zz'] }, { id: 't2', blockIds: ['gone'] }] })
    for (const bp of ['base', 'tablet', 'phone'] as const) {
      expect(ids(resolveSectionRows(pruneRowsAt(s), bp))).toEqual(ids(resolveSectionRows(s, bp)))
    }
  })
})

describe('schema', () => {
  const doc = (rowsAt: unknown): FormDocument => ({ version: 2, sections: [{ ...section(), rowsAt } as Section] })

  it('accepts tablet and phone arrangements', () => {
    const d = doc({ tablet: [{ id: 't1', gap: 'sm', blockIds: ['a'] }], phone: [{ id: 'p1', blockIds: ['b', 'a'] }] })
    expect(validateFormDocument(d)).toEqual({ ok: true, errors: [] })
    expect(documentHasRowsAt(d)).toBe(true)
    expect(documentHasRowsAt({ version: 2, sections: [section()] })).toBe(false)
  })

  it('rejects an unknown screen, an empty row, and a missing blockIds', () => {
    expect(validateFormDocument(doc({ desktop: [] })).ok).toBe(false)
    expect(validateFormDocument(doc({ tablet: [{ id: 't1', blockIds: [] }] })).ok).toBe(false)
    expect(validateFormDocument(doc({ tablet: [{ id: 't1' }] })).ok).toBe(false)
  })

  it('arrangement row ids may repeat desktop row ids (they are never on screen together)', () => {
    expect(validateFormDocument(doc({ tablet: [{ id: 'r1', blockIds: ['d'] }] })).ok).toBe(true)
  })
})
