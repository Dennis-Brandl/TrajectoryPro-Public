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
