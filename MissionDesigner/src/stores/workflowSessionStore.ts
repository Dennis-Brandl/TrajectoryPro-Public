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

import { create } from 'zustand'
import { useSpecificationStore } from '@/stores/specificationStore'
import { flushLibrariesNow, discardLibraryEdits } from '@/stores/specificationStore/libraryCrud'
import { flushNow } from '@/stores/specificationStore/saveScheduler'
import type { Viewport } from '@/stores/types'

interface WorkflowSessionState {
  /** Top-level spec opened from library (root of editing hierarchy) */
  editingRootSpecId: string | null
  /** Library containing the root spec */
  editingLibraryId: string | null
  /** Specs changed during this editing session */
  modifiedSpecIds: Set<string>
  /** Deferred navigation action for after Save/Discard */
  pendingAction: (() => void) | null
  /** Controls the unsaved-changes dialog visibility */
  showUnsavedDialog: boolean

  /** Per-spec viewport memory for deep-link navigation restore (§3.7) */
  viewportMemory: Map<string, Viewport>

  // Actions
  startSession: (rootSpecId: string, libraryId: string) => void
  clearSession: () => void
  markModified: (specId: string) => void
  hasUnsavedChanges: () => boolean
  isInHierarchy: (specId: string) => boolean
  /** Store the last-seen viewport for a spec (upserts) */
  rememberViewport: (specId: string, viewport: Viewport) => void
  /** Retrieve the last-seen viewport for a spec, or undefined if none */
  recallViewport: (specId: string) => Viewport | undefined

  requestNavigation: (action: () => void) => void
  handleSave: () => Promise<void>
  handleDiscard: () => Promise<void>
  handleKeepEditing: () => void
}

export const useWorkflowSessionStore = create<WorkflowSessionState>()((set, get) => ({
  editingRootSpecId: null,
  editingLibraryId: null,
  modifiedSpecIds: new Set(),
  pendingAction: null,
  showUnsavedDialog: false,
  viewportMemory: new Map(),

  rememberViewport: (specId, viewport) => {
    const next = new Map(get().viewportMemory)
    next.set(specId, viewport)
    set({ viewportMemory: next })
  },

  recallViewport: (specId) => {
    return get().viewportMemory.get(specId)
  },

  startSession: (rootSpecId, libraryId) => {
    set({
      editingRootSpecId: rootSpecId,
      editingLibraryId: libraryId,
      modifiedSpecIds: new Set(),
      pendingAction: null,
      showUnsavedDialog: false,
    })
  },

  clearSession: () => {
    set({
      editingRootSpecId: null,
      editingLibraryId: null,
      modifiedSpecIds: new Set(),
      pendingAction: null,
      showUnsavedDialog: false,
    })
  },

  markModified: (specId) => {
    const { modifiedSpecIds } = get()
    if (!modifiedSpecIds.has(specId)) {
      const next = new Set(modifiedSpecIds)
      next.add(specId)
      set({ modifiedSpecIds: next })
    }
  },

  hasUnsavedChanges: () => {
    if (get().modifiedSpecIds.size > 0) return true
    // After the env/action/library autosave refactor, edits land directly in
    // specificationStore (dirtyIds + librariesDirty) without ever touching
    // modifiedSpecIds. The session-store's logout-flow prompt has to consult
    // those sets too so it doesn't let the user sign out with pending edits.
    const spec = useSpecificationStore.getState()
    return spec.dirtyIds.size > 0 || spec.librariesDirty.size > 0
  },

  /**
   * Check if specId is the root spec or a descendant of the root in specificationStore.
   */
  isInHierarchy: (specId) => {
    const { editingRootSpecId } = get()
    if (!editingRootSpecId) return false
    if (specId === editingRootSpecId) return true
    const rootChildren = useSpecificationStore.getState().childrenOf.get(editingRootSpecId) ?? []
    return rootChildren.some((c) => c.id === specId)
  },

  requestNavigation: (action) => {
    set({ pendingAction: action, showUnsavedDialog: true })
  },

  handleSave: async () => {
    const { pendingAction } = get()

    // Flush specs (workflow editor + env/action detail views) AND libraries
    // (library detail view) — both can be dirty after the autosave refactor.
    // A failed spec save keeps the dialog and the session as they are and runs
    // nothing pending; the global SaveErrorToast says why, Discard is the way out.
    const [specs] = await Promise.allSettled([flushNow(), flushLibrariesNow()])
    if (specs.status === 'rejected') {
      console.error('Save failed:', specs.reason)
      return
    }

    const action = pendingAction
    // Clear session state
    set({
      editingRootSpecId: null,
      editingLibraryId: null,
      modifiedSpecIds: new Set(),
      pendingAction: null,
      showUnsavedDialog: false,
    })
    action?.()
  },

  handleDiscard: async () => {
    const { editingLibraryId, editingRootSpecId, pendingAction } = get()

    if (editingRootSpecId) {
      // Discard local edits for root and all descendants
      const specState = useSpecificationStore.getState()
      const rootAndDescendants = [editingRootSpecId]
      const children = specState.childrenOf.get(editingRootSpecId) ?? []
      for (const c of children) rootAndDescendants.push(c.id)
      specState.discardLocalEdits(rootAndDescendants, { confirmedByUser: true })

      // Re-fetch the tree from server to restore server state
      await specState.loadTree(editingRootSpecId)
    } else if (editingLibraryId) {
      // Dynamic import to avoid circular deps
      const { useLibraryStore } = await import('./libraryStore')
      await useLibraryStore.getState().fetchSpecifications(editingLibraryId)
    }

    // Discard any spec edits not covered by the editingRootSpecId path (the
    // env/action detail views land edits in specStore.dirtyIds without ever
    // calling startSession, so they're invisible to the editingRootSpecId
    // discard above) plus every dirty library.
    const specState = useSpecificationStore.getState()
    const remainingDirtySpecs = [...specState.dirtyIds]
    if (remainingDirtySpecs.length > 0) {
      specState.discardLocalEdits(remainingDirtySpecs, { confirmedByUser: true })
    }
    for (const libId of specState.librariesDirty) {
      discardLibraryEdits(libId, { confirmedByUser: true })
    }

    const action = pendingAction
    // Clear session state
    set({
      editingRootSpecId: null,
      editingLibraryId: null,
      modifiedSpecIds: new Set(),
      pendingAction: null,
      showUnsavedDialog: false,
    })
    action?.()
  },

  handleKeepEditing: () => {
    set({ pendingAction: null, showUnsavedDialog: false })
  },
}))

/**
 * Sign out only once everything is saved. Drains specs and libraries first;
 * if a save failed, or anything is still unsaved or saving, the unsaved dialog
 * asks instead (its Save retries, Discard signs out without the edits).
 */
export async function logoutWhenSaved(performLogout: () => void): Promise<void> {
  const [specs] = await Promise.allSettled([flushNow(), flushLibrariesNow()])
  const session = useWorkflowSessionStore.getState()
  const stillSaving = useSpecificationStore.getState().savingIds.size > 0
  if (specs.status === 'rejected' || stillSaving || session.hasUnsavedChanges()) {
    session.requestNavigation(performLogout)
    return
  }
  performLogout()
}
