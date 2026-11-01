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

import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Library, Specification, EntityType, SpecificationState } from '@/types/library'
import { useSpecificationStore } from './specificationStore'
import { api } from './specificationStore/apiClient'
import { flushNow } from '@/stores/specificationStore/saveScheduler'
import type { Library as SpecLibrary, Specification as SpecSpec } from './specificationStore/types'
import type { SpecTreeNode } from '@/components/library/SpecTreeItem'

/**
 * In-flight `fetchSpecifications` calls, keyed by libraryId. Several components
 * (SpecificationHeader, OutdatedActionsChip, ActionSelector, …) fetch every
 * library whose specs aren't cached yet and re-run whenever `specifications`
 * changes, so concurrent calls for one library must share a single request —
 * otherwise each completion re-fetches all the libraries still loading and N
 * libraries cost O(N²) requests, which tripped the API rate limit on workflow open.
 */
const inflightSpecFetches = new Map<string, Promise<void>>()

/** Step specification with its containing library */
export interface StepSpecWithLibrary {
  spec: Specification
  library: Library
}

interface LibraryState {
  // Data
  libraries: Library[]
  specifications: Map<string, Specification[]> // keyed by libraryId
  childLibraries: Map<string, Library[]> // keyed by parent libraryId
  specTrees: Map<string, SpecTreeNode[]> // keyed by libraryId

  // UI state
  activeEntityType: EntityType
  searchQuery: string
  selectedLibraryId: string | null
  selectedSpecificationId: string | null
  isLoading: boolean
  error: string | null
  stateFilter: SpecificationState | 'all'
  selectedTeamId: string | null

  // Actions
  setActiveEntityType: (type: EntityType) => void
  setSearchQuery: (query: string) => void
  setSelectedLibrary: (id: string | null) => void
  setSelectedSpecification: (id: string | null, libraryId?: string | null) => void
  setStateFilter: (filter: SpecificationState | 'all') => void
  setSelectedTeamId: (teamId: string | null) => void
  clearError: () => void

  // API actions
  fetchLibraries: (entityType?: string) => Promise<void>
  fetchSpecifications: (libraryId: string) => Promise<void>
  fetchSpecTree: (libraryId: string) => Promise<void>

  /** Update a spec in memory only (no server call). Used by save-to-memory during editing sessions. */
  updateSpecificationInMemory: (id: string, data: { data?: Record<string, unknown> }) => void

  // New version helper — refetch spec tree and select the new version
  applyNewVersion: (newSpec: Specification) => Promise<void>

  // Move helper — refresh both libraries after a move and select the moved element
  applyMove: (args: {
    libraryId: string
    specId: string
    fromLibraryId: string
    movedRootIds?: string[]
    teamId?: string
    librariesCreated?: boolean
    touchedLibraryIds?: string[]
  }) => Promise<void>

  applyCopy: (args: {
    libraryId: string
    copiedRootIds: string[]
    librariesCreated?: boolean
    touchedLibraryIds?: string[]
  }) => Promise<void>

  // State change helper — refetch both spec caches so the sidebar reflects the new state
  applyStateChange: (updatedSpec: Specification) => Promise<void>

  // Sub-workflow helper actions
  getStepSpecifications: () => StepSpecWithLibrary[]
  validateStepReference: (specId: string) => boolean
}

/**
 * Zustand store for library and specification management.
 *
 * Manages:
 * - Libraries organized by entity type (workflow, step, environment, action)
 * - Specifications within each library
 * - Search and filter state for the sidebar UI
 *
 * Usage:
 * ```typescript
 * const libraries = useLibraryStore((state) => state.libraries);
 * const { fetchLibraries, createLibrary } = useLibraryStore.getState();
 * ```
 */
export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      // Initial state
      libraries: [],
      specifications: new Map(),
      childLibraries: new Map(),
      specTrees: new Map(),
      activeEntityType: 'workflow',
      searchQuery: '',
      selectedLibraryId: null,
      selectedSpecificationId: null,
      isLoading: false,
      error: null,
      stateFilter: 'all',
      selectedTeamId: null,

      // UI actions
      setActiveEntityType: (type) => {
        set({
          activeEntityType: type,
          selectedLibraryId: null,
          selectedSpecificationId: null,
        })
      },
      setSearchQuery: (query) => set({ searchQuery: query }),
      setStateFilter: (filter) => set({ stateFilter: filter }),
      setSelectedTeamId: (teamId) => {
        set({ selectedTeamId: teamId, selectedLibraryId: null, selectedSpecificationId: null })
      },
      setSelectedLibrary: (id) => {
        set({ selectedLibraryId: id, selectedSpecificationId: null })
      },
      setSelectedSpecification: (id, libraryId) => {
        // Flush any pending saves before switching specs
        // A failed save is reported by the global SaveErrorToast.
        void flushNow().catch(() => {})
        set((state) => ({
          selectedSpecificationId: id,
          selectedLibraryId: libraryId !== undefined ? libraryId : state.selectedLibraryId,
        }))
      },
      clearError: () => set({ error: null }),

      // API actions — delegates to specificationStore (back-compat shim)
      fetchLibraries: async (entityType?: string) => {
        // Only show loading spinner on initial load, not refreshes
        const hasData = get().libraries.length > 0
        if (!hasData) set({ isLoading: true, error: null })
        else set({ error: null })
        try {
          // Only fetch from server if specificationStore hasn't loaded yet.
          // After boot, libraries are already in memory — just sync the view.
          let specStore = useSpecificationStore.getState()
          if (!specStore.isLibrariesLoaded) {
            await specStore.loadLibraries()
            specStore = useSpecificationStore.getState()
          }
          const allLibs = Array.from(specStore.libraries.values())
          const filtered = entityType ? allLibs.filter((lib) => lib.entityType === entityType) : allLibs
          // Map specificationStore.Library → @/types/library.Library
          const toOldLib = (lib: SpecLibrary): Library => ({
            id: lib.id,
            teamId: lib.teamId,
            parentLibraryId: lib.parentLibraryId,
            name: lib.name,
            entityType: lib.entityType as EntityType,
            description: lib.description,
            author: lib.author ?? null,
            changeHistory: lib.changeHistory ?? null,
            version: lib.version,
            createdAt: lib.createdAt,
            updatedAt: lib.updatedAt,
            environmentLibraryIds: lib.environmentLibraryIds ?? null,
          })
          // Build childLibraries keyed by parentLibraryId
          const childLibraries = new Map<string, Library[]>()
          for (const lib of allLibs) {
            if (lib.parentLibraryId !== null) {
              const siblings = childLibraries.get(lib.parentLibraryId) ?? []
              siblings.push(toOldLib(lib))
              childLibraries.set(lib.parentLibraryId, siblings)
            }
          }
          set({
            libraries: filtered.map(toOldLib),
            childLibraries,
            isLoading: false,
          })
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Unknown error',
            isLoading: false,
          })
        }
      },

      fetchSpecifications: (libraryId: string) => {
        // Share one request among concurrent callers (see inflightSpecFetches).
        const inflight = inflightSpecFetches.get(libraryId)
        if (inflight) return inflight
        const run = (async () => {
          try {
            // On cold boot the spec cache is empty; pull root specs for this
            // library into specificationStore before reading, otherwise the
            // sidebar tree renders an empty group even though the server has
            // specs to show.
            await useSpecificationStore.getState().ensureLibrarySpecs(libraryId)
            const specStore = useSpecificationStore.getState()
            // Map specificationStore.Specification → @/types/library.Specification
            const toOldSpec = (s: SpecSpec): Specification => ({
              id: s.id,
              libraryId: s.libraryId,
              name: s.name,
              description: s.description,
              typeName: s.typeName,
              version: s.version,
              state: s.state as Specification['state'],
              data: s.data,
              history: s.history,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
              dataSchemaVersion: s.dataSchemaVersion,
            })
            const allSpecs = Array.from(specStore.specs.values()).filter(
              (s) => s.libraryId === libraryId && !specStore.pendingDeletes.has(s.id),
            )
            const newSpecs = new Map(get().specifications)
            newSpecs.set(libraryId, allSpecs.map(toOldSpec))
            set({ specifications: newSpecs })
          } catch (error) {
            set({ error: error instanceof Error ? error.message : 'Failed to fetch specifications' })
          } finally {
            inflightSpecFetches.delete(libraryId)
          }
        })()
        inflightSpecFetches.set(libraryId, run)
        return run
      },

      fetchSpecTree: async (libraryId: string) => {
        try {
          const response = await api.getLibraryTree(libraryId)
          set((s) => {
            const next = new Map(s.specTrees)
            next.set(libraryId, response.roots as SpecTreeNode[])
            return { specTrees: next }
          })
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to fetch spec tree' })
        }
      },

      updateSpecificationInMemory: (id, data) => {
        set((state) => {
          const newSpecs = new Map(state.specifications)
          for (const [libId, specs] of newSpecs.entries()) {
            const idx = specs.findIndex((s) => s.id === id)
            if (idx !== -1) {
              const newLibSpecs = [...specs]
              newLibSpecs[idx] = {
                ...newLibSpecs[idx],
                data: data.data ?? newLibSpecs[idx].data,
              }
              newSpecs.set(libId, newLibSpecs)
              break
            }
          }
          return { specifications: newSpecs }
        })
      },

      applyNewVersion: async (newSpec) => {
        await Promise.all([get().fetchSpecifications(newSpec.libraryId), get().fetchSpecTree(newSpec.libraryId)])
        get().setSelectedSpecification(newSpec.id, newSpec.libraryId)
      },

      applyMove: async ({
        libraryId,
        specId,
        fromLibraryId,
        movedRootIds,
        teamId,
        librariesCreated,
        touchedLibraryIds,
      }) => {
        const specStore = () => useSpecificationStore.getState()
        const roots = movedRootIds ?? [specId]
        // An edit made while the move ran must reach the server before anything is reloaded over it.
        await flushNow().catch(() => {})
        // The open spec's cached copy must learn its new library, or a later save would write it
        // back to the old one.
        specStore().applyServerLibrary(roots, libraryId)

        // The server rewrote the moved trees (and, for same-team moves and copies, references in
        // other specs). A cached copy keeps stale `data`, and editing it would autosave that stale
        // data back, so force-reload every cached spec that could have changed. Never-cached roots
        // are pulled in too, or the destination's cached list would lack them.
        const { specs, dirtyIds, libraries } = specStore()
        const movedTree = new Set(roots)
        for (const sp of specs.values()) if (roots.includes(sp.rootSpecificationId)) movedTree.add(sp.id)
        const sourceName = libraries.get(fromLibraryId)?.name ?? ''
        const needles = [...movedTree, ...(sourceName ? [sourceName] : [])]
        const reload = new Set<string>(roots)
        for (const id of movedTree) if (specs.has(id)) reload.add(id)
        for (const sp of specs.values()) {
          if (reload.has(sp.id) || dirtyIds.has(sp.id)) continue
          const text = JSON.stringify(sp.data)
          if (needles.some((needle) => text.includes(needle))) reload.add(sp.id)
        }
        await specStore()
          .loadBulk([...reload])
          .catch(() => {})
        if (librariesCreated) {
          // Move-to-team may have created libraries; loadLibraries only runs once at boot, so force it.
          await useSpecificationStore.getState().loadLibraries()
          await get().fetchLibraries()
        }
        // Destination libraries that received dependency copies need a refresh too.
        const refresh = [...new Set([fromLibraryId, libraryId, ...(touchedLibraryIds ?? [])])]
        await Promise.all(refresh.flatMap((id) => [get().fetchSpecifications(id), get().fetchSpecTree(id)]))
        if (teamId) get().setSelectedTeamId(teamId)
        get().setSelectedSpecification(specId, libraryId)
      },

      applyCopy: async ({ libraryId, copiedRootIds, librariesCreated, touchedLibraryIds }) => {
        // Nothing the user has open changed. Only the destinations gain rows; the copies must be
        // pulled in, or the destination's cached list would lack them.
        await useSpecificationStore
          .getState()
          .loadBulk(copiedRootIds)
          .catch(() => {})
        if (librariesCreated) {
          await useSpecificationStore.getState().loadLibraries()
          await get().fetchLibraries()
        }
        const refresh = [...new Set([libraryId, ...(touchedLibraryIds ?? [])])]
        await Promise.all(refresh.flatMap((id) => [get().fetchSpecifications(id), get().fetchSpecTree(id)]))
      },

      applyStateChange: async (updatedSpec) => {
        // The open spec's cached copy must learn the new state too: every
        // specificationStore change re-syncs libraryStore.specifications from
        // it, so a stale copy would put the old state back on screen.
        useSpecificationStore
          .getState()
          .applyServerState(updatedSpec.id, { state: updatedSpec.state, history: updatedSpec.history })
        await Promise.all([
          get().fetchSpecifications(updatedSpec.libraryId),
          get().fetchSpecTree(updatedSpec.libraryId),
        ])
      },

      // Get all step specifications across step libraries
      getStepSpecifications: () => {
        const { libraries, specifications, childLibraries } = get()
        const result: StepSpecWithLibrary[] = []

        // Helper to collect specs from a library and its children
        const collectSpecs = (library: Library) => {
          const libSpecs = specifications.get(library.id) || []
          for (const spec of libSpecs) {
            result.push({ spec, library })
          }
          // Recursively collect from child libraries
          const children = childLibraries.get(library.id) || []
          for (const child of children) {
            collectSpecs(child)
          }
        }

        // Find all top-level step libraries
        const stepLibraries = libraries.filter((lib) => lib.entityType === 'step' && !lib.parentLibraryId)

        for (const lib of stepLibraries) {
          collectSpecs(lib)
        }

        return result
      },

      // Validate that a referenced step spec exists
      validateStepReference: (specId: string) => {
        const { specifications } = get()
        for (const specs of specifications.values()) {
          if (specs.some((s) => s.id === specId)) {
            return true
          }
        }
        return false
      },
    }),
    {
      name: 'library-ui-state',
      storage: {
        getItem: (name) => {
          const str = sessionStorage.getItem(name)
          return str ? JSON.parse(str) : null
        },
        setItem: (name, value) => {
          sessionStorage.setItem(name, JSON.stringify(value))
        },
        removeItem: (name) => sessionStorage.removeItem(name),
      },
      partialize: (state) =>
        ({
          activeEntityType: state.activeEntityType,
          selectedLibraryId: state.selectedLibraryId,
          selectedSpecificationId: state.selectedSpecificationId,
          stateFilter: state.stateFilter,
          selectedTeamId: state.selectedTeamId,
        }) as LibraryState,
    },
  ),
)

// Keep libraryStore.specifications in sync with specificationStore.specs.
// The sidebar and tree read from libraryStore.specifications; specs mutate in
// specificationStore (renames, deletes, creates, data edits). Without this
// subscription, renames don't reach the tree and deletes/creates require an
// explicit fetchSpecifications call at every site that mutates.
useSpecificationStore.subscribe((state, prevState) => {
  // We also need to react to unsavedNewIds transitions (create → saved) to
  // refresh the sidebar spec tree after a successful batchSave — see the
  // saveConfirmedLibs block below.
  if (
    state.specs === prevState.specs &&
    state.pendingDeletes === prevState.pendingDeletes &&
    state.unsavedNewIds === prevState.unsavedNewIds
  )
    return
  const byLibrary = new Map<string, Specification[]>()
  const toOldSpec = (s: SpecSpec): Specification => ({
    id: s.id,
    libraryId: s.libraryId,
    name: s.name,
    description: s.description,
    typeName: s.typeName,
    version: s.version,
    state: s.state as Specification['state'],
    data: s.data,
    history: s.history,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    dataSchemaVersion: s.dataSchemaVersion,
  })
  for (const spec of state.specs.values()) {
    if (state.pendingDeletes.has(spec.id)) continue
    const list = byLibrary.get(spec.libraryId) ?? []
    list.push(toOldSpec(spec))
    byLibrary.set(spec.libraryId, list)
  }
  // Preserve empty-library entries that may have been seeded elsewhere.
  useLibraryStore.setState((s) => {
    const next = new Map(s.specifications)
    for (const [libId, specs] of byLibrary) next.set(libId, specs)
    // Drop library entries for libraries that no longer have any specs in specStore
    // (otherwise deleted-last-spec entries would linger).
    for (const libId of next.keys()) {
      if (!byLibrary.has(libId)) next.set(libId, [])
    }

    // The sidebar's hierarchical tree is a separate cache (specTrees) populated
    // from /api/v2/libraries/:id/tree. Mutable per-spec fields (version, state,
    // name) only flow into it on the next server fetch — so an in-memory
    // version bump or rename leaves the tree stale even though specifications
    // already shows the new value. Patch matching tree nodes in place so the
    // hierarchy stays in sync with the canvas badge and properties panel.
    const specsById = new Map<string, SpecSpec>()
    for (const spec of state.specs.values()) {
      if (state.pendingDeletes.has(spec.id)) continue
      specsById.set(spec.id, spec)
    }
    let treesChanged = false
    const nextTrees = new Map<string, SpecTreeNode[]>()
    for (const [libId, tree] of s.specTrees) {
      const patched = patchTreeNodes(tree, specsById)
      if (patched !== tree) treesChanged = true
      nextTrees.set(libId, patched)
    }
    return treesChanged ? { specifications: next, specTrees: nextTrees } : { specifications: next }
  })

  // Refresh the hierarchical specTrees cache for any library whose spec
  // membership actually moved from unsavedNewIds → saved (or from specs →
  // pendingDeletes). We trigger the refetch ONLY on the server-confirmation
  // transition — not on the in-memory create — so the /tree fetch always
  // returns a tree that already includes the just-saved child. Detecting the
  // transition: an id that used to be in prevState.unsavedNewIds but is no
  // longer in state.unsavedNewIds AND is still in state.specs indicates a
  // successful create-save. An id moving into state.pendingDeletes, or a
  // pendingDeletes entry being cleared + the spec gone, indicates a
  // delete-save.
  const saveConfirmedLibs = new Set<string>()
  for (const id of prevState.unsavedNewIds) {
    if (!state.unsavedNewIds.has(id)) {
      const spec = state.specs.get(id)
      if (spec) saveConfirmedLibs.add(spec.libraryId)
    }
  }
  for (const id of prevState.specs.keys()) {
    if (!state.specs.has(id)) {
      const spec = prevState.specs.get(id)
      if (spec) saveConfirmedLibs.add(spec.libraryId)
    }
  }
  if (saveConfirmedLibs.size > 0) {
    const activeTrees = useLibraryStore.getState().specTrees
    for (const libId of saveConfirmedLibs) {
      if (activeTrees.has(libId)) {
        void useLibraryStore.getState().fetchSpecTree(libId)
      }
    }
  }
})

/**
 * Walk a spec tree and replace each node's `version`, `state`, and `name`
 * with the corresponding fields from `specsById` if a match exists. Returns
 * the input tree unchanged when no node needs patching, so reference equality
 * upstream is preserved.
 */
function patchTreeNodes(nodes: SpecTreeNode[], specsById: Map<string, SpecSpec>): SpecTreeNode[] {
  let changed = false
  const patched = nodes.map((node) => {
    const spec = specsById.get(node.id)
    const patchedChildren = patchTreeNodes(node.children, specsById)
    const childrenChanged = patchedChildren !== node.children
    const versionChanged = spec ? spec.version !== node.version : false
    const stateChanged = spec ? spec.state !== node.state : false
    const nameChanged = spec ? spec.name !== node.name : false
    if (!childrenChanged && !versionChanged && !stateChanged && !nameChanged) return node
    changed = true
    return {
      ...node,
      ...(spec
        ? {
            name: spec.name,
            version: spec.version,
            state: spec.state,
          }
        : {}),
      children: patchedChildren,
    }
  })
  return changed ? patched : nodes
}

/**
 * Selector for filtered libraries based on active entity type and search query.
 * Only returns top-level libraries (those without a parent).
 * Searches both library names and specification names.
 * Use with useLibraryStore for memoized access.
 */
export function useFilteredLibraries() {
  const libraries = useLibraryStore((s) => s.libraries)
  const childLibraries = useLibraryStore((s) => s.childLibraries)
  const specifications = useLibraryStore((s) => s.specifications)
  const activeEntityType = useLibraryStore((s) => s.activeEntityType)
  const searchQuery = useLibraryStore((s) => s.searchQuery)
  const selectedTeamId = useLibraryStore((s) => s.selectedTeamId)

  return useMemo(() => {
    // Fast path: no search query — simple type + parent filter
    if (!searchQuery) {
      return libraries.filter(
        (lib) =>
          !lib.parentLibraryId &&
          lib.entityType === activeEntityType &&
          (selectedTeamId === null || lib.teamId === selectedTeamId),
      )
    }

    const query = searchQuery.toLowerCase()

    // Single pass: collect library IDs that have matching specs or child specs
    const matchingLibIds = new Set<string>()
    for (const [libId, specs] of specifications.entries()) {
      if (specs.some((spec) => spec.name.toLowerCase().includes(query))) {
        matchingLibIds.add(libId)
      }
    }

    // Also check child library names and map matches to parent
    for (const [parentId, children] of childLibraries.entries()) {
      for (const child of children) {
        if (child.name.toLowerCase().includes(query) || matchingLibIds.has(child.id)) {
          matchingLibIds.add(parentId)
        }
      }
    }

    return libraries.filter((lib) => {
      if (lib.parentLibraryId) return false
      if (lib.entityType !== activeEntityType) return false
      if (selectedTeamId !== null && lib.teamId !== selectedTeamId) return false
      if (lib.name.toLowerCase().includes(query)) return true
      return matchingLibIds.has(lib.id)
    })
  }, [libraries, childLibraries, specifications, activeEntityType, searchQuery, selectedTeamId])
}

/** Spec lookup result from the index */
export interface SpecIndexEntry {
  spec: Specification
  libraryId: string
}

/**
 * Memoized O(1) spec-by-ID index derived from the specifications Map.
 * Rebuilds only when specifications change. Use instead of linear scans.
 */
export function useSpecIndex(): Map<string, SpecIndexEntry> {
  const specifications = useLibraryStore((s) => s.specifications)
  return useMemo(() => {
    const index = new Map<string, SpecIndexEntry>()
    for (const [libId, specs] of specifications.entries()) {
      for (const spec of specs) {
        index.set(spec.id, { spec, libraryId: libId })
      }
    }
    return index
  }, [specifications])
}
