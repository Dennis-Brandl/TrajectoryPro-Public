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
import type { BreakpointKey } from './resolve'
import type { Block, FormDocument, LayoutRow, Row, Section } from './types'

/**
 * Per-screen row arrangements (2026-11-09). A section's `rows` are the desktop layout and the
 * only home of its blocks. `rowsAt.tablet` / `rowsAt.phone` re-arrange those same blocks by id.
 * Cascade: phone ?? tablet ?? desktop, the same as every other per-screen setting.
 */

/** The arrangement a screen type uses, or undefined when it shows the desktop rows. */
export function layoutRowsFor(section: Section, bp: BreakpointKey): LayoutRow[] | undefined {
  if (bp === 'base' || !section.rowsAt) return undefined
  if (bp === 'tablet') return section.rowsAt.tablet
  return section.rowsAt.phone ?? section.rowsAt.tablet
}

/** Where a screen type's rows come from: its own arrangement, or the tier it inherits. */
export function rowsSourceOf(section: Section, bp: BreakpointKey): BreakpointKey {
  if (bp === 'base' || !section.rowsAt) return 'base'
  if (bp === 'tablet') return section.rowsAt.tablet ? 'tablet' : 'base'
  if (section.rowsAt.phone) return 'phone'
  return section.rowsAt.tablet ? 'tablet' : 'base'
}

/** True when any section of the document has a tablet or phone arrangement of its own. */
export function documentHasRowsAt(doc: FormDocument): boolean {
  return doc.sections.some((s) => s.rowsAt?.tablet !== undefined || s.rowsAt?.phone !== undefined)
}

/**
 * The rows a section shows on a screen type, as full rows of blocks.
 *
 * Tolerant by design, because blocks are added, deleted and moved on other screen types:
 * an id that is not a block of this section, or that was already placed, is skipped; a row
 * left with no blocks is dropped; and every block the arrangement does not list is still
 * shown, after the arranged rows, grouped as it is on desktop. A block is never lost.
 */
export function resolveSectionRows(section: Section, bp: BreakpointKey): Row[] {
  const layout = layoutRowsFor(section, bp)
  if (!layout) return section.rows
  const byId = new Map<string, Block>()
  for (const row of section.rows) for (const b of row.blocks) byId.set(b.id, b)
  const placed = new Set<string>()
  const usedRowIds = new Set<string>()
  const out: Row[] = []
  for (const lr of layout) {
    if (usedRowIds.has(lr.id)) continue
    const blocks: Block[] = []
    for (const id of lr.blockIds) {
      const b = byId.get(id)
      if (!b || placed.has(id)) continue
      placed.add(id)
      blocks.push(b)
    }
    if (blocks.length === 0) continue
    usedRowIds.add(lr.id)
    out.push(lr.gap !== undefined ? { id: lr.id, gap: lr.gap, blocks } : { id: lr.id, blocks })
  }
  for (const row of section.rows) {
    const rest = row.blocks.filter((b) => !placed.has(b.id))
    if (rest.length === 0) continue
    let id = row.id
    while (usedRowIds.has(id)) id = `${id}~${bp}`
    usedRowIds.add(id)
    out.push(row.gap !== undefined ? { id, gap: row.gap, blocks: rest } : { id, blocks: rest })
  }
  return out
}

/** The arrangement of full rows, as stored in `rowsAt` (block ids only). */
export function toLayoutRows(rows: Row[]): LayoutRow[] {
  return rows
    .filter((r) => r.blocks.length > 0)
    .map((r) =>
      r.gap !== undefined
        ? { id: r.id, gap: r.gap, blockIds: r.blocks.map((b) => b.id) }
        : { id: r.id, blockIds: r.blocks.map((b) => b.id) },
    )
}

/**
 * Tidy a section's arrangements: drop ids that are not blocks of the section and repeats,
 * drop empty rows, and drop an empty `rowsAt`. What it shows on every screen is unchanged.
 * Hosts that save documents call this so stale ids do not pile up.
 */
export function pruneRowsAt(section: Section): Section {
  if (!section.rowsAt) return section
  const known = new Set(section.rows.flatMap((r) => r.blocks.map((b) => b.id)))
  const prune = (rows: LayoutRow[] | undefined): LayoutRow[] | undefined => {
    if (!rows) return undefined
    const seen = new Set<string>()
    const rowIds = new Set<string>()
    const out: LayoutRow[] = []
    for (const r of rows) {
      if (rowIds.has(r.id)) continue
      const blockIds: string[] = []
      for (const id of r.blockIds) {
        if (!known.has(id) || seen.has(id)) continue
        seen.add(id)
        blockIds.push(id)
      }
      if (blockIds.length === 0) continue
      rowIds.add(r.id)
      out.push({ ...r, blockIds })
    }
    // Nothing left arranged shows exactly what inheriting shows, so store nothing.
    return out.length > 0 ? out : undefined
  }
  const tablet = prune(section.rowsAt.tablet)
  const phone = prune(section.rowsAt.phone)
  const { rowsAt: _old, ...rest } = section
  if (tablet === undefined && phone === undefined) return rest
  return {
    ...rest,
    rowsAt: { ...(tablet !== undefined ? { tablet } : {}), ...(phone !== undefined ? { phone } : {}) },
  }
}
