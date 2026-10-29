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
import type { Block, GridSpan } from '@mission/form-schema'

/** Even split of 12 grid columns across `n` blocks: floor(12/n), remainder +1 to the leading
 *  blocks (n=3 → [4,4,4]; n=5 → [3,3,2,2,2]). Precondition: 0 <= n <= 12. */
export function computeEvenSpans(n: number): number[] {
  if (n <= 0) return []
  // A 12-column row holds at most 12 unit blocks; the drop-zone layer enforces this upstream.
  // For the degenerate >12 case, fall back to all-1 spans — each a valid GridSpan (the row
  // overflows visually) — rather than emitting a sub-1 span.
  if (n > 12) return Array.from({ length: n }, () => 1)
  const base = Math.floor(12 / n)
  const remainder = 12 - base * n
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0))
}

/** Recompute `layout.span.base` for every block in a row to the even split, preserving each
 *  block's tablet/phone span overrides and all other layout fields. Used whenever a row's block
 *  count changes (spec §4.4). base-only by design — per-breakpoint spans are P3.3b. */
export function apportionRowSpans(blocks: Block[]): Block[] {
  const spans = computeEvenSpans(blocks.length)
  return blocks.map((b, i) => {
    const base = spans[i] as GridSpan
    const span = { ...(b.layout?.span ?? { base }), base }
    return { ...b, layout: { ...b.layout, span } }
  })
}
