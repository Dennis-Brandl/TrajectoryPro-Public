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
import type { MoveTarget, RowTarget } from '@/lib/form-document/structural-ops'
import type { PaletteBlockType } from '@/lib/form-document/create-block'
import type { FormDocument } from '@mission/form-schema'
import { isButtonsOnlyDrop } from '@/lib/form-document/document-ops'
import { parseDragId, parseDropId } from './dragTypes'

export type DropAction =
  | { op: 'moveBlock'; blockId: string; target: MoveTarget }
  | { op: 'moveRow'; rowId: string; target: RowTarget }
  | { op: 'insertBlockAt'; type: PaletteBlockType; target: MoveTarget }
  | null

/** Map a completed drag (active id + the droppable it ended over) to one store action, or null
 *  for no droppable / an invalid combination. Pure — the droppable id carries the full target. */
export function dropResolver(activeId: string, overId: string | null, doc?: FormDocument): DropAction {
  const active = parseDragId(activeId)
  const over = parseDropId(overId)
  if (!active || !over) return null
  if (doc) {
    // An old form's bottom bar (a footer section) keeps its buttons only.
    const sectionId =
      over.zone === 'slot' ? doc.sections.find((s) => s.rows.some((r) => r.id === over.rowId))?.id : over.sectionId
    if (sectionId && !isButtonsOnlyDrop(doc, active, sectionId)) return null
  }

  if (over.zone === 'gap') {
    const target: MoveTarget = { kind: 'new-row', sectionId: over.sectionId, afterRowId: over.afterRowId }
    if (active.kind === 'block') return { op: 'moveBlock', blockId: active.id, target }
    if (active.kind === 'palette') return { op: 'insertBlockAt', type: active.type, target }
    if (active.kind === 'row') {
      return { op: 'moveRow', rowId: active.id, target: { sectionId: over.sectionId, afterRowId: over.afterRowId } }
    }
  }
  if (over.zone === 'slot') {
    const target: MoveTarget = { kind: 'in-row', rowId: over.rowId, beforeBlockId: over.beforeBlockId }
    if (active.kind === 'block') return { op: 'moveBlock', blockId: active.id, target }
    if (active.kind === 'palette') return { op: 'insertBlockAt', type: active.type, target }
    // a row cannot drop inside a row
  }
  return null
}
