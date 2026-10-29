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
import type { Block, BlockLayout, TypeToken, TextInputMode } from '../types'
import type { V1Element } from './v1-types'
import type { ConversionEntry } from './report'

const USABLE_W = 1024 - 77

function sizeToken(px: number): TypeToken {
  if (px <= 11) return 'xs'
  if (px <= 13) return 'sm'
  if (px <= 16) return 'md'
  if (px <= 20) return 'lg'
  if (px <= 26) return 'xl'
  if (px <= 34) return '2xl'
  return '3xl'
}

// Returns `{ size }` to spread into a block literal, rather than wrapping the whole block:
// a generic `<T> => T` wrapper widens the literal's `type` to `string`, which breaks the Block
// discriminated union. Spreading into the literal keeps it contextually typed by mapBlock's
// `Block` return type, so the `type` discriminant is preserved.
function fontSizeProps(el: V1Element, entries: ConversionEntry[]): { size?: TypeToken } {
  if (el.fontSize === undefined) return {}
  entries.push({ kind: 'fontSizeLost', blockId: el.id, detail: `${el.fontSize}px → ${sizeToken(el.fontSize)}` })
  return { size: sizeToken(el.fontSize) }
}

function aspectLayout(el: V1Element): BlockLayout {
  // Round FIRST, then guard: the v2 schema's aspectRatio is integer-only, and a sub-pixel
  // dimension (0 < d < 0.5) rounds to 0 — guarding on the raw value would emit "0/N".
  const w = Math.round(el.width)
  const h = Math.round(el.height)
  return { aspectRatio: w > 0 && h > 0 ? `${w}/${h}` : '16/9' }
}

export function mapBlock(el: V1Element, entries: ConversionEntry[]): Block {
  switch (el.type) {
    case 'text':
      return { id: el.id, type: 'text', content: el.content ?? '', ...(el.fontWeight ? { fontWeight: el.fontWeight } : {}), ...(el.color ? { color: el.color } : {}), ...(el.align ? { align: el.align } : {}), ...fontSizeProps(el, entries) }
    case 'header':
      return { id: el.id, type: 'header', content: el.content ?? '', ...(el.fontWeight ? { fontWeight: el.fontWeight } : {}), ...(el.color ? { color: el.color } : {}), ...(el.align ? { align: el.align } : {}), ...fontSizeProps(el, entries) }
    case 'textInput':
      return { id: el.id, type: 'textInput', fieldName: el.fieldName ?? '', ...(el.label !== undefined ? { label: el.label } : {}), ...(el.placeholder !== undefined ? { placeholder: el.placeholder } : {}), ...(el.required !== undefined ? { required: el.required } : {}), ...(el.inputMode ? { inputMode: el.inputMode as TextInputMode } : {}), ...(el.listItems ? { listItems: el.listItems } : {}), ...(el.listSource ? { listSource: el.listSource } : {}), ...(el.outputParameter ? { outputParameter: el.outputParameter } : {}), ...(el.defaultSource ? { defaultSource: el.defaultSource } : {}), ...(el.placeholderSource ? { placeholderSource: el.placeholderSource } : {}), ...fontSizeProps(el, entries) }
    case 'textarea': {
      const natural = (el.rows ?? 4) * 24 + 16
      const layout: BlockLayout | undefined = el.height > natural ? { minHeight: { rem: Math.round((el.height / 16) * 100) / 100 } } : undefined
      return { id: el.id, type: 'textarea', fieldName: el.fieldName ?? '', ...(el.label !== undefined ? { label: el.label } : {}), ...(el.placeholder !== undefined ? { placeholder: el.placeholder } : {}), ...(el.required !== undefined ? { required: el.required } : {}), ...(el.rows !== undefined ? { rows: el.rows } : {}), ...(el.outputParameter ? { outputParameter: el.outputParameter } : {}), ...(el.defaultSource ? { defaultSource: el.defaultSource } : {}), ...(el.placeholderSource ? { placeholderSource: el.placeholderSource } : {}), ...(layout ? { layout } : {}) }
    }
    case 'checkbox':
      return { id: el.id, type: 'checkbox', fieldName: el.fieldName ?? '', options: el.options ?? [], ...(el.label !== undefined ? { label: el.label } : {}), ...(el.required !== undefined ? { required: el.required } : {}), ...(el.listSource ? { listSource: el.listSource } : {}), ...(el.outputParameter ? { outputParameter: el.outputParameter } : {}), ...fontSizeProps(el, entries) }
    case 'radio':
      return { id: el.id, type: 'radio', fieldName: el.fieldName ?? '', options: el.options ?? [], ...(el.label !== undefined ? { label: el.label } : {}), ...(el.required !== undefined ? { required: el.required } : {}), ...(el.listSource ? { listSource: el.listSource } : {}), ...(el.outputParameter ? { outputParameter: el.outputParameter } : {}), ...fontSizeProps(el, entries) }
    case 'image':
      if (el.width > USABLE_W) entries.push({ kind: 'oversizedImage', blockId: el.id, detail: `image width ${el.width}px exceeds usable canvas ${USABLE_W}px` })
      return { id: el.id, type: 'image', src: el.src ?? '', ...(el.imageOid ? { imageOid: el.imageOid } : {}), ...(el.objectFit ? { objectFit: el.objectFit } : {}), layout: aspectLayout(el) }
    case 'video':
      return { id: el.id, type: 'video', src: el.src ?? '', ...(el.posterUrl ? { posterUrl: el.posterUrl } : {}), layout: aspectLayout(el) }
    case 'divider':
      return { id: el.id, type: 'divider', weight: (el.thickness ?? 1) > 2 ? 'thick' : 'hairline', ...(el.color ? { color: el.color } : {}) }
    case 'timer':
      return { id: el.id, type: 'timer', label: el.label ?? '', fieldName: el.fieldName ?? '', durationSeconds: el.durationSeconds ?? 0, direction: el.direction ?? 'countdown', ...(el.blockDone !== undefined ? { blockDone: el.blockDone } : {}), ...(el.outputParameter ? { outputParameter: el.outputParameter } : {}), ...(el.defaultSource ? { defaultSource: el.defaultSource } : {}) }
    case 'button':
      // v1 buttons carry fontSize but v2 ButtonBlock has no size field — report the loss rather than drop it silently.
      if (el.fontSize !== undefined) {
        entries.push({ kind: 'fontSizeLost', blockId: el.id, detail: `${el.fontSize}px → dropped (v2 buttons have no size)` })
      }
      return { id: el.id, type: 'button', label: el.label ?? '', outputValue: el.outputValue ?? '', ...(el.color ? { color: el.color } : {}), ...(el.deletable !== undefined ? { deletable: el.deletable } : {}) }
    default:
      throw new Error(`convertFormLayouts: unknown v1 element type "${el.type}"`)
  }
}
