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
import { pruneRowsAt, type FormDocument } from '@mission/form-schema'
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
    // Old -> new ids within this section, so the Tablet/Phone arrangements (`rowsAt`) point at
    // the clone's blocks, not the original's. A layout row that shares a desktop row's id keeps
    // sharing it; any other layout row gets a fresh id too.
    const rowIds = new Map<string, string>()
    const blockIds = new Map<string, string>()
    for (const row of section.rows) {
      const rowId = generateOID(WORKER_INTERNAL)
      rowIds.set(row.id, rowId)
      row.id = rowId
      for (const block of row.blocks) {
        const blockId = generateOID(WORKER_INTERNAL)
        blockIds.set(block.id, blockId)
        block.id = blockId
        if (block.type === 'image' && block.imageOid) block.imageOid = generateOID(WORKER_INTERNAL)
      }
    }
    if (section.rowsAt) {
      for (const layout of [section.rowsAt.tablet, section.rowsAt.phone]) {
        for (const lr of layout ?? []) {
          let rowId = rowIds.get(lr.id)
          if (rowId === undefined) {
            rowId = generateOID(WORKER_INTERNAL)
            rowIds.set(lr.id, rowId)
          }
          lr.id = rowId
          // An id that is not a block of the section is stale: dropped (the tidy below removes
          // a row or arrangement left empty).
          lr.blockIds = lr.blockIds.flatMap((id) => blockIds.get(id) ?? [])
        }
      }
    }
  }
  return { ...clone, sections: clone.sections.map(pruneRowsAt) }
}
