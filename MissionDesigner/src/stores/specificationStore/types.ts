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

// Phase 35 §3.2: specificationStore state shape.
// Crash-buffer fields are included but unused during Phase 3 (deferred to 3b cleanup).

import type { SpecificationHistoryEntry } from '@/types/specification-history'

export interface Specification {
  id: string
  parentSpecificationId: string | null
  rootSpecificationId: string
  libraryId: string
  name: string
  description: string | null
  typeName: string | null
  version: string
  state: string
  data: Record<string, unknown>
  dataSchemaVersion: number
  history: SpecificationHistoryEntry[]
  createdAt: number
  updatedAt: number
  lastEditedByUserId: string | null
}

export interface Library {
  id: string
  parentLibraryId: string | null
  teamId: string | null
  name: string
  entityType: string
  description: string | null
  author: string | null
  changeHistory: string | null
  version: string
  environmentLibraryIds: string[]
  createdAt: number
  updatedAt: number
  lastEditedByUserId: string | null
}

export interface PendingImageOp {
  kind: 'create' | 'delete'
  specificationId: string
  imageId?: string // create path
  filename?: string // delete path
}

export interface SaveError {
  status: number
  code: string
  message: string
}

export type BootPhase = 'me-loading' | 'libraries-loading' | 'recovery-checking' | 'recovery-modal' | 'ready'

export interface SpecificationStoreState {
  // canonical
  specs: Map<string, Specification>
  libraries: Map<string, Library>
  // derived indexes (B2)
  childrenOf: Map<string, readonly Specification[]>
  rootOf: Map<string, string>
  rootsInLibrary: Map<string, readonly Specification[]>
  dirtyCountByLibrary: Map<string, number>
  // dirty tracking
  dirtyIds: Set<string>
  pendingDeletes: Set<string>
  pendingImageOps: PendingImageOp[]
  preEditSnapshots: Map<string, Specification>
  // locally-created ids not yet saved on the server (replaces the old rowVersion === 0 check)
  unsavedNewIds: Set<string>
  // save lifecycle
  savingIds: Set<string>
  sentSnapshots: Map<string, Record<string, unknown>>
  postSaveDirtyQueue: Map<string, Record<string, unknown>>
  lastSaveError: SaveError | null
  // library autosave (mirrors specs' dirty/saving/error tracking but for the
  // library-metadata server endpoint, which is a different code path)
  librariesDirty: Set<string>
  librariesSaving: Set<string>
  librariesPreEditSnapshots: Map<string, Library>
  lastLibrarySaveError: SaveError | null
  // load lifecycle
  loadingTreeIds: Set<string>
  isLibrariesLoaded: boolean
  isLibrariesLoading: boolean
  // crash-recovery pointer (deferred to Phase 3b)
  crashBufferDirty: boolean
  // §4 carve-outs
  bootPhase: BootPhase
  pendingCreationIds: Set<string>
  pendingRetryIds: Set<string>
  loadedRootIds: Set<string>
  currentlyPreviewedId: string | null
  previewLruIds: string[]
  inflightPreviewLoads: Map<string, AbortController>
}

export interface SpecificationStoreActions {
  // placeholder — filled in by later tasks
  _reset(): void
  loadLibraries(): Promise<void>
  loadTree(rootSpecId: string): Promise<void>
  loadBulk(ids: string[]): Promise<void>
  loadSpec(id: string): Promise<void>
  /** Fetch root specs for a library (by id+metadata) and hydrate them into `specs` so the sidebar tree can render them. No-op when specs for this library are already cached. */
  ensureLibrarySpecs(libraryId: string): Promise<void>
  /** Insert a spec into the store if not already present. No-op if the id already exists. */
  upsertSpec(spec: Specification): void
  updateInMemory(
    id: string,
    patch: Partial<Pick<Specification, 'name' | 'data' | 'description' | 'typeName' | 'version'>>,
  ): void
  updateSpecData(id: string, dataPatch: Record<string, unknown>): void
  /** Mirror a server-side state change (PATCH /state) into the cached spec. Not an edit: never marks it dirty. */
  applyServerState(id: string, fields: Pick<Specification, 'state' | 'history'> & { version?: string }): void
  /** Mirror a server-side move: every cached spec of the given root trees now lives in `libraryId`. Not an edit. */
  applyServerLibrary(rootIds: string[], libraryId: string): void
  createSpecInMemory(args: {
    parentId: string | null
    libraryId: string
    init: Partial<Specification>
    isFromCopyLoop?: boolean
  }): string
  deleteSpecInMemory(id: string): void
  /** Snapshot a sub-workflow's subtree (for undo) then delete it (cascade). */
  deleteSubWorkflowSubtree(rootId: string): void
  /** Restore a sub-workflow subtree deleted via deleteSubWorkflowSubtree (undo). */
  restoreSubWorkflowSubtree(rootId: string): void
  removeImageReferenceInMemory(specId: string, filename: string): void
  discardLocalEdits(ids: string[], opts: { confirmedByUser: true }): void
  discardUncreated(id: string): void
  releaseFromPendingCreation(id: string): void
  setBootPhase(phase: BootPhase): void
  batchSave(): Promise<void>
}

export type SpecificationStore = SpecificationStoreState & SpecificationStoreActions
