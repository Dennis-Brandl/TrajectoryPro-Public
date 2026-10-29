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
import type { ESignatureBlock, FormDocument } from './types'

/** Host-owned credential draft. Never part of FormValues, never persisted (spec D3). */
export interface SignatureDraft {
  loginName: string
  password: string
}

/** First e-signature block in document order, or null (spec D9: at most one is meaningful). */
export function findESignatureBlock(doc: FormDocument): ESignatureBlock | null {
  for (const section of doc.sections) {
    for (const row of section.rows) {
      for (const block of row.blocks) {
        if (block.type === 'esignature') return block
      }
    }
  }
  return null
}

/** Both fields present and non-blank after trimming. */
export function isSignatureDraftComplete(draft: SignatureDraft | null | undefined): boolean {
  return !!draft && draft.loginName.trim().length > 0 && draft.password.trim().length > 0
}

/**
 * The label of a button that signs (spec 2026-09-06 D2): "Sign & <label>", unless the
 * author's label already starts with the word Sign ("Sign and Save" stays as it is, never
 * "Sign & Sign and Save"). Shared by Mission Pilot and Designer's preview.
 */
export function signedLabel(label: string): string {
  if (!label.trim()) return 'Sign'
  return /^\s*sign\b/i.test(label) ? label : `Sign & ${label}`
}
