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

import type { FormDocument } from '@mission/form-schema'

// The gate (computeValidation) reports missing FIELD NAMES — authoring identifiers
// like `lot_no`. Operators need the label they see on the form, so map each name
// back to its block's label. Blank labels fall back to the field name (still
// something to search the form for); an unlabelled e-signature reads "Signature".
export interface MissingItem {
  fieldName: string
  label: string
  /** The block to jump to; null when the document does not contain the name. */
  blockId: string | null
  /** A running timer is not something to fill in — it reads "Waiting for" (P0 minor). */
  kind: 'field' | 'signature' | 'timer'
}

export function missingItems(doc: FormDocument | null, missing: readonly string[]): MissingItem[] {
  const byName = new Map<string, Omit<MissingItem, 'fieldName'>>()
  for (const section of doc?.sections ?? []) {
    for (const row of section.rows) {
      for (const block of row.blocks) {
        if (!('fieldName' in block) || byName.has(block.fieldName)) continue
        const label = 'label' in block && typeof block.label === 'string' ? block.label.trim() : ''
        byName.set(block.fieldName, {
          label: label || (block.type === 'esignature' ? 'Signature' : block.fieldName),
          blockId: block.id,
          kind: block.type === 'timer' ? 'timer' : block.type === 'esignature' ? 'signature' : 'field',
        })
      }
    }
  }
  return missing.map((name) => ({ fieldName: name, ...(byName.get(name) ?? { label: name, blockId: null, kind: 'field' as const }) }))
}

export function missingFieldLabels(doc: FormDocument | null, missing: readonly string[]): string[] {
  return missingItems(doc, missing).map((item) => item.label)
}
