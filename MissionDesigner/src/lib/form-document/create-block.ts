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
import type { Block, BlockType, OptionEntry } from '@mission/form-schema'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'

/** The palette offers every block type except `button`: a step's buttons belong to the step's
 *  fixed button row now (spec 2026-11-11). Old stored forms may still hold Button blocks. */
export type PaletteBlockType = Exclude<BlockType, 'button'>

/** Runtime roster of palette block types. `satisfies` rejects a typo/extra entry; the switch in
 *  createDefaultBlock is exhaustive (its default throws), so an unknown type never yields a
 *  malformed block. Used by parseDragId to reject a stale/garbage palette drag id. */
export const PALETTE_BLOCK_TYPES = [
  'text',
  'header',
  'textInput',
  'textarea',
  'checkbox',
  'radio',
  'image',
  'video',
  'divider',
  'timer',
  'esignature',
] as const satisfies readonly PaletteBlockType[]

export function isPaletteBlockType(value: string): value is PaletteBlockType {
  return (PALETTE_BLOCK_TYPES as readonly string[]).includes(value)
}

const FIELD_NAME_PREFIXES: Partial<Record<BlockType, string>> = {
  textInput: 'Text',
  textarea: 'Text',
  checkbox: 'Checkbox',
  radio: 'Radio',
  timer: 'Timer',
  esignature: 'Signature',
}

function autoFieldName(type: BlockType, id: string): string {
  return `${FIELD_NAME_PREFIXES[type] ?? 'field'}_${id.slice(-6)}`
}

const THREE_OPTIONS: OptionEntry[] = [
  { label: 'Option 1', value: 'option_1' },
  { label: 'Option 2', value: 'option_2' },
  { label: 'Option 3', value: 'option_3' },
]

/** A fresh, schema-VALID default block for a palette type. Mirrors the converter's `mapBlock`
 *  defaults so every result passes `validateFormDocument` (image needs layout.aspectRatio;
 *  timer needs label/fieldName/durationSeconds/direction). */
export function createDefaultBlock(type: PaletteBlockType): Block {
  const id = generateOID(WORKER_INTERNAL)
  switch (type) {
    case 'text':
      return { id, type, content: 'Text block' }
    case 'header':
      return { id, type, content: 'Header', fontWeight: 'bold', size: 'xl' }
    case 'textInput':
      return { id, type, fieldName: autoFieldName('textInput', id), label: 'Label', placeholder: 'Enter text…' }
    case 'textarea':
      return { id, type, fieldName: autoFieldName('textarea', id), label: 'Label', placeholder: 'Enter text…', rows: 4 }
    case 'checkbox':
      return {
        id,
        type,
        fieldName: autoFieldName('checkbox', id),
        label: 'Checkbox Group',
        options: THREE_OPTIONS.map((o) => ({ ...o })),
      }
    case 'radio':
      return {
        id,
        type,
        fieldName: autoFieldName('radio', id),
        label: 'Radio Group',
        options: THREE_OPTIONS.map((o) => ({ ...o })),
      }
    case 'image':
      return {
        id,
        type,
        src: 'No image selected',
        imageOid: generateOID(WORKER_INTERNAL),
        layout: { aspectRatio: '16/9' },
      }
    case 'video':
      return { id, type, src: 'No video selected', layout: { aspectRatio: '16/9' } }
    case 'divider':
      return { id, type, weight: 'hairline' }
    case 'timer':
      return {
        id,
        type,
        label: 'Timer',
        fieldName: autoFieldName('timer', id),
        durationSeconds: 300,
        direction: 'countdown',
        blockDone: false,
      }
    case 'esignature':
      return {
        id,
        type,
        fieldName: autoFieldName('esignature', id),
        label: 'E-signature',
        meaning: '',
        requireDifferentUser: false,
      }
    default:
      // Exhaustive over PaletteBlockType (a new member forces a case here); at runtime this also
      // throws on an invalid type (e.g. a garbage palette drag id) instead of returning undefined.
      return assertNever(type)
  }
}

function assertNever(value: never): never {
  throw new Error(`createDefaultBlock: unhandled palette block type "${String(value)}"`)
}

/** Deep clone of a block with a NEW id (+ fresh imageOid for images, + fresh fieldName for
 *  field-bearing blocks) — the identity refresh used by duplicate and paste. */
export function cloneBlockWithFreshIdentity(block: Block): Block {
  const id = generateOID(WORKER_INTERNAL)
  const clone = structuredClone(block)
  clone.id = id
  if (clone.type === 'image') clone.imageOid = generateOID(WORKER_INTERNAL)
  if ('fieldName' in clone) (clone as { fieldName: string }).fieldName = autoFieldName(clone.type, id)
  return clone
}
