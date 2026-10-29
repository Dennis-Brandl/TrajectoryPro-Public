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
import { JOB_OUTPUT_VALUE, jobButtons } from '@mission/form-schema'
import type { Block, BlockType, ButtonJob, FormDocument, OptionEntry, StepKind } from '@mission/form-schema'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'

/** The palette offers every block type. A `button` is an author-placed job button
 *  (continue / yes / no, spec 2026-10-28). */
export type PaletteBlockType = BlockType

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
  'button',
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
/** The job a new Button takes: Continue on a normal step; on a Yes/No step the job the form still
 *  lacks (Yes first, then No), so the second button an author adds is the No they need. */
export function nextButtonJob(stepKind: StepKind | undefined, document?: FormDocument): ButtonJob {
  if (stepKind !== 'yesno') return 'continue'
  const present = new Set(document ? jobButtons(document).map((b) => b.job) : [])
  return present.has('yes') && !present.has('no') ? 'no' : 'yes'
}

export function createDefaultBlock(
  type: PaletteBlockType,
  opts?: { stepKind?: StepKind; document?: FormDocument },
): Block {
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
    case 'button': {
      const job = nextButtonJob(opts?.stepKind, opts?.document)
      return { id, type, label: '', job, outputValue: JOB_OUTPUT_VALUE[job], emphasis: 'primary' }
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
