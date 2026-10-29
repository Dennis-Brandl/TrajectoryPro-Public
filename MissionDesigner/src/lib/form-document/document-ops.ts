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
import { cloneBlockWithFreshIdentity } from '@/lib/form-document/create-block'
import type { StepNodeData } from '@/types/nodes'

/** A fresh v2 document: one empty content section (never zero sections — the renderer always
 *  has something to draw and later slices get a drop target). */
export function emptyDocument(): FormDocument {
  return { version: 2, sections: [{ id: generateOID(WORKER_INTERNAL), role: 'content', rows: [] }] }
}

/** Choose the working document on open. Existing v2 wins; else empty.
 *  (P4.2: the v1→v2 dev-seed conversion arm is gone — migration + import-minting guarantee
 *  every step that can reach the v2 editor already carries a formDocument.) */
export function seedDocument(data: Pick<StepNodeData, 'formDocument'>): FormDocument {
  if (data.formDocument) return data.formDocument
  return emptyDocument()
}

export function findBlock(doc: FormDocument, blockId: string): Block | undefined {
  for (const section of doc.sections) {
    for (const row of section.rows) {
      const block = row.blocks.find((b) => b.id === blockId)
      if (block) return block
    }
  }
  return undefined
}

/** Immutable patch of one block. `patch` is applied over the existing block, so it always
 *  matches that block's own variant by construction — the cast is safe for the editor. */
export function updateBlockInDocument(doc: FormDocument, blockId: string, patch: Partial<Block>): FormDocument {
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => ({
        ...row,
        blocks: row.blocks.map((b) => (b.id === blockId ? ({ ...b, ...patch } as Block) : b)),
      })),
    })),
  }
}

export function deleteBlockFromDocument(doc: FormDocument, blockId: string): FormDocument {
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      rows: section.rows
        .map((row) => ({ ...row, blocks: row.blocks.filter((b) => b.id !== blockId) }))
        .filter((row) => row.blocks.length > 0), // schema: row.blocks minItems 1 — prune emptied rows (NOT sections)
    })),
  }
}

/** Append a new full-width row containing `block` to the last content section.
 *  (Positional / in-row insert lives in structural-ops.insertBlockAt.) */
export function insertBlockIntoDocument(doc: FormDocument, block: Block): FormDocument {
  const row: Row = { id: generateOID(WORKER_INTERNAL), blocks: [block] }
  let idx = -1
  for (let i = doc.sections.length - 1; i >= 0; i--) {
    if (doc.sections[i].role === 'content') {
      idx = i
      break
    }
  }
  if (idx === -1) {
    return { ...doc, sections: [...doc.sections, { id: generateOID(WORKER_INTERNAL), role: 'content', rows: [row] }] }
  }
  return { ...doc, sections: doc.sections.map((s, i) => (i === idx ? { ...s, rows: [...s.rows, row] } : s)) }
}

/** Append a new full-width row containing `block` to the first footer section (the bottom bar),
 *  creating a footer section at the end when there is none. */
export function insertBlockIntoBottomBar(doc: FormDocument, block: Block, newId: () => string): FormDocument {
  const row: Row = { id: newId(), blocks: [block] }
  const idx = doc.sections.findIndex((s) => s.role === 'footer')
  if (idx === -1) {
    return { ...doc, sections: [...doc.sections, { id: newId(), role: 'footer', rows: [row] }] }
  }
  return { ...doc, sections: doc.sections.map((s, i) => (i === idx ? { ...s, rows: [...s.rows, row] } : s)) }
}

/** Id of the display-only bottom-bar placeholder section. It never reaches the store or saved data. */
export const BOTTOM_BAR_PLACEHOLDER_ID = '__bottom-bar__'

/** For display only: when the doc has no footer section, append an empty placeholder footer so the
 *  author has a bottom bar to drop buttons onto. Returns the same reference when a footer exists. */
export function withBottomBarPlaceholder(doc: FormDocument): FormDocument {
  if (doc.sections.some((s) => s.role === 'footer')) return doc
  return { ...doc, sections: [...doc.sections, { id: BOTTOM_BAR_PLACEHOLDER_ID, role: 'footer', rows: [] }] }
}

/** Drop footer sections that hold no blocks. Same reference when there is nothing to drop. */
export function pruneEmptyFooters(doc: FormDocument): FormDocument {
  const keep = doc.sections.filter((s) => s.role !== 'footer' || s.rows.some((r) => r.blocks.length > 0))
  return keep.length === doc.sections.length ? doc : { ...doc, sections: keep }
}

export type DraggedThing =
  | { kind: 'block'; id: string }
  | { kind: 'row'; id: string }
  | { kind: 'palette'; type: string }

/** The bottom bar takes buttons only. True when dropping `dragged` into `targetSectionId` is allowed:
 *  any non-footer target, or a footer/placeholder target and only buttons are being dropped. */
export function isButtonsOnlyDrop(doc: FormDocument, dragged: DraggedThing, targetSectionId: string): boolean {
  const target = doc.sections.find((s) => s.id === targetSectionId)
  const isFooter = targetSectionId === BOTTOM_BAR_PLACEHOLDER_ID || target?.role === 'footer'
  if (!isFooter) return true
  if (dragged.kind === 'palette') return dragged.type === 'button'
  if (dragged.kind === 'block') return findBlock(doc, dragged.id)?.type === 'button'
  const row = doc.sections.flatMap((s) => s.rows).find((r) => r.id === dragged.id)
  return !!row && row.blocks.every((b) => b.type === 'button')
}

/** Clone the block (fresh id/imageOid/fieldName) into a new row immediately after the source's row. */
export function duplicateBlockInDocument(
  doc: FormDocument,
  blockId: string,
): { document: FormDocument; newId: string } {
  const source = findBlock(doc, blockId)
  if (!source) return { document: doc, newId: blockId }
  const clone = cloneBlockWithFreshIdentity(source)
  const newRow: Row = { id: generateOID(WORKER_INTERNAL), blocks: [clone] }
  const sections = doc.sections.map((section) => {
    const rowIdx = section.rows.findIndex((r) => r.blocks.some((b) => b.id === blockId))
    if (rowIdx === -1) return section
    const rows = [...section.rows]
    rows.splice(rowIdx + 1, 0, newRow)
    return { ...section, rows }
  })
  return { document: { ...doc, sections }, newId: clone.id }
}
