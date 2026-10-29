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
import type { FormDocument } from './types'
import type { FormValues } from './events'
import type { SignatureDraft } from './esignature'
import { isSignatureDraftComplete } from './esignature'

const REQUIRABLE_TYPES = new Set(['textInput', 'textarea', 'checkbox', 'radio'])

function isEmpty(v: FormValues[string] | undefined): boolean {
  return v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

/** A complete decimal number as an operator types it: optional minus, digits, optional point. */
export function isNumberText(v: string): boolean {
  return /^-?(\d+\.?\d*|\.\d+)$/.test(v.trim())
}

/** A value that can still become a number by typing more ('', '-', '1.', '.5'). */
export function isPartialNumberText(v: string): boolean {
  return /^-?\d*\.?\d*$/.test(v.trim())
}

/**
 * Pure gating function for the host's Complete/decision affordances:
 * `missing` lists (in document order) required input fieldNames whose value
 * is absent/empty, number-mode text inputs (required or not) holding text that is
 * not a number, blockDone timer fieldNames not yet settled (elapsed or
 * stopped), and the fieldName of an e-signature block whose draft is not yet
 * complete (both fields non-blank after trimming).
 *
 * React-free and pure so any host can call it, including a non-React one.
 *
 * The renderer calls this itself on `fieldChange`, on `signature` and on timer
 * settlement, and emits the result as a `validation` event — but NOT on mount, on
 * a host-driven `values` change, or on a `document` change. **A host must therefore
 * compute the gate itself at mount and on every screen change**, passing an empty
 * `settledTimers` for a freshly-keyed screen and its current signature draft (if
 * any). See `docs/HOST-CONTRACT.md` §2.
 */
export function computeValidation(
  doc: FormDocument,
  values: FormValues,
  settledTimers: ReadonlySet<string>,
  signature?: SignatureDraft | null,
): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  for (const section of doc.sections) {
    for (const row of section.rows) {
      for (const block of row.blocks) {
        if (REQUIRABLE_TYPES.has(block.type)) {
          const b = block as { fieldName: string; required?: boolean }
          const v = values[b.fieldName]
          const notANumber = block.type === 'textInput' && block.inputMode === 'number' &&
            typeof v === 'string' && v !== '' && !isNumberText(v)
          if (((b.required && isEmpty(v)) || notANumber) && !missing.includes(b.fieldName)) {
            missing.push(b.fieldName)
          }
        } else if (block.type === 'timer' && block.blockDone && !settledTimers.has(block.fieldName)) {
          if (!missing.includes(block.fieldName)) missing.push(block.fieldName)
        } else if (block.type === 'esignature' && !isSignatureDraftComplete(signature)) {
          if (!missing.includes(block.fieldName)) missing.push(block.fieldName)
        }
      }
    }
  }
  return { ok: missing.length === 0, missing }
}
