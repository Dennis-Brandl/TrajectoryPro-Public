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

export type MoveTarget =
  | { kind: 'in-row'; rowId: string; beforeBlockId: string | null } // null = append to row end
  | { kind: 'new-row'; sectionId: string; afterRowId: string | null } // null = prepend at section top
export type RowTarget = { sectionId: string; afterRowId: string | null }

interface BlockLoc {
  sectionIdx: number
  rowIdx: number
  blockIdx: number
}

function locateBlock(doc: FormDocument, blockId: string): BlockLoc | null {
  for (let si = 0; si < doc.sections.length; si++) {
    const rows = doc.sections[si].rows
    for (let ri = 0; ri < rows.length; ri++) {
      const bi = rows[ri].blocks.findIndex((b) => b.id === blockId)
      if (bi !== -1) return { sectionIdx: si, rowIdx: ri, blockIdx: bi }
    }
  }
  return null
}

function spanBase(b: Block): number {
  return b.layout?.span?.base ?? 12
}

/** Structural + span-base identity: the fields that make a document render differently. Used to
 *  collapse no-op moves back to the original reference so no phantom undo entry is recorded. */
export function structuresEqual(a: FormDocument, b: FormDocument): boolean {
  if (a.sections.length !== b.sections.length) return false
  for (let i = 0; i < a.sections.length; i++) {
    const sa = a.sections[i]
    const sb = b.sections[i]
    if (sa.id !== sb.id || sa.rows.length !== sb.rows.length) return false
    for (let j = 0; j < sa.rows.length; j++) {
      const ra = sa.rows[j]
      const rb = sb.rows[j]
      if (ra.id !== rb.id || ra.blocks.length !== rb.blocks.length) return false
      for (let k = 0; k < ra.blocks.length; k++) {
        if (ra.blocks[k].id !== rb.blocks[k].id) return false
        if (spanBase(ra.blocks[k]) !== spanBase(rb.blocks[k])) return false
      }
    }
  }
  return true
}

export function moveBlock(doc: FormDocument, blockId: string, target: MoveTarget): FormDocument {
  const loc = locateBlock(doc, blockId)
  if (!loc) return doc
  const sourceRow = doc.sections[loc.sectionIdx].rows[loc.rowIdx]
  const block = { ...sourceRow.blocks[loc.blockIdx] }
  const soleInRow = sourceRow.blocks.length === 1

  // Guard: dropping a lone block into the gap immediately after its own row = no change.
  if (soleInRow && target.kind === 'new-row' && target.afterRowId === sourceRow.id) return doc
  // Guard: dropping a lone block into its own row = no change (there is no other position
  // within a single-block row to move it to; without this, removal prunes the row before
  // the in-row insert runs, and the block is spliced nowhere — silently lost).
  if (soleInRow && target.kind === 'in-row' && target.rowId === sourceRow.id) return doc

  // 1. Remove from source; re-apportion a surviving source row; prune an emptied one.
  const removed: FormDocument = {
    ...doc,
    sections: doc.sections.map((s, si) => {
      if (si !== loc.sectionIdx) return s
      const rows = s.rows
        .map((r, ri) => {
          if (ri !== loc.rowIdx) return r
          const blocks = r.blocks.filter((b) => b.id !== blockId)
          return blocks.length > 0 ? { ...r, blocks: apportionRowSpans(blocks) } : { ...r, blocks }
        })
        .filter((r) => r.blocks.length > 0)
      return { ...s, rows }
    }),
  }

  // Guard: a stale/unknown target id would drop the just-removed block (removal already ran
  // above). Treat it as a no-op instead of silently losing content.
  const targetExists =
    target.kind === 'in-row'
      ? removed.sections.some((s) => s.rows.some((r) => r.id === target.rowId))
      : removed.sections.some((s) => s.id === target.sectionId)
  if (!targetExists) return doc

  // 2. Insert at the target.
  let next: FormDocument
  if (target.kind === 'in-row') {
    next = {
      ...removed,
      sections: removed.sections.map((s) => ({
        ...s,
        rows: s.rows.map((r) => {
          if (r.id !== target.rowId) return r
          const idx = target.beforeBlockId === null ? -1 : r.blocks.findIndex((b) => b.id === target.beforeBlockId)
          const at = idx === -1 ? r.blocks.length : idx // unknown/absent beforeBlockId → append to end
          const blocks = [...r.blocks]
          blocks.splice(at, 0, block)
          return { ...r, blocks: apportionRowSpans(blocks) }
        }),
      })),
    }
  } else {
    // sole-block move reuses the row id so it reads as moving the row (enables no-op detection).
    const newRow: Row = {
      id: soleInRow ? sourceRow.id : generateOID(WORKER_INTERNAL),
      blocks: apportionRowSpans([block]), // single block → span.base 12, overrides preserved
    }
    next = {
      ...removed,
      sections: removed.sections.map((s) => {
        if (s.id !== target.sectionId) return s
        const anchor = target.afterRowId === null ? -1 : s.rows.findIndex((r) => r.id === target.afterRowId)
        const at = target.afterRowId === null ? 0 : anchor === -1 ? s.rows.length : anchor + 1
        const rows = [...s.rows]
        rows.splice(at, 0, newRow)
        return { ...s, rows }
      }),
    }
  }

  return structuresEqual(doc, next) ? doc : next
}

export function moveRow(doc: FormDocument, rowId: string, target: RowTarget): FormDocument {
  // "after self" = keep in place.
  if (target.afterRowId === rowId) return doc

  let moved: Row | null = null
  const withoutRow: FormDocument = {
    ...doc,
    sections: doc.sections.map((s) => {
      const idx = s.rows.findIndex((r) => r.id === rowId)
      if (idx === -1) return s
      moved = s.rows[idx]
      return { ...s, rows: s.rows.filter((r) => r.id !== rowId) }
    }),
  }
  if (!moved) return doc
  // Guard: an unknown target section id would drop the just-removed row. No-op instead.
  if (!withoutRow.sections.some((s) => s.id === target.sectionId)) return doc

  const next: FormDocument = {
    ...withoutRow,
    sections: withoutRow.sections.map((s) => {
      if (s.id !== target.sectionId) return s
      const anchor = target.afterRowId === null ? -1 : s.rows.findIndex((r) => r.id === target.afterRowId)
      const at = target.afterRowId === null ? 0 : anchor === -1 ? s.rows.length : anchor + 1
      const rows = [...s.rows]
      rows.splice(at, 0, moved as Row)
      return { ...s, rows }
    }),
  }
  return structuresEqual(doc, next) ? doc : next
}

export function insertBlockAt(doc: FormDocument, block: Block, target: MoveTarget): FormDocument {
  if (target.kind === 'in-row') {
    return {
      ...doc,
      sections: doc.sections.map((s) => ({
        ...s,
        rows: s.rows.map((r) => {
          if (r.id !== target.rowId) return r
          const idx = target.beforeBlockId === null ? -1 : r.blocks.findIndex((b) => b.id === target.beforeBlockId)
          const at = idx === -1 ? r.blocks.length : idx // unknown/absent beforeBlockId → append to end
          const blocks = [...r.blocks]
          blocks.splice(at, 0, block)
          return { ...r, blocks: apportionRowSpans(blocks) }
        }),
      })),
    }
  }
  const newRow: Row = { id: generateOID(WORKER_INTERNAL), blocks: apportionRowSpans([block]) }
  return {
    ...doc,
    sections: doc.sections.map((s) => {
      if (s.id !== target.sectionId) return s
      const anchor = target.afterRowId === null ? -1 : s.rows.findIndex((r) => r.id === target.afterRowId)
      const at = target.afterRowId === null ? 0 : anchor === -1 ? s.rows.length : anchor + 1
      const rows = [...s.rows]
      rows.splice(at, 0, newRow)
      return { ...s, rows }
    }),
  }
}
