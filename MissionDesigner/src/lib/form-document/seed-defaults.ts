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
import type { FormDocument, FormValues } from '@mission/form-schema'

/**
 * Seed initial run-preview values from blocks' static default sources.
 *
 * The host owns field state and seeds defaults before mount (HOST-CONTRACT §1).
 * At design time only a `defaultSource` with `mode: 'static'` is resolvable — its
 * literal `value` is the seed. `property` / `input` sources are runtime references
 * with no design-time value, so those fields start empty.
 */
export function seedStaticDefaults(doc: FormDocument): FormValues {
  const values: FormValues = {}
  for (const section of doc.sections) {
    for (const row of section.rows) {
      for (const block of row.blocks) {
        // Narrow via `in` (the codebase convention) rather than an ad-hoc cast, so we use the schema's
        // real Block / ParameterDefaultSource types and the literal `mode` union, not a widened `string`.
        if (
          'fieldName' in block &&
          block.fieldName &&
          'defaultSource' in block &&
          block.defaultSource?.mode === 'static'
        ) {
          values[block.fieldName] = block.defaultSource.value
        }
      }
    }
  }
  return values
}
