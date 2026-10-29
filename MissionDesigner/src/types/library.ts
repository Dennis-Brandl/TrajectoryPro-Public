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

import type { SpecificationHistoryEntry } from './specification-history'

/** A released (Approved/Effective/Superseded) workflow found under a library about to be deleted. */
export interface ReleasedSpecSummary {
  id: string
  name: string
  version: string
  state: string
  embeddedCount: number
}

export type EntityType = 'workflow' | 'step' | 'environment' | 'action'

export interface Library {
  id: string
  teamId?: string | null
  parentLibraryId?: string | null
  name: string
  entityType: EntityType
  description?: string | null
  author?: string | null
  changeHistory?: string | null
  version?: string
  environmentLibraryIds?: string[] | null // Associated environment libraries (for workflow/step libraries)
  createdAt: number
  updatedAt: number
}

export type SpecificationState = 'Draft' | 'InTest' | 'InReview' | 'Approved' | 'Effective' | 'Superseded' | 'Obsolete'

export interface Specification {
  id: string
  libraryId: string
  name: string
  description: string | null
  typeName?: string | null
  version: string
  state: SpecificationState
  data: Record<string, unknown> // JSON blob for spec content
  environmentLibraryIds?: string[] | null // Associated environment libraries
  history: SpecificationHistoryEntry[]
  createdAt: number
  updatedAt: number
  /**
   * specificationStore.Specification's per-row format stamp, threaded through
   * when a source spec is in hand (e.g. copy-from-step-library, import) so a
   * copy of unconverted (< CURRENT_DATA_SCHEMA_VERSION) data is still visible
   * to the boot migration as unconverted. Optional/undefined for genuinely
   * fresh specs with no source stamp to preserve — those correctly default to
   * CURRENT_DATA_SCHEMA_VERSION at creation (specificationStore.createSpecInMemory).
   */
  dataSchemaVersion?: number
}

export interface ChildSpecification {
  id: string
  parentSpecificationId: string
  parentChildSpecId: string | null
  name: string
  description: string | null
  typeName?: string | null
  data: Record<string, unknown>
  depth: number
  createdAt: number
  updatedAt: number
}
