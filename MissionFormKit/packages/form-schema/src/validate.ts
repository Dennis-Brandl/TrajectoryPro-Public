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
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'
import formDocumentJsonSchema from './schema/form-document.json'

const ajv = new Ajv({ allErrors: true })
addFormats(ajv)

const compiled = ajv.compile(formDocumentJsonSchema)

export { formDocumentJsonSchema }

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

/** Validate an unknown value against the Form Document v2 JSON Schema. */
export function validateFormDocument(doc: unknown): ValidationResult {
  const ok = compiled(doc) === true
  const errors = ok
    ? []
    : (compiled.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)

  // Structural rule ajv cannot express: every id in the document is unique.
  if (ok) {
    const seen = new Set<string>()
    const d = doc as { sections: Array<{ id: string; rows: Array<{ id: string; blocks: Array<{ id: string }> }> }> }
    for (const section of d.sections) {
      for (const id of [section.id, ...section.rows.flatMap((r) => [r.id, ...r.blocks.map((b) => b.id)])]) {
        if (seen.has(id)) errors.push(`duplicate id: ${id}`)
        seen.add(id)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}
