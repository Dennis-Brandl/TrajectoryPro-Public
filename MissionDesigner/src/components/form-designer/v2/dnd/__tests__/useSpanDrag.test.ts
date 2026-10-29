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
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { createSpanDragController } from '@/components/form-designer/v2/dnd/useSpanDrag'
import type { FormDocument } from '@mission/form-schema'

const doc: FormDocument = {
  version: 2,
  sections: [
    {
      id: 'sec',
      role: 'content',
      rows: [
        {
          id: 'row',
          blocks: [
            { id: 'L', type: 'text', content: '', layout: { span: { base: 6 } } },
            { id: 'R', type: 'text', content: '', layout: { span: { base: 6 } } },
          ],
        },
      ],
    },
  ],
}
const spanOf = (id: string) => {
  const b = useFormDocumentStore.getState().document.sections[0].rows[0].blocks.find((x) => x.id === id)!
  return (b.layout!.span as { base: number }).base
}
const params = { rowId: 'row', leftId: 'L', rightId: 'R', startX: 100, colWidthPx: 40, leftSpan: 6, rightSpan: 6 }

beforeEach(() => useFormDocumentStore.getState().openForNode('n', structuredClone(doc)))

describe('createSpanDragController', () => {
  it('previews live during move without recording undo, then commits one entry on end', () => {
    const c = createSpanDragController()
    c.begin(params)
    c.move(180) // +80px ≈ +2 cols
    expect(spanOf('L')).toBe(8) // live preview applied
    expect(useFormDocumentStore.temporal.getState().pastStates.length).toBe(0) // paused
    c.end()
    expect(spanOf('L')).toBe(8) // committed
    expect(useFormDocumentStore.temporal.getState().pastStates.length).toBe(1) // single entry
  })

  it('cancel restores the baseline and records nothing', () => {
    const c = createSpanDragController()
    c.begin(params)
    c.move(180)
    c.cancel()
    expect(spanOf('L')).toBe(6)
    expect(useFormDocumentStore.temporal.getState().pastStates.length).toBe(0)
  })

  it('a net-zero drag commits no undo entry', () => {
    const c = createSpanDragController()
    c.begin(params)
    c.move(180)
    c.move(100) // back to start → delta 0
    c.end()
    expect(spanOf('L')).toBe(6)
    expect(useFormDocumentStore.temporal.getState().pastStates.length).toBe(0)
  })

  it('nudge and resizeTo commit one entry each', () => {
    const c = createSpanDragController()
    c.nudge('L', 'R', 1)
    expect(spanOf('L')).toBe(7)
    c.resizeTo('L', 'R', 11)
    expect(spanOf('L')).toBe(11)
    expect(spanOf('R')).toBe(1)
    expect(useFormDocumentStore.temporal.getState().pastStates.length).toBe(2)
  })

  it('exposes the active ROW id (not a block id) during a drag', () => {
    const c = createSpanDragController()
    expect(c.activeRowId).toBe(null)
    c.begin(params)
    expect(c.activeRowId).toBe('row')
    c.end()
    expect(c.activeRowId).toBe(null)
  })

  it('a restart (begin while a prior drag is active) does not absorb the interrupted drag into the new baseline', () => {
    const c = createSpanDragController()
    c.begin(params)
    c.move(180) // interrupted drag previews +2 but never ends
    c.begin(params) // restart from the same startX (100)
    c.move(140) // +1 col from the ORIGINAL 6/6
    c.end()
    expect(spanOf('L')).toBe(7) // 6+1, NOT 8+1 — the interrupted preview was discarded
    useFormDocumentStore.temporal.getState().undo()
    expect(spanOf('L')).toBe(6) // one undo reverts to the true original, not the orphaned 8/4
  })
})
