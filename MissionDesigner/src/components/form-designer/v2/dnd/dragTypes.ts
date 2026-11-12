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
import { isPaletteBlockType, type PaletteBlockType } from '@/lib/form-document/create-block'

// snowflake ids are digit-strings and block types are simple words, so ':' is a safe separator.
export const blockDragId = (id: string) => `block:${id}`
export const rowDragId = (id: string) => `row:${id}`
export const paletteDragId = (type: PaletteBlockType) => `palette:${type}`

const TOP = '@top'
const END = '@end'
export const gapDropId = (sectionId: string, afterRowId: string | null) => `gap:${sectionId}:${afterRowId ?? TOP}`
export const slotDropId = (rowId: string, beforeBlockId: string | null) => `slot:${rowId}:${beforeBlockId ?? END}`

export type ParsedDrag =
  | { kind: 'block'; id: string }
  | { kind: 'row'; id: string }
  | { kind: 'palette'; type: PaletteBlockType }
  | null
export type ParsedDrop =
  | { zone: 'gap'; sectionId: string; afterRowId: string | null }
  | { zone: 'slot'; rowId: string; beforeBlockId: string | null }
  | null

export function parseDragId(id: string): ParsedDrag {
  const [kind, rest] = splitFirst(id)
  if (kind === 'block' && rest) return { kind: 'block', id: rest }
  if (kind === 'row' && rest) return { kind: 'row', id: rest }
  if (kind === 'palette' && isPaletteBlockType(rest)) return { kind: 'palette', type: rest }
  return null
}

export function parseDropId(id: string | null): ParsedDrop {
  if (!id) return null
  const [zone, rest] = splitFirst(id)
  if (zone === 'gap') {
    const [sectionId, anchor] = splitFirst(rest)
    return { zone: 'gap', sectionId, afterRowId: anchor === TOP ? null : anchor }
  }
  if (zone === 'slot') {
    const [rowId, anchor] = splitFirst(rest)
    return { zone: 'slot', rowId, beforeBlockId: anchor === END ? null : anchor }
  }
  return null
}

/** Split on the first ':' only. */
function splitFirst(s: string): [string, string] {
  const i = s.indexOf(':')
  return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]
}
