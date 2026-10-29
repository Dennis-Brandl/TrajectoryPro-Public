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

/**
 * Wire format shared by the .WFlibX preview/commit endpoints and the
 * client-side import dialog. See:
 * docs/superpowers/specs/2026-05-18-wflibx-import-design.md
 */

export type WflibxEntityType = 'workflow' | 'step' | 'environment' | 'action'

export type ImportPlanRowStatus =
  | { tag: 'create' }
  | { tag: 'add-to-existing'; existingLibraryOid: string }
  | { tag: 'conflict'; existingOid: string; existingName: string; existingVersion: string }
  | { tag: 'no-op'; existingOid: string }
  /**
   * A conflict the server will not Replace (spec 2026-10-21 §6): the Replace would delete or
   * change an edit-locked spec, or the importer may not delete the existing one. Treated as Keep.
   */
  | {
      tag: 'refused'
      existingOid: string
      existingName: string
      existingVersion: string
      /** The existing spec's state; '' for a library row. */
      existingState: string
      refusal: ReplaceRefusal
    }

/**
 * `changed-since-export`: the same OID is already here, but its state or version no longer matches
 * the file (the file is out of date). Nothing is written for it.
 */
export type ReplaceRefusalReason = 'locked' | 'no-permission' | 'changed-since-export'

/** A spec in an edit-locked state that a Replace would delete or change. */
export interface Blocker {
  specId: string
  name: string
  version: string
  state: string
  /** The matched spec itself, a spec its delete cascades to, or a spec whose proxy link it removes. */
  why: 'is-locked' | 'family-locked' | 'owns-proxy-link'
}

export interface ReplaceRefusal {
  reason: ReplaceRefusalReason
  blockers: Blocker[]
  /** changed-since-export: the state the file records ('' when the file has none). */
  fileState?: string
  /** changed-since-export: the version of this spec that is Effective here, when another one is. */
  effectiveVersionHere?: string
}

export interface ImportPlanRow {
  kind: 'library' | 'specification'
  entityType: WflibxEntityType
  bundleOid: string
  bundleName: string
  bundleVersion: string
  /** For specifications: the OID of the library they belong to in the bundle. */
  parentLibraryOid?: string
  status: ImportPlanRowStatus
}

export interface ImportPlan {
  previewId: string
  bundleLibraryName: string
  rows: ImportPlanRow[]
  warnings: string[]
}

export interface CommitRequest {
  previewId: string
  /** The team that will own every library this import creates. */
  teamId: string
  /** Required for every row whose status.tag === 'conflict'. A 'replace' for a 'refused' row is a 422. */
  resolutions: Record</* bundleOid */ string, 'keep' | 'replace'>
}

export interface DanglingReference {
  referrerOid: string
  referrerName: string
  referrerEntityType: WflibxEntityType
  brokenReferenceTo: string
}

export interface RefusedReplace {
  oid: string
  name: string
  version: string
  /** The locked state that blocked the Replace, or the existing state for a rights refusal. */
  state: string
  reason: ReplaceRefusalReason
  /** changed-since-export: the version and state the file records. */
  fileVersion?: string
  fileState?: string
  effectiveVersionHere?: string
}

export interface PostImportReport {
  created: { libraries: number; specifications: number }
  replaced: { libraries: number; specifications: number }
  kept: { libraries: number; specifications: number }
  noOp: { libraries: number; specifications: number }
  danglingReferences: DanglingReference[]
  /** Conflicts the server would not Replace; each was kept as it is. */
  refused: RefusedReplace[]
  /**
   * Rows the commit SKIPPED even though the plan scheduled a write (bundle JSON
   * missing for an indexed OID, parent library unresolvable). Audit item 3:
   * these were silent `return`s — the preview promised a row that never
   * appeared, with no trace anywhere.
   */
  warnings: string[]
}
