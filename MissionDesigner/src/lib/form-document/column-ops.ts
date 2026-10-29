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

import type { Block, FormDocument, Row } from '@mission/form-schema'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import { apportionRowSpans } from './span-apportion'
import { structuresEqual, type MoveTarget } from './structural-ops'

/** A row holds at most 12 blocks — one per grid column (same limit as drag-and-drop). */
const MAX_ROW_BLOCKS = 12

function locate(doc: FormDocument, blockId: string): { si: number; ri: number } | null {
  for (let si = 0; si < doc.sections.length; si++) {
    const ri = doc.sections[si].rows.findIndex((r) => r.blocks.some((b) => b.id === blockId))
    if (ri !== -1) return { si, ri }
  }
  return null
}

/** "Move into row above": the end of the previous row in the same section; null for the first
 *  row or when that row is already full. Apply with moveBlock. */
export function rowAboveTarget(doc: FormDocument, blockId: string): MoveTarget | null {
  const loc = locate(doc, blockId)
  if (!loc || loc.ri === 0) return null
  const above = doc.sections[loc.si].rows[loc.ri - 1]
  if (above.blocks.length >= MAX_ROW_BLOCKS) return null
  return { kind: 'in-row', rowId: above.id, beforeBlockId: null }
}

/** "Move to its own row": a new row just below the element's row; null when it is already
 *  alone. Apply with moveBlock. */
export function ownRowTarget(doc: FormDocument, blockId: string): MoveTarget | null {
  const loc = locate(doc, blockId)
  if (!loc) return null
  const section = doc.sections[loc.si]
  const row = section.rows[loc.ri]
  if (row.blocks.length < 2) return null
  return { kind: 'new-row', sectionId: section.id, afterRowId: row.id }
}

/**
 * "Arrange in N columns": make the element's row hold `n` elements. Short rows pull elements up,
 * one at a time and in order, from the rows below it in the same section (a row left empty is
 * removed); long rows push the extra elements down onto new rows of `n` just below. Column
 * widths are re-divided evenly. Returns `doc` itself when nothing changes.
 */
export function arrangeColumns(doc: FormDocument, blockId: string, n: number): FormDocument {
  const loc = locate(doc, blockId)
  const cols = Math.max(1, Math.min(MAX_ROW_BLOCKS, Math.floor(n)))
  if (!loc) return doc
  const section = doc.sections[loc.si]
  const rows: Row[] = section.rows.map((r) => ({ ...r, blocks: [...r.blocks] }))
  const row = rows[loc.ri]
  const touched = new Set<Row>([row])

  if (row.blocks.length < cols) {
    const next = loc.ri + 1
    while (row.blocks.length < cols && next < rows.length) {
      const donor = rows[next]
      row.blocks.push(donor.blocks.shift() as Block)
      touched.add(donor)
      if (donor.blocks.length === 0) rows.splice(next, 1)
    }
  }

  const extras = row.blocks.splice(cols)
  const newRows: Row[] = []
  for (let i = 0; i < extras.length; i += cols) {
    const r: Row = { id: generateOID(WORKER_INTERNAL), blocks: extras.slice(i, i + cols) }
    newRows.push(r)
    touched.add(r)
  }
  rows.splice(rows.indexOf(row) + 1, 0, ...newRows)

  for (const r of touched) r.blocks = apportionRowSpans(r.blocks)
  const next: FormDocument = {
    ...doc,
    sections: doc.sections.map((s, si) => (si === loc.si ? { ...s, rows } : s)),
  }
  return structuresEqual(doc, next) ? doc : next
}
