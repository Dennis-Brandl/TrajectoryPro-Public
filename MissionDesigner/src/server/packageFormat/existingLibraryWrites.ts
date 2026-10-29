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

import type { ImportPlanRow } from '@/types/wflibx-import'
import type { ExistingDbState } from './buildImportPlan'

export interface ExistingLibraryWrite {
  libraryId: string
  /** The right verb the write needs in that library's team. */
  verb: 'library.delete' | 'create' | 'edit'
  entityType: string
}

/**
 * The existing libraries a .WFlibX commit would write into, and how. A plan row matches an
 * existing library by OID or by name in ANY team, so the commit route checks these against the
 * user's rights in each library's own team — not only the import's target team (spec
 * 2026-10-12 U3: nobody writes into GLOBAL, or another team, without rights there).
 */
export function existingLibraryWrites(
  rows: ImportPlanRow[],
  resolutions: Record<string, 'keep' | 'replace'>,
  existing: ExistingDbState,
): ExistingLibraryWrite[] {
  const writes: ExistingLibraryWrite[] = []
  for (const row of rows) {
    const s = row.status
    if (s.tag === 'add-to-existing') {
      writes.push({ libraryId: s.existingLibraryOid, verb: 'create', entityType: row.entityType })
    } else if (s.tag === 'conflict' && resolutions[row.bundleOid] === 'replace') {
      if (row.kind === 'library') {
        writes.push({ libraryId: s.existingOid, verb: 'library.delete', entityType: row.entityType })
      } else {
        const spec = existing.specifications.find((x) => x.id === s.existingOid)
        if (spec) writes.push({ libraryId: spec.libraryId, verb: 'edit', entityType: row.entityType })
      }
    }
  }
  return writes
}
