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
import type { PerBreakpoint, BreakpointKey, SizeAt, TypeToken } from '@mission/form-schema'
import { resolveAt } from '@mission/form-schema'

/** Resolve a per-breakpoint value with the schema cascade (phone ?? tablet ?? base), or a default.
 *  Delegates to the canonical `resolveAt` so the editor and renderer resolve identically. */
export function resolveBp<T>(pb: PerBreakpoint<T> | undefined, bp: BreakpointKey, dflt: T): T {
  return resolveAt(pb, bp, dflt)
}

/** Set the value for a breakpoint, preserving base (and other overrides). */
export function setBp<T>(pb: PerBreakpoint<T> | undefined, base: T, bp: BreakpointKey, value: T): PerBreakpoint<T> {
  return { ...(pb ?? { base }), [bp]: value }
}

/** Clear a tablet/phone override (base is never removed). */
export function clearBp<T>(pb: PerBreakpoint<T> | undefined, base: T, bp: BreakpointKey): PerBreakpoint<T> {
  const next: PerBreakpoint<T> = { ...(pb ?? { base }) }
  if (bp !== 'base') delete next[bp]
  return next
}

/** Whether this breakpoint has an explicit value (base always does). */
export function isOverridden<T>(pb: PerBreakpoint<T> | undefined, bp: BreakpointKey): boolean {
  if (bp === 'base') return true
  return pb?.[bp] !== undefined
}

type SizedBlock = { size?: TypeToken; sizeAt?: SizeAt }

/** Patch that sets a block's type size for one device. Desktop writes `size`; tablet/phone write `sizeAt[bp]`. */
export function sizePatchAt(block: SizedBlock, bp: BreakpointKey, value: TypeToken): SizedBlock {
  if (bp === 'base') return { size: value }
  return { sizeAt: { ...block.sizeAt, [bp]: value } }
}

/** Drop one tablet/phone size override; `sizeAt` is removed entirely once empty. */
export function clearSizeAt(block: SizedBlock, bp: 'tablet' | 'phone'): SizedBlock {
  const { sizeAt, ...rest } = block
  const next = { ...sizeAt }
  delete next[bp]
  return Object.keys(next).length > 0 ? { ...rest, sizeAt: next } : rest
}
