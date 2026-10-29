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
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'

/**
 * Deep-clone a FormDocument with fresh section/row/block ids and fresh image imageOids,
 * for STEP-level clone paths (include-by-copy, copy/paste, duplicate-node).
 *
 * fieldNames are deliberately KEPT — v1 parity: cloneFormLayouts regenerated element ids
 * and imageOids but never fieldNames, so a cloned step's outputs keep their field identity.
 * (cloneBlockWithFreshIdentity regenerates fieldName because IN-document duplicate must
 * avoid fieldName collisions — a different operation with different semantics.)
 */
export function cloneFormDocument(doc: FormDocument): FormDocument {
  const clone = structuredClone(doc)
  for (const section of clone.sections) {
    section.id = generateOID(WORKER_INTERNAL)
    for (const row of section.rows) {
      row.id = generateOID(WORKER_INTERNAL)
      for (const block of row.blocks) {
        block.id = generateOID(WORKER_INTERNAL)
        if (block.type === 'image' && block.imageOid) block.imageOid = generateOID(WORKER_INTERNAL)
      }
    }
  }
  return clone
}
