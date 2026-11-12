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
import type { FormDocument, TypeToken } from './types'

/** Style of a step's fixed button row (spec JSON `button_bar`, camelCased). */
export type ButtonBarStyle = { size?: TypeToken; color?: string; yesColor?: string; noColor?: string }

type BarHolder = { button_bar?: unknown } | null | undefined

function fixedBarOf(step: BarHolder): Record<string, unknown> | null {
  const bar = step?.button_bar
  if (!bar || typeof bar !== 'object' || Array.isArray(bar)) return null
  return (bar as { format?: unknown }).format === 'fixed' ? (bar as Record<string, unknown>) : null
}

/** True only for a step whose `button_bar` is `{ format: 'fixed' }`. */
export function isFixedBar(step: BarHolder): boolean {
  return fixedBarOf(step) !== null
}

/** The fixed bar's style, camelCased; null when the step has no fixed bar. */
export function barStyleOf(step: BarHolder): ButtonBarStyle | null {
  const bar = fixedBarOf(step)
  if (!bar) return null
  const out: ButtonBarStyle = {}
  if (typeof bar.size === 'string') out.size = bar.size as TypeToken
  if (typeof bar.color === 'string') out.color = bar.color
  if (typeof bar.yes_color === 'string') out.yesColor = bar.yes_color
  if (typeof bar.no_color === 'string') out.noColor = bar.no_color
  return out
}

/** The form without any button block; rows and sections the removal empties are dropped too. Pure. */
export function stripButtonBlocks(doc: FormDocument): FormDocument {
  const sections = doc.sections
    .map((s) => ({
      ...s,
      rows: s.rows
        .map((r) => ({ ...r, blocks: r.blocks.filter((b) => b.type !== 'button') }))
        .filter((r) => r.blocks.length > 0),
    }))
    .filter((s) => s.rows.length > 0 || s.role !== 'footer')
  return { ...doc, sections }
}
