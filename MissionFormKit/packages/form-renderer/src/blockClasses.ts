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
import type { CSSProperties } from 'react'
import { BREAKPOINT_KEYS, resolveAt, type BlockLayout } from '@mission/form-schema'

/**
 * Map a block's layout to the per-breakpoint utility classes defined in
 * layout.css. All responsive behavior is class + container query — no JS
 * measurement, no inline styles (determinism, spec §4).
 */
export function blockLayoutClasses(layout: BlockLayout | undefined): string {
  const classes = ['tfk-block']

  for (const bp of BREAKPOINT_KEYS) {
    classes.push(`tfk-span-${bp}-${resolveAt(layout?.span, bp, 12)}`)
  }
  for (const bp of BREAKPOINT_KEYS) {
    const order = resolveAt(layout?.order, bp, undefined as number | undefined)
    if (order !== undefined) classes.push(`tfk-order-${bp}-${order}`)
  }
  for (const bp of BREAKPOINT_KEYS) {
    if (!resolveAt(layout?.visible, bp, true)) classes.push(`tfk-hide-${bp}`)
  }
  if (layout?.align) classes.push(`tfk-align-${layout.align}`)

  return classes.join(' ')
}

/**
 * A block's own size limits (user ruling 2026-11-14), as custom properties layout.css reads:
 * `minHeight` (a space token or rem) makes the block's content at least that tall, and
 * `maxWidth` (ch or rem) caps the content's width. The values are authored numbers, so they
 * cannot be classes; everything else stays class-based. Undefined when neither is set.
 */
export function blockLayoutStyle(layout: BlockLayout | undefined): CSSProperties | undefined {
  const style: Record<string, string> = {}
  const min = layout?.minHeight
  if (typeof min === 'string') style['--tfk-block-min-h'] = `var(--form-space-${min})`
  else if (min && typeof min.rem === 'number') style['--tfk-block-min-h'] = `${min.rem}rem`
  const max = layout?.maxWidth
  if (max && 'ch' in max && typeof max.ch === 'number') style['--tfk-block-max-w'] = `${max.ch}ch`
  else if (max && 'rem' in max && typeof max.rem === 'number') style['--tfk-block-max-w'] = `${max.rem}rem`
  return Object.keys(style).length > 0 ? (style as CSSProperties) : undefined
}
