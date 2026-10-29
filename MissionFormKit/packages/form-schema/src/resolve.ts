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
import type { PerBreakpoint, SizeAt, TypeToken } from './types'

export type BreakpointKey = 'base' | 'tablet' | 'phone'

/** All breakpoints, widest first. The renderer iterates this list. */
export const BREAKPOINT_KEYS: readonly BreakpointKey[] = ['base', 'tablet', 'phone'] as const

/**
 * The ONE cascade implementation (spec §3.1): phone ?? tablet ?? base.
 * Every consumer (renderer, editor, converter) resolves through this function.
 */
export function resolveAt<T>(value: PerBreakpoint<T> | undefined, bp: BreakpointKey, fallback: T): T {
  if (value === undefined) return fallback
  if (bp === 'base') return value.base
  if (bp === 'tablet') return value.tablet ?? value.base
  return value.phone ?? value.tablet ?? value.base
}

/** Type size at a breakpoint: phone ?? tablet ?? desktop `size` ?? fallback. */
export function resolveSize(
  size: TypeToken | undefined,
  sizeAt: SizeAt | undefined,
  bp: BreakpointKey,
  fallback: TypeToken,
): TypeToken {
  const base = size ?? fallback
  if (!sizeAt || bp === 'base') return base
  if (bp === 'tablet') return sizeAt.tablet ?? base
  return sizeAt.phone ?? sizeAt.tablet ?? base
}
