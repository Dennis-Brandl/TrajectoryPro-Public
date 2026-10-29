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

// Phase 3b: library-level CRUD flow helpers. These call the server directly
// (not through batchSave) and merge the response into state.libraries.

import { useSpecificationStore } from '@/stores/specificationStore'
import { api, ApiError } from '@/stores/specificationStore/apiClient'
import type { Library } from '@/stores/specificationStore/types'
import type { ReleasedSpecSummary } from '@/types/library'
import { useLibraryStore } from '@/stores/libraryStore'

// Rebuilds the legacy libraryStore view from specificationStore after a CRUD op.
// Must NOT pass entityType — fetchLibraries filters libraryStore.libraries down to
// the arg, which hides libraries of other types on every CRUD. The sidebar's
// useFilteredLibraries selector filters by active type at the view layer, so the
// store should always hold every type.
function syncLibraryStore(): void {
  void useLibraryStore.getState().fetchLibraries()
}

export interface CreateLibraryInput {
  name: string
  entityType: 'workflow' | 'action' | 'environment' | 'step'
  teamId: string
  parentLibraryId?: string
  description?: string
}

export async function createLibrary(input: CreateLibraryInput): Promise<Library | null> {
  try {
    const { library } = await api.createLibrary(input)
    const lib = library as unknown as Library
    useSpecificationStore.setState((s) => {
      const libs = new Map(s.libraries)
      libs.set(lib.id, lib)
      return { libraries: libs }
    })
    syncLibraryStore()
    return lib
  } catch (err) {
    console.error('[libraryCrud] createLibrary error', err)
    useSpecificationStore.setState((d) => {
      d.lastLibrarySaveError =
        err instanceof ApiError
          ? { status: err.status, code: err.code, message: `${err.status} ${err.code}` }
          : { status: 0, code: 'unknown', message: err instanceof Error ? err.message : String(err) }
    })
    return null
  }
}

export async function updateLibrary(
  id: string,
  patch: {
    name?: string
    description?: string | null
    author?: string | null
    changeHistory?: string | null
    version?: string
  },
): Promise<Library | null> {
  const current = useSpecificationStore.getState().libraries.get(id)
  if (!current) return null
  try {
    const { library } = await api.updateLibrary(id, patch)
    const lib = library as unknown as Library
    useSpecificationStore.setState((s) => {
      const libs = new Map(s.libraries)
      libs.set(lib.id, lib)
      return { libraries: libs }
    })
    syncLibraryStore()
    return lib
  } catch (err) {
    console.error('[libraryCrud] updateLibrary error', err)
    return null
  }
}

export async function renameLibrary(id: string, newName: string): Promise<boolean> {
  const result = await updateLibrary(id, { name: newName })
  return result !== null
}

// =============================================================================
// Library autosave / write-through (mirrors specs' updateInMemory + scheduleFlush)
// =============================================================================

export type LibraryEditPatch = {
  description?: string | null
  author?: string | null
  changeHistory?: string | null
  version?: string
  environmentLibraryIds?: string[]
}

const LIBRARY_FLUSH_DEBOUNCE_MS = 500
let libraryFlushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleLibraryFlush(): void {
  if (libraryFlushTimer !== null) clearTimeout(libraryFlushTimer)
  libraryFlushTimer = setTimeout(() => {
    libraryFlushTimer = null
    void flushDirtyLibraries()
  }, LIBRARY_FLUSH_DEBOUNCE_MS)
}

/**
 * Apply a patch to a library in-memory and queue a debounced server flush.
 *
 * Mirrors `useSpecificationStore.updateInMemory` for specs: captures a
 * pre-edit snapshot on first touch, marks the library dirty, and schedules
 * the (debounced) server save. The detail view reads its fields directly
 * out of the store, so this single call is enough to update the UI.
 */
export function updateLibraryInMemory(id: string, patch: LibraryEditPatch): void {
  const store = useSpecificationStore.getState()
  const current = store.libraries.get(id)
  if (!current) return
  if (store.librariesSaving.has(id)) return // edit lock during in-flight save
  useSpecificationStore.setState((d) => {
    if (!d.librariesDirty.has(id)) {
      d.librariesPreEditSnapshots.set(id, current)
      d.librariesDirty.add(id)
    }
    const next = d.libraries.get(id)
    if (!next) return
    if (patch.description !== undefined) next.description = patch.description
    if (patch.author !== undefined) next.author = patch.author
    if (patch.changeHistory !== undefined) next.changeHistory = patch.changeHistory
    if (patch.version !== undefined) next.version = patch.version
    if (patch.environmentLibraryIds !== undefined) next.environmentLibraryIds = patch.environmentLibraryIds
  })
  syncLibraryStore()
  scheduleLibraryFlush()
}

async function flushOneLibrary(id: string): Promise<void> {
  const store = useSpecificationStore.getState()
  const lib = store.libraries.get(id)
  if (!lib) return
  // Move id from dirty → saving for the duration of the request.
  useSpecificationStore.setState((d) => {
    d.librariesDirty.delete(id)
    d.librariesSaving.add(id)
  })
  try {
    const { library } = await api.updateLibrary(id, {
      description: lib.description,
      author: lib.author,
      changeHistory: lib.changeHistory,
      version: lib.version,
      environmentLibraryIds: lib.environmentLibraryIds ?? null,
    })
    const updated = library as unknown as Library
    useSpecificationStore.setState((d) => {
      d.libraries.set(updated.id, updated)
      d.librariesSaving.delete(id)
      d.librariesPreEditSnapshots.delete(id)
      d.lastLibrarySaveError = null
    })
  } catch (err) {
    // Re-mark dirty so the user can retry. Surface the error.
    useSpecificationStore.setState((d) => {
      d.librariesSaving.delete(id)
      d.librariesDirty.add(id)
      if (err instanceof ApiError) {
        d.lastLibrarySaveError = { status: err.status, code: err.code, message: `${err.status} ${err.code}` }
      } else {
        d.lastLibrarySaveError = {
          status: 0,
          code: 'unknown',
          message: err instanceof Error ? err.message : String(err),
        }
      }
    })
  }
}

/**
 * Flush all currently-dirty libraries to the server, in parallel.
 * Internal — call from the debounce timer or from {@link flushLibrariesNow}.
 */
async function flushDirtyLibraries(): Promise<void> {
  const ids = [...useSpecificationStore.getState().librariesDirty]
  if (ids.length === 0) return
  await Promise.all(ids.map((id) => flushOneLibrary(id)))
  syncLibraryStore()
}

/**
 * Cancel any pending debounce timer and immediately flush every dirty library
 * to the server. Resolves once all in-flight saves complete.
 */
export async function flushLibrariesNow(): Promise<void> {
  if (libraryFlushTimer !== null) {
    clearTimeout(libraryFlushTimer)
    libraryFlushTimer = null
  }
  await flushDirtyLibraries()
}

/**
 * Discard local edits to a library, reverting to the pre-edit snapshot
 * captured the first time the user touched it since its last server save.
 * Requires explicit user confirmation (parameter shape mirrors spec-side
 * `discardLocalEdits`).
 */
export function discardLibraryEdits(id: string, opts: { confirmedByUser: boolean }): void {
  if (!opts.confirmedByUser) {
    throw new Error('discardLibraryEdits requires confirmedByUser: true')
  }
  useSpecificationStore.setState((d) => {
    const snapshot = d.librariesPreEditSnapshots.get(id)
    if (snapshot) d.libraries.set(id, snapshot)
    d.librariesDirty.delete(id)
    d.librariesPreEditSnapshots.delete(id)
  })
  syncLibraryStore()
}

export type DeleteLibraryResult = { ok: true } | { ok: false; code: string; releasedSpecs?: ReleasedSpecSummary[] }

export async function deleteLibrary(id: string, confirmedReleasedIds?: string[]): Promise<DeleteLibraryResult> {
  try {
    await api.deleteLibrary(id, confirmedReleasedIds)
    useSpecificationStore.setState((s) => {
      const libs = new Map(s.libraries)
      libs.delete(id)
      return { libraries: libs }
    })
    syncLibraryStore()
    return { ok: true }
  } catch (err) {
    if (err instanceof ApiError && err.code === 'library_not_empty') {
      console.warn('[libraryCrud] deleteLibrary: library not empty', id)
    } else {
      console.error('[libraryCrud] deleteLibrary error', err)
    }
    useSpecificationStore.setState((d) => {
      d.lastLibrarySaveError =
        err instanceof ApiError
          ? { status: err.status, code: err.code, message: `${err.status} ${err.code}` }
          : { status: 0, code: 'unknown', message: err instanceof Error ? err.message : String(err) }
    })
    if (err instanceof ApiError) {
      const rel = err.body?.releasedSpecs
      return {
        ok: false,
        code: err.code,
        releasedSpecs: Array.isArray(rel) ? (rel as ReleasedSpecSummary[]) : undefined,
      }
    }
    return { ok: false, code: 'unknown' }
  }
}
