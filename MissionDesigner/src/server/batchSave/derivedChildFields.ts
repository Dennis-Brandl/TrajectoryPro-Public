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

// Phase 35 COEXISTENCE RULE #4: The current `specification` table carries
// `libraryId`, `version`, and `state` as NOT NULL (inherited from pre-phase-35).
// The §1 schema's CHECK constraint requiring children to hold NULL for these
// is DEFERRED to Plan 4. During Plan 2a, every child spec created via
// batch-save carries the root's values for these three columns.
//
// When Plan 4 drops the NOT NULLs and installs the CHECK, this file's body
// becomes `return { libraryId: null, version: null, state: null }`.
// Every call site uses this helper so that is a one-line change.

import { rawQuery } from '../lib/db'
import type { SpecificationState } from '../../types/library'

export interface DerivedChildFields {
  libraryId: string
  version: string
  state: SpecificationState
}

export async function derivedChildFields(
  rootId: string,
  q: typeof rawQuery = rawQuery,
): Promise<DerivedChildFields | null> {
  const rows = await q<{ libraryId: string | null; version: string | null; state: SpecificationState | null }>(
    'SELECT "libraryId", version, state FROM specification WHERE id = $1',
    [rootId],
  )
  const row = rows[0]
  if (!row?.libraryId || !row.version || !row.state) return null
  return { libraryId: row.libraryId, version: row.version, state: row.state }
}
