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
import {
  pruneRowsAt,
  resolveSectionRows,
  rowsSourceOf,
  toLayoutRows,
  type Block,
  type BreakpointKey,
  type FormDocument,
  type Row,
  type Section,
} from '@mission/form-schema'
import { apportionRowSpans } from './span-apportion'

/**
 * Per-screen rows in the form editor (2026-11-09). A section's `rows` are the desktop rows and
 * the one home of every block; `rowsAt.tablet` / `rowsAt.phone` re-arrange the same blocks by id.
 *
 * The editor works on a PROJECTED document for the active tab (that screen's rows as plain
 * `rows`, no `rowsAt`), so every existing structural op keeps working unchanged. `applyScreenEdit`
 * then writes the op's result back: block content and element add/delete/section moves to the
 * real document, and the new row grouping to that screen's own arrangement.
 */

function withoutRowsAt(section: Section): Section {
  if (section.rowsAt === undefined) return section
  const { rowsAt: _rowsAt, ...rest } = section
  return rest
}

/** The document as one screen type shows it: every section's rows are that screen's rows and no
 *  section carries `rowsAt`. Returns `doc` itself when no section has `rowsAt` (on any screen). */
export function projectForScreen(doc: FormDocument, bp: BreakpointKey): FormDocument {
  if (!doc.sections.some((s) => s.rowsAt !== undefined)) return doc
  return {
    ...doc,
    sections: doc.sections.map((s) => ({ ...withoutRowsAt(s), rows: resolveSectionRows(s, bp) })),
  }
}

/** Same rows, the same blocks in each, and the same gaps (row ids are not compared). */
function sameGrouping(a: Row[], b: Row[]): boolean {
  const ra = a.filter((r) => r.blocks.length > 0)
  const rb = b.filter((r) => r.blocks.length > 0)
  if (ra.length !== rb.length) return false
  for (let i = 0; i < ra.length; i++) {
    if (ra[i].gap !== rb[i].gap || ra[i].blocks.length !== rb[i].blocks.length) return false
    for (let j = 0; j < ra[i].blocks.length; j++) if (ra[i].blocks[j].id !== rb[i].blocks[j].id) return false
  }
  return true
}

/** Key-order-insensitive structural equality for plain JSON data. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * Run a structural edit on the screen tab being edited.
 *
 * Desktop (`base`): the edit runs on the document itself, exactly as before; `rowsAt` is carried
 * through untouched (ids it no longer finds are skipped when shown and tidied on save).
 *
 * Tablet / Phone: the edit runs on that screen's projected rows, then is written back:
 * - block content (spans and other per-screen settings the op wrote) replaces the document's;
 * - an element moved to another section (content vs bottom bar) moves on desktop too, onto a row
 *   of its own at the end of that section;
 * - an element the edit removed is deleted (there is one element; hiding per screen is Visible);
 * - a new element goes on desktop on a row of its own, just after the desktop row of the element
 *   before it on this screen (at the section's start when nothing is before it);
 * - a section the edit added (the bottom bar) is added with these rows as its desktop rows;
 * - a section whose rows now differ from what this screen would otherwise show gets this
 *   screen's own arrangement; other sections are left inheriting.
 * A no-op edit returns `doc` itself (undo equality is by reference).
 */
export function applyScreenEdit(
  doc: FormDocument,
  bp: BreakpointKey,
  edit: (view: FormDocument) => FormDocument,
  newId: () => string,
): FormDocument {
  if (bp === 'base') return edit(doc)
  const view = projectForScreen(doc, bp)
  const next = edit(view)
  if (next === view) return doc
  const result = writeBack(doc, view, next, bp, newId)
  return deepEqual(result, doc) ? doc : result
}

function writeBack(
  doc: FormDocument,
  view: FormDocument,
  next: FormDocument,
  bp: BreakpointKey,
  newId: () => string,
): FormDocument {
  const nextLoc = new Map<string, { block: Block; sectionId: string }>()
  for (const s of next.sections)
    for (const r of s.rows) for (const b of r.blocks) nextLoc.set(b.id, { block: b, sectionId: s.id })
  const docSectionOf = new Map<string, string>()
  for (const s of doc.sections) for (const r of s.rows) for (const b of r.blocks) docSectionOf.set(b.id, s.id)
  const docSectionIds = new Set(doc.sections.map((s) => s.id))
  const nextById = new Map(next.sections.map((s) => [s.id, s]))

  // Desktop rows of the existing sections: keep the blocks still in this section, with the
  // edited content. A row that lost an element to another section is re-divided (as a desktop
  // move would); deletion leaves widths alone (as a desktop delete does). Empty rows go.
  const sections: Section[] = doc.sections.map((s) => {
    const rows: Row[] = []
    for (const row of s.rows) {
      const kept: Block[] = []
      let movedOut = false
      for (const b of row.blocks) {
        const loc = nextLoc.get(b.id)
        if (loc?.sectionId === s.id) kept.push(loc.block)
        else if (loc) movedOut = true
      }
      if (kept.length === 0) continue
      rows.push({ ...row, blocks: movedOut ? apportionRowSpans(kept) : kept })
    }
    return { ...s, rows }
  })

  // Moved-in and new elements, in this screen's order of each section.
  sections.forEach((s, si) => {
    const ns = nextById.get(s.id)
    if (!ns) return
    const rows = [...s.rows]
    let prevId: string | null = null
    for (const b of ns.rows.flatMap((r) => r.blocks)) {
      const from = docSectionOf.get(b.id)
      if (from !== s.id) {
        if (from !== undefined) {
          rows.push({ id: newId(), blocks: apportionRowSpans([b]) })
        } else {
          const after = prevId === null ? -1 : rows.findIndex((r) => r.blocks.some((x) => x.id === prevId))
          rows.splice(after + 1, 0, { id: newId(), blocks: [b] })
        }
      }
      prevId = b.id
    }
    sections[si] = { ...s, rows }
  })

  // A section the edit added (the realized bottom bar): its rows are its desktop rows.
  for (const ns of next.sections) {
    if (docSectionIds.has(ns.id)) continue
    sections.push({ ...withoutRowsAt(ns), rows: ns.rows.filter((r) => r.blocks.length > 0) })
  }

  // This screen's arrangement, per section: left alone where the edit did not change the rows
  // (an untouched section keeps inheriting). Where it did, a screen that already has its own
  // rows stores the new ones; a screen that inherits stores them only when they now differ from
  // what it inherits (a delete, or an add that landed the same on desktop, keeps it inheriting).
  const viewById = new Map(view.sections.map((s) => [s.id, s]))
  const out = sections.map((s) => {
    const ns = nextById.get(s.id)
    const vs = viewById.get(s.id)
    if (!ns || !vs || !docSectionIds.has(s.id)) return s
    const nextRows = ns.rows.filter((r) => r.blocks.length > 0)
    if (sameGrouping(vs.rows, nextRows)) return pruneRowsAt(s)
    const ownBefore = rowsSourceOf(s, bp) === bp
    if (!ownBefore && sameGrouping(resolveSectionRows(s, bp), nextRows)) return pruneRowsAt(s)
    return pruneRowsAt({ ...s, rowsAt: { ...s.rowsAt, [bp]: toLayoutRows(nextRows) } })
  })
  return { ...doc, sections: out }
}

/** "Use Desktop rows" / "Use Tablet rows": drop one screen's own arrangement in every section, so
 *  it inherits again. Returns `doc` itself when that screen has none. */
export function resetScreenRows(doc: FormDocument, bp: 'tablet' | 'phone'): FormDocument {
  let changed = false
  const sections = doc.sections.map((s) => {
    if (s.rowsAt?.[bp] === undefined) return s
    changed = true
    const { [bp]: _dropped, ...restAt } = s.rowsAt
    const rest = withoutRowsAt(s)
    return Object.keys(restAt).length > 0 ? { ...rest, rowsAt: restAt } : rest
  })
  return changed ? { ...doc, sections } : doc
}

/** Tidy every section's arrangements before the form is saved. Returns `doc` when already tidy. */
export function normalizeForSave(doc: FormDocument): FormDocument {
  let changed = false
  const sections = doc.sections.map((s) => {
    const p = pruneRowsAt(s)
    if (p !== s && !deepEqual(p, s)) changed = true
    return p
  })
  return changed ? { ...doc, sections } : doc
}

/** Where a screen tab's rows come from, over the whole form: its own arrangement if ANY section
 *  has one, else the tier it inherits (Phone shows Tablet's when any section has Tablet rows). */
export function screenRowsSource(doc: FormDocument, bp: BreakpointKey): BreakpointKey {
  if (bp === 'base') return 'base'
  const sources = doc.sections.map((s) => rowsSourceOf(s, bp))
  if (sources.includes(bp)) return bp
  if (sources.includes('tablet')) return 'tablet'
  return 'base'
}
