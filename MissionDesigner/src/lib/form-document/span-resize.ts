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
import type { FormDocument, GridSpan, BreakpointKey } from '@mission/form-schema'
import { resolveBp, setBp } from '@/lib/form-document/layout-ops'
import { updateBlockInDocument } from '@/lib/form-document/document-ops'

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

/**
 * Redistribute `deltaCols` columns between an adjacent block pair (left grows, right shrinks by
 * the same amount), conserving their combined span and clamping each to >= 1. Writes `span[bp]`
 * on BOTH blocks via `setBp`. Returns the SAME document reference when nothing changes — the
 * pair isn't adjacent (in `left,right` order within one row) or the delta nets to zero.
 */
export function resizeSpan(
  doc: FormDocument,
  leftId: string,
  rightId: string,
  deltaCols: number,
  bp: BreakpointKey,
): FormDocument {
  for (const section of doc.sections) {
    for (const row of section.rows) {
      const li = row.blocks.findIndex((b) => b.id === leftId)
      if (li === -1) continue
      if (row.blocks[li + 1]?.id !== rightId) return doc // not an adjacent (left,right) pair
      const left = row.blocks[li]
      const right = row.blocks[li + 1]
      const leftSpan = resolveBp(left.layout?.span, bp, 12)
      const rightSpan = resolveBp(right.layout?.span, bp, 12)
      const total = leftSpan + rightSpan
      const newLeft = clamp(leftSpan + deltaCols, Math.max(1, total - 12), Math.min(12, total - 1))
      if (newLeft === leftSpan) return doc // no-op
      const newRight = total - newLeft
      let next = updateBlockInDocument(doc, leftId, {
        layout: { ...left.layout, span: setBp(left.layout?.span, 12, bp, newLeft as GridSpan) },
      })
      next = updateBlockInDocument(next, rightId, {
        layout: { ...right.layout, span: setBp(right.layout?.span, 12, bp, newRight as GridSpan) },
      })
      return next
    }
  }
  return doc
}

/** Snap a pointer delta (px) to an integer column delta, clamped so neither side drops below 1. */
export function snapSpanDelta(dxPx: number, colWidthPx: number, leftSpan: number, rightSpan: number): number {
  if (colWidthPx <= 0) return 0
  const total = leftSpan + rightSpan
  return clamp(Math.round(dxPx / colWidthPx), Math.max(1, total - 12) - leftSpan, Math.min(12, total - 1) - leftSpan)
}
