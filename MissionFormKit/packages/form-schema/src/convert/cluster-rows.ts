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
import type { V1Element } from './v1-types'

/**
 * Port of TrajectoryRuntime web-ui FormRenderer.tsx `clusterRows`, byte-for-byte in logic.
 * Groups absolutely-positioned elements into visual rows by vertical-band overlap, so a
 * converted v2 document stacks the way today's runtime already stacks it.
 *
 * Single-linkage: an element joins the FIRST existing group where it overlaps ANY one
 * member by >= threshold of the shorter of the two heights. Rows are emitted in
 * group-creation order (top-to-bottom, given the pre-sort) and each is finally sorted by x.
 */
export function clusterRows(elements: V1Element[], threshold = 0.3): V1Element[][] {
  const sorted = [...elements].sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x))
  const groups: V1Element[][] = []
  for (const el of sorted) {
    const bot = el.y + el.height
    const minHEl = Math.max(1, el.height)
    const match = groups.find((row) =>
      row.some((other) => {
        const oBot = other.y + other.height
        const overlap = Math.max(0, Math.min(bot, oBot) - Math.max(el.y, other.y))
        return overlap / Math.min(minHEl, Math.max(1, other.height)) >= threshold
      }),
    )
    if (match) match.push(el)
    else groups.push([el])
  }
  return groups.map((g) => [...g].sort((a, b) => a.x - b.x))
}
