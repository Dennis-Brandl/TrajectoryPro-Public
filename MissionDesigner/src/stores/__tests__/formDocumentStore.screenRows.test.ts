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
import { describe, it, expect, beforeEach } from 'vitest'
import type { Block, FormDocument } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

const half = { layout: { span: { base: 6 as const } } }
const doc = (): FormDocument => ({
  version: 2,
  sections: [
    {
      id: 'c',
      role: 'content',
      rows: [
        {
          id: 'r1',
          blocks: [
            { id: 'a', type: 'text', content: 'a', ...half },
            { id: 'b', type: 'text', content: 'b', ...half },
          ],
        },
        { id: 'r2', blocks: [{ id: 'c', type: 'text', content: 'c' }] },
      ],
      // Tablet: a | b c
      rowsAt: {
        tablet: [
          { id: 't1', blockIds: ['a'] },
          { id: 't2', blockIds: ['b', 'c'] },
        ],
      },
    },
  ],
})

const store = () => useFormDocumentStore.getState()
const past = () => useFormDocumentStore.temporal.getState().pastStates.length
const desktopShape = () => store().document.sections[0].rows.map((r) => r.blocks.map((b) => b.id).join(''))
const tabletShape = () => store().document.sections[0].rowsAt?.tablet?.map((r) => r.blockIds.join(''))

beforeEach(() => {
  store().close()
  useFormDocumentStore.temporal.getState().clear()
})

function onTablet(): FormDocument {
  const d = doc()
  store().openForNode('n', d)
  store().setActiveBreakpoint('tablet')
  return store().document
}

/** Every op on the Tablet tab is ONE undo step, and undo gives back the very same document. */
const ops: [string, () => void][] = [
  ['deleteBlock', () => store().deleteBlock('b')],
  ['insertBlock', () => store().insertBlock('divider')],
  [
    'insertBlockInBottomBar',
    () => store().insertBlockInBottomBar({ id: 'y', type: 'button', label: 'Go', job: 'continue' } as unknown as Block),
  ],
  ['moveBlock', () => store().moveBlock('a', { kind: 'in-row', rowId: 't2', beforeBlockId: null })],
  [
    'moveBlock into the bottom-bar placeholder',
    () => store().moveBlock('a', { kind: 'new-row', sectionId: '__bottom-bar__', afterRowId: null }),
  ],
  ['moveIntoRowAbove', () => store().moveIntoRowAbove('b')],
  ['moveToOwnRow', () => store().moveToOwnRow('c')],
  ['arrangeColumns', () => store().arrangeColumns('a', 3)],
  ['resizeSpan', () => store().resizeSpan('b', 'c', 2)],
  ['moveRow', () => store().moveRow('t2', { sectionId: 'c', afterRowId: null })],
  ['insertBlockAt', () => store().insertBlockAt('divider', { kind: 'in-row', rowId: 't1', beforeBlockId: null })],
  ['duplicateBlock', () => store().duplicateBlock('a')],
  ['cut', () => store().cut('a')],
  [
    'paste',
    () => {
      store().copy('a')
      store().paste()
    },
  ],
  ['resetScreenRows', () => store().resetScreenRows()],
]

describe('formDocumentStore on the Tablet tab', () => {
  it.each(ops)('%s is one undo step and undo restores the document exactly', (_name, run) => {
    const before = onTablet()
    run()
    expect(store().document).not.toBe(before)
    expect(past()).toBe(1)
    useFormDocumentStore.temporal.getState().undo()
    expect(store().document).toBe(before)
  })

  it('a move on Tablet changes only the Tablet rows', () => {
    onTablet()
    store().moveBlock('a', { kind: 'in-row', rowId: 't2', beforeBlockId: null })
    expect(desktopShape()).toEqual(['ab', 'c'])
    expect(tabletShape()).toEqual(['bca'])
    // desktop widths untouched; tablet widths re-divided
    const blocks = store().document.sections[0].rows.flatMap((r) => r.blocks)
    expect(blocks.map((b) => b.layout?.span?.base)).toEqual([6, 6, 12])
    expect(blocks.map((b) => b.layout?.span?.tablet)).toEqual([4, 4, 4])
  })

  it('Move into row above uses the Tablet rows', () => {
    onTablet()
    store().moveIntoRowAbove('b') // on Tablet b's row (b c) has a | above it
    expect(tabletShape()).toEqual(['ab', 'c'])
    expect(desktopShape()).toEqual(['ab', 'c'])
  })

  it('a no-op on Tablet records no undo entry', () => {
    const before = onTablet()
    store().moveRow('t2', { sectionId: 'c', afterRowId: 't1' }) // already there
    store().moveToOwnRow('a') // already alone on Tablet
    store().resizeSpan('a', 'c', 1) // not neighbours on Tablet
    expect(past()).toBe(0)
    expect(store().document).toBe(before)
  })

  it('resetScreenRows does nothing on Desktop', () => {
    const before = onTablet()
    store().setActiveBreakpoint('base')
    store().resetScreenRows()
    expect(store().document).toBe(before)
  })

  it('on Desktop the ops edit the desktop rows as before', () => {
    onTablet()
    store().setActiveBreakpoint('base')
    store().moveToOwnRow('b')
    expect(desktopShape()).toEqual(['a', 'b', 'c'])
    expect(tabletShape()).toEqual(['a', 'bc'])
  })
})
