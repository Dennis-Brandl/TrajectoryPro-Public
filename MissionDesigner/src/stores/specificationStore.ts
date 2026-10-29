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

// Phase 35 §3: specificationStore — single source of truth for spec + library data.
// Wave A1: skeleton + module freeze. Actions added by later waves.

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet, current } from 'immer'
import type { SpecificationStore, SpecificationStoreState, Library, Specification } from './specificationStore/types'
import { api, ApiError } from './specificationStore/apiClient'
import { LibrarySchema, SpecificationSchema, parseSpecData } from './specificationStore/zodSchemas'
import { rebuildIndexes } from './specificationStore/rebuildIndexes'
import { buildBatchSavePayload } from './specificationStore/buildBatchSavePayload'
import { scheduleFlush } from './specificationStore/saveScheduler'
import { bufferDeletedSubtree, getDeletedSubtree } from './specificationStore/subWorkflowUndo'
import { parseHistory } from '@/types/specification-history'
import { CURRENT_DATA_SCHEMA_VERSION } from '@/lib/data-schema-version'

// Required for immer to proxy Map and Set. Called once at module init.
enableMapSet()

export const EMPTY_ARRAY: readonly never[] = Object.freeze([])

function initialState(): SpecificationStoreState {
  return {
    specs: new Map(),
    libraries: new Map(),
    childrenOf: new Map(),
    rootOf: new Map(),
    rootsInLibrary: new Map(),
    dirtyCountByLibrary: new Map(),
    dirtyIds: new Set(),
    pendingDeletes: new Set(),
    pendingImageOps: [],
    preEditSnapshots: new Map(),
    unsavedNewIds: new Set(),
    savingIds: new Set(),
    sentSnapshots: new Map(),
    postSaveDirtyQueue: new Map(),
    lastSaveError: null,
    librariesDirty: new Set(),
    librariesSaving: new Set(),
    librariesPreEditSnapshots: new Map(),
    lastLibrarySaveError: null,
    loadingTreeIds: new Set(),
    isLibrariesLoaded: false,
    isLibrariesLoading: false,
    crashBufferDirty: false,
    bootPhase: 'me-loading',
    pendingCreationIds: new Set(),
    pendingRetryIds: new Set(),
    loadedRootIds: new Set(),
    currentlyPreviewedId: null,
    previewLruIds: [],
    inflightPreviewLoads: new Map(),
  }
}

export const useSpecificationStore = create<SpecificationStore>()(
  immer((set, get) => ({
    ...initialState(),
    _reset: () => {
      inflight = null
      set(() => initialState())
    },

    async loadLibraries() {
      set((d) => {
        d.isLibrariesLoading = true
      })
      try {
        const response = await api.listLibraries()
        const validated: Library[] = []
        for (const raw of response.libraries) {
          const parsed = LibrarySchema.parse(raw)
          validated.push({
            id: parsed.id,
            parentLibraryId: parsed.parentLibraryId,
            teamId: parsed.teamId ?? null,
            name: parsed.name,
            entityType: parsed.entityType,
            description: parsed.description,
            author: parsed.author ?? null,
            changeHistory: parsed.changeHistory ?? null,
            version: parsed.version ?? '1.0.0',
            environmentLibraryIds: [],
            createdAt: parsed.createdAt,
            updatedAt: parsed.updatedAt,
            lastEditedByUserId: parsed.lastEditedByUserId,
          })
        }
        set((d) => {
          d.libraries.clear()
          for (const lib of validated) d.libraries.set(lib.id, lib)
          d.isLibrariesLoaded = true
          d.isLibrariesLoading = false
        })
      } catch (err) {
        set((d) => {
          d.isLibrariesLoading = false
        })
        throw err
      }
    },

    async loadTree(rootSpecId: string) {
      set((d) => {
        d.loadingTreeIds.add(rootSpecId)
      })
      try {
        const response = await api.getTree(rootSpecId)
        const libParsed = LibrarySchema.parse(response.library)
        const specs: Specification[] = []
        for (const raw of response.specs) {
          const parsed = SpecificationSchema.parse(raw)
          specs.push({
            id: parsed.id,
            parentSpecificationId: parsed.parentSpecificationId,
            rootSpecificationId: parsed.rootSpecificationId,
            libraryId: parsed.libraryId ?? libParsed.id,
            name: parsed.name,
            description: parsed.description,
            typeName: parsed.typeName ?? null,
            version: parsed.version ?? '1.0.0',
            state: parsed.state ?? 'Draft',
            data: parseSpecData(parsed),
            dataSchemaVersion: parsed.dataSchemaVersion,
            history: parseHistory((parsed as { history?: string }).history),
            createdAt: parsed.createdAt,
            updatedAt: parsed.updatedAt,
            lastEditedByUserId: parsed.lastEditedByUserId,
          })
        }
        set((d) => {
          d.libraries.set(libParsed.id, {
            id: libParsed.id,
            parentLibraryId: libParsed.parentLibraryId,
            teamId: libParsed.teamId ?? null,
            name: libParsed.name,
            entityType: libParsed.entityType,
            description: libParsed.description,
            author: libParsed.author ?? null,
            changeHistory: libParsed.changeHistory ?? null,
            version: libParsed.version ?? '1.0.0',
            environmentLibraryIds: [],
            createdAt: libParsed.createdAt,
            updatedAt: libParsed.updatedAt,
            lastEditedByUserId: libParsed.lastEditedByUserId,
          })
          for (const spec of specs) d.specs.set(spec.id, spec)
          d.loadedRootIds.add(rootSpecId)
          d.loadingTreeIds.delete(rootSpecId)
          rebuildIndexes(d, null)
        })
      } catch (err) {
        set((d) => {
          d.loadingTreeIds.delete(rootSpecId)
        })
        throw err
      }
    },

    async loadBulk(ids: string[]) {
      if (ids.length === 0) return
      const response = await api.bulkFetch(ids)
      const validated: Specification[] = []
      for (const raw of response.specs) {
        const parsed = SpecificationSchema.parse(raw)
        validated.push({
          id: parsed.id,
          parentSpecificationId: parsed.parentSpecificationId,
          rootSpecificationId: parsed.rootSpecificationId,
          libraryId: parsed.libraryId ?? '',
          name: parsed.name,
          description: parsed.description,
          typeName: parsed.typeName ?? null,
          version: parsed.version ?? '1.0.0',
          state: parsed.state ?? 'Draft',
          data: parseSpecData(parsed),
          dataSchemaVersion: parsed.dataSchemaVersion,
          history: parseHistory((parsed as { history?: string }).history),
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
          lastEditedByUserId: parsed.lastEditedByUserId,
        })
      }
      set((d) => {
        for (const spec of validated) d.specs.set(spec.id, spec)
        rebuildIndexes(
          d,
          validated.map((s) => s.id),
        )
      })
    },

    async loadSpec(id: string) {
      const response = await api.getSpec(id)
      const parsed = SpecificationSchema.parse(response.spec)
      const spec: Specification = {
        id: parsed.id,
        parentSpecificationId: parsed.parentSpecificationId,
        rootSpecificationId: parsed.rootSpecificationId,
        libraryId: parsed.libraryId ?? '',
        name: parsed.name,
        description: parsed.description,
        typeName: parsed.typeName ?? null,
        version: parsed.version ?? '1.0.0',
        state: parsed.state ?? 'Draft',
        data: parseSpecData(parsed),
        dataSchemaVersion: parsed.dataSchemaVersion,
        history: parseHistory((parsed as { history?: string }).history),
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
        lastEditedByUserId: parsed.lastEditedByUserId,
      }
      set((d) => {
        d.specs.set(spec.id, spec)
        rebuildIndexes(d, [spec.id])
      })
    },

    async ensureLibrarySpecs(libraryId: string) {
      // Skip if specs for this library are already cached.
      const state = get()
      for (const spec of state.specs.values()) {
        if (spec.libraryId === libraryId) return
      }
      const response = await api.listLibrarySpecs(libraryId)
      const ids = response.specs
        .map((s) => (s as { id: string }).id)
        .filter((id): id is string => typeof id === 'string')
      if (ids.length === 0) return
      await get().loadBulk(ids)
    },

    upsertSpec(spec) {
      set((d) => {
        if (d.specs.has(spec.id)) return
        d.specs.set(spec.id, spec)
        rebuildIndexes(d, [spec.id])
      })
    },

    updateInMemory(id, patch) {
      set((d) => {
        const spec = d.specs.get(id)
        if (!spec) return
        // §3.13 i5 (revised): mid-save edits are allowed and just re-dirty the
        // spec; the F1 check after batchSave sees the data diverged and keeps
        // dirtyIds set, scheduling a follow-up save. Silent no-ops here caused
        // user-visible character loss in controlled inputs (the input's value
        // prop reverts to the unchanged store state on the next render).
        // Snapshot capture is gated on BOTH !savingIds and !dirtyIds so the
        // pre-edit snapshot is taken exactly once at the start of a new edit
        // session and is never overwritten by a mid-save edit (where dirtyIds
        // is transiently empty because batchSave cleared it).
        if (!d.savingIds.has(id) && !d.dirtyIds.has(id)) {
          d.preEditSnapshots.set(id, current(spec) as Specification)
        }
        d.dirtyIds.add(id)
        Object.assign(spec, patch)
        rebuildIndexes(d, [id])
        d.crashBufferDirty = true
      })
      scheduleFlush()
    },

    updateSpecData(id, dataPatch) {
      set((d) => {
        const spec = d.specs.get(id)
        if (!spec) return
        // §3.13 i5 (revised) — see updateInMemory above for rationale.
        if (!d.savingIds.has(id) && !d.dirtyIds.has(id)) {
          d.preEditSnapshots.set(id, current(spec) as Specification)
        }
        d.dirtyIds.add(id)
        spec.data = { ...spec.data, ...dataPatch }
        rebuildIndexes(d, [id])
        d.crashBufferDirty = true
      })
      scheduleFlush()
    },

    applyServerState(id, fields) {
      set((d) => {
        const spec = d.specs.get(id)
        if (!spec) return
        spec.state = fields.state
        spec.history = fields.history
        if (fields.version !== undefined) spec.version = fields.version
        // A rollback to the pre-edit snapshot must not revert the server's state.
        const snapshot = d.preEditSnapshots.get(id)
        if (snapshot) {
          snapshot.state = fields.state
          snapshot.history = fields.history
          if (fields.version !== undefined) snapshot.version = fields.version
        }
        rebuildIndexes(d, [id])
      })
    },

    createSpecInMemory({ parentId, libraryId, init, isFromCopyLoop }) {
      // Honor a caller-provided id (init.id) so imports PRESERVE source OIDs
      // (Actions/Environments must keep their OIDs or workflow action-proxy
      // references break). Never overwrite an existing spec — fall back to a
      // fresh id if the requested one is already present.
      let newId = typeof init.id === 'string' && init.id.length > 0 ? init.id : crypto.randomUUID()
      set((d) => {
        if (typeof init.id === 'string' && d.specs.has(newId)) {
          newId = crypto.randomUUID()
        }
        const rootId = parentId ? (d.rootOf.get(parentId) ?? parentId) : newId
        const spec: Specification = {
          id: newId,
          parentSpecificationId: parentId,
          rootSpecificationId: rootId,
          libraryId,
          name: init.name ?? 'New',
          description: init.description ?? null,
          typeName: init.typeName ?? null,
          version: init.version ?? '1.0.0',
          state: init.state ?? 'Draft',
          data: (init.data as Record<string, unknown> | undefined) ?? { nodes: [] },
          dataSchemaVersion: init.dataSchemaVersion ?? CURRENT_DATA_SCHEMA_VERSION,
          history: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastEditedByUserId: null,
        }
        d.specs.set(newId, spec)
        d.dirtyIds.add(newId)
        d.unsavedNewIds.add(newId)
        if (isFromCopyLoop) d.pendingCreationIds.add(newId)
        rebuildIndexes(d, [newId])
        d.crashBufferDirty = true
      })
      scheduleFlush()
      return newId
    },

    deleteSpecInMemory(id) {
      set((d) => {
        // Collect id + all descendants via BFS.
        // childrenOf stores Specification objects that may be stale immer proxies
        // from a prior setState call. To avoid revoked-proxy errors we derive
        // child IDs by scanning specs directly instead of dereferencing the stored
        // Specification references.
        const toDelete = new Set<string>()
        const queue = [id]
        while (queue.length > 0) {
          const cur = queue.shift()!
          if (toDelete.has(cur)) continue
          toDelete.add(cur)
          for (const spec of d.specs.values()) {
            if (spec.parentSpecificationId === cur) queue.push(spec.id)
          }
        }
        for (const delId of toDelete) {
          if (d.unsavedNewIds.has(delId)) {
            // Never saved to the server — discard locally instead of sending a
            // delete op for a row that doesn't exist.
            d.specs.delete(delId)
            d.unsavedNewIds.delete(delId)
            d.pendingCreationIds.delete(delId)
            d.dirtyIds.delete(delId)
            d.preEditSnapshots.delete(delId)
          } else {
            d.pendingDeletes.add(delId)
          }
        }
        rebuildIndexes(d, Array.from(toDelete))
        d.crashBufferDirty = true
      })
      scheduleFlush()
    },

    deleteSubWorkflowSubtree(rootId) {
      // Snapshot the full subtree (the embedded child + its descendants) BEFORE
      // deleting, so undo can restore it even after the auto-save commits and
      // purges the rows server-side.
      const { specs } = get()
      if (specs.has(rootId)) {
        const snapshot: Specification[] = []
        const seen = new Set<string>()
        const queue = [rootId]
        while (queue.length > 0) {
          const cur = queue.shift()!
          if (seen.has(cur)) continue
          seen.add(cur)
          const spec = specs.get(cur)
          if (!spec) continue
          snapshot.push(structuredClone(spec))
          for (const s of specs.values()) {
            if (s.parentSpecificationId === cur) queue.push(s.id)
          }
        }
        bufferDeletedSubtree(rootId, snapshot)
      }
      get().deleteSpecInMemory(rootId)
    },

    restoreSubWorkflowSubtree(rootId) {
      const snapshot = getDeletedSubtree(rootId)
      if (!snapshot) return
      set((d) => {
        for (const snap of snapshot) {
          if (d.specs.has(snap.id) && d.pendingDeletes.has(snap.id)) {
            // The deletion has not yet been committed server-side — just un-mark it.
            d.pendingDeletes.delete(snap.id)
          } else if (!d.specs.has(snap.id)) {
            // Purged (committed delete, or an unsaved spec that was discarded) →
            // re-create it as a new spec so the next save re-persists it.
            d.specs.set(snap.id, structuredClone(snap))
            d.pendingDeletes.delete(snap.id)
            d.unsavedNewIds.add(snap.id)
            d.dirtyIds.add(snap.id)
          }
        }
        rebuildIndexes(
          d,
          snapshot.map((s) => s.id),
        )
        d.crashBufferDirty = true
      })
      scheduleFlush()
    },

    removeImageReferenceInMemory(specId, filename) {
      set((d) => {
        d.pendingImageOps.push({ kind: 'delete', specificationId: specId, filename })
        if (!d.dirtyIds.has(specId)) {
          const spec = d.specs.get(specId)
          if (spec) d.preEditSnapshots.set(specId, current(spec) as Specification)
          d.dirtyIds.add(specId)
          rebuildIndexes(d, [specId])
        }
        d.crashBufferDirty = true
      })
      scheduleFlush()
    },

    discardLocalEdits(ids, opts) {
      if (!opts.confirmedByUser) throw new Error('discardLocalEdits requires confirmedByUser: true')
      set((d) => {
        for (const id of ids) {
          const snapshot = d.preEditSnapshots.get(id)
          if (snapshot) d.specs.set(id, snapshot)
          d.preEditSnapshots.delete(id)
          d.dirtyIds.delete(id)
        }
        rebuildIndexes(d, ids)
        d.crashBufferDirty = true
      })
    },

    discardUncreated(id) {
      const state = get()
      const spec = state.specs.get(id)
      if (spec && !state.unsavedNewIds.has(id)) {
        throw new Error(`discardUncreated refused: ${id} is not a locally-created (unsaved) spec`)
      }
      set((d) => {
        d.specs.delete(id)
        d.dirtyIds.delete(id)
        d.pendingCreationIds.delete(id)
        d.unsavedNewIds.delete(id)
        d.preEditSnapshots.delete(id)
        rebuildIndexes(d, [id])
      })
    },

    releaseFromPendingCreation(id) {
      set((d) => {
        d.pendingCreationIds.delete(id)
      })
    },

    setBootPhase(phase) {
      set((d) => {
        d.bootPhase = phase
      })
    },

    async batchSave() {
      // §3.9 step 0 — never two saves at once. A caller that arrives while a
      // save is in flight waits for it, then sends whatever is still dirty
      // (an edit made mid-save). If the awaited save failed, stop: a failure
      // is never retried by itself (the next edit or a Save click retries).
      // The guard is the in-flight promise, not savingIds, so delete-only and
      // image-only batches are covered too.
      while (inflight) {
        const ok = await inflight
        if (!ok) return
      }
      const attempt = runSaveAttempt()
      const tracked = attempt.finally(() => {
        if (inflight === tracked) inflight = null
      })
      inflight = tracked
      await tracked
    },
  })),
)

/** In-flight batch save (resolves true on success or nothing to send, false on failure). */
let inflight: Promise<boolean> | null = null

/** True while a batch save is running. */
export function isBatchSaveInFlight(): boolean {
  return inflight !== null
}

/** One batch-save attempt. Never throws; failures land in lastSaveError. */
async function runSaveAttempt(): Promise<boolean> {
  const set = useSpecificationStore.setState
  const get = useSpecificationStore.getState
  const state = get()
  const payload = buildBatchSavePayload()
  if (payload.specs.length === 0 && payload.imageDeletes.length === 0 && payload.imageRefs.length === 0) {
    return true
  }
  // Snapshot sending ids and their data blobs for reference-equality check
  const sendingIds: string[] = []
  const sentCreateIds: string[] = []
  const sentDeleteIds: string[] = []
  const sentSnapshots = new Map<string, Record<string, unknown>>()
  for (const s of payload.specs) {
    const id = (s as { id: string; op: string }).id
    const op = (s as { id: string; op: string }).op
    if (op === 'delete') {
      sentDeleteIds.push(id)
      continue
    }
    if (op === 'create') sentCreateIds.push(id)
    const spec = state.specs.get(id)
    if (spec) {
      sendingIds.push(id)
      sentSnapshots.set(id, spec.data)
    }
  }
  set((d) => {
    for (const id of sendingIds) {
      d.savingIds.add(id)
      d.dirtyIds.delete(id)
    }
    d.sentSnapshots = sentSnapshots
    d.lastSaveError = null
  })

  try {
    await api.batchSave(payload)
    set((d) => {
      for (const id of sendingIds) {
        const spec = d.specs.get(id)
        if (spec) {
          // Promote unsaved-new to saved
          d.unsavedNewIds.delete(id)
          // F1 check: did the user re-edit during save?
          const sent = sentSnapshots.get(id)
          if (sent !== current(spec).data) {
            // Mid-save edit — keep dirty
            d.dirtyIds.add(id)
          }
        }
      }
      // Finalize deletes: remove specs and clear pendingDeletes now that the
      // server has confirmed the deletion.
      for (const id of sentDeleteIds) {
        d.specs.delete(id)
        d.pendingDeletes.delete(id)
        d.preEditSnapshots.delete(id)
        d.dirtyIds.delete(id)
        d.unsavedNewIds.delete(id)
      }
      // Drain postSaveDirtyQueue
      for (const [id, data] of d.postSaveDirtyQueue) {
        const spec = d.specs.get(id)
        if (spec) {
          if (!d.dirtyIds.has(id)) d.preEditSnapshots.set(id, current(spec) as Specification)
          spec.data = data
          d.dirtyIds.add(id)
        }
      }
      d.postSaveDirtyQueue = new Map()
      d.sentSnapshots = new Map()
      for (const id of sendingIds) d.savingIds.delete(id)
      rebuildIndexes(d, [...sendingIds, ...sentDeleteIds])
      d.crashBufferDirty = true
    })
    // Re-arm: a spec edited mid-save is still dirty and needs its own save.
    // Only after a success, so a failure that keeps happening can't loop.
    if (get().dirtyIds.size > 0) scheduleFlush()
    return true
  } catch (err) {
    if (err instanceof ApiError) {
      set((d) => {
        for (const id of sendingIds) {
          d.savingIds.delete(id)
          d.dirtyIds.add(id) // re-dirty on any error
        }
        d.sentSnapshots = new Map()
        d.lastSaveError = {
          status: err.status,
          code: err.code,
          message: `${err.status} ${err.code}`,
        }
      })
      // Self-heal for 409 conflicts on CREATE ops: the server already has
      // a row for this id (e.g. a prior save succeeded on the server but
      // the client never observed the 200, or the spec survived a client
      // state reset). Verify which sent creates actually exist on the
      // server, demote those from unsavedNewIds so the next batch sends
      // an UPDATE instead of a duplicate CREATE, then schedule a retry.
      if (err.status === 409 && sentCreateIds.length > 0) {
        void (async () => {
          try {
            const result = await api.bulkFetch(sentCreateIds)
            const existingIds = new Set(result.specs.map((s) => (s as { id: string }).id))
            if (existingIds.size > 0) {
              set((d) => {
                for (const id of existingIds) {
                  if (d.specs.has(id)) {
                    d.unsavedNewIds.delete(id)
                    d.dirtyIds.add(id) // ensure the next save includes this as update
                  }
                }
              })
              scheduleFlush()
            }
          } catch {
            // If the reconciliation fetch itself fails, leave state as-is;
            // the user can still click Retry save.
          }
        })()
      }
    } else {
      set((d) => {
        for (const id of sendingIds) {
          d.savingIds.delete(id)
          d.dirtyIds.add(id)
        }
        d.sentSnapshots = new Map()
        d.lastSaveError = { status: 0, code: 'unknown', message: String(err) }
      })
    }
    return false
  }
}

// §3.13 invariant 14 — module-level seal. Ships immediately so callers cannot
// monkey-patch the store hook.
Object.freeze(useSpecificationStore)
