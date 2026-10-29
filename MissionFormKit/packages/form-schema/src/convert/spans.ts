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
import type { GridSpan } from '../types'
import type { V1Element } from './v1-types'
import type { ConversionEntry } from './report'

const USABLE_W = 1024 - 77 // desktop canvas minus left chrome
const SINGLE_FULL_THRESHOLD = 0.55
const SINGLE_CHOICES = [3, 4, 6, 8]

const clampSpan = (n: number): GridSpan => Math.max(1, Math.min(12, n)) as GridSpan

function nearest(value: number, choices: number[]): number {
  return choices.reduce((best, c) => (Math.abs(c - value) < Math.abs(best - value) ? c : best), choices[0]!)
}

export function quantizeSpans(row: V1Element[], entries: ConversionEntry[]): GridSpan[] {
  if (row.length === 0) return []

  if (row.length === 1) {
    const width = row[0]!.width
    if (width >= SINGLE_FULL_THRESHOLD * USABLE_W) return [12]
    const rawCols = (width / USABLE_W) * 12
    const cols = nearest(rawCols, SINGLE_CHOICES)
    // Same >0.01 gate as the multi-element branch: don't flag a "rounding" that didn't happen.
    if (Math.abs(cols - rawCols) > 0.01) {
      entries.push({ kind: 'spanRounding', blockId: row[0]!.id, detail: `single narrow element width ${width}px → span ${cols}` })
    }
    return [clampSpan(cols)]
  }

  const total = row.reduce((sum, e) => sum + Math.max(1, e.width), 0)
  const raw = row.map((e) => (Math.max(1, e.width) / total) * 12)
  const spans = raw.map((r) => Math.max(1, Math.floor(r)))

  let sum = spans.reduce((a, b) => a + b, 0)
  // hand out deficit to largest fractional remainder (ties: lower index)
  while (sum < 12) {
    let best = -1
    let bestRem = -Infinity
    for (let i = 0; i < spans.length; i++) {
      const rem = raw[i]! - spans[i]!
      if (rem > bestRem) {
        bestRem = rem
        best = i
      }
    }
    spans[best]!++
    sum++
  }
  // remove overflow from smallest remainder among spans > 1 (ties: higher index)
  while (sum > 12) {
    let worst = -1
    let worstRem = Infinity
    for (let i = 0; i < spans.length; i++) {
      if (spans[i]! <= 1) continue
      const rem = raw[i]! - Math.floor(raw[i]!)
      if (rem <= worstRem) {
        worstRem = rem
        worst = i
      }
    }
    // A row of >12 elements cannot fit 12 columns: every span is already at the floor of 1
    // and nothing is reducible. Stop rather than writing spans[-1] (a phantom NaN property).
    // The result is all-1s summing to n; the CSS grid wraps it, which is the honest degradation.
    if (worst === -1) break
    spans[worst]!--
    sum--
  }

  const rounded = spans.some((s, i) => Math.abs(s - raw[i]!) > 0.01)
  if (rounded) {
    entries.push({ kind: 'spanRounding', blockId: row[0]!.id, detail: `row spans quantized to [${spans.join(', ')}]` })
  }
  return spans.map(clampSpan)
}
