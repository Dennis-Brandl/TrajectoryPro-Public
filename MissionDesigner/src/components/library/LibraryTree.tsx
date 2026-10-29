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

import { useState, useEffect, useCallback, memo } from 'react'
import { FolderPlus } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useLibraryStore, useFilteredLibraries } from '@/stores/libraryStore'
import { LibraryItem } from './LibraryItem'
import type { EntityType } from '@/types/library'

interface LibraryTreeProps {
  onImportRuntimePackage?: (libraryId: string, file: File) => Promise<void>
  onImportSingleSpec?: (libraryId: string, file: File) => Promise<void>
  onImportBatchml?: (libraryId: string, file: File) => Promise<void>
  onExportPDF?: (specId: string, libraryId: string) => void
  onExportPackage?: (specId: string, libraryId: string) => void
}

/**
 * Tree view displaying libraries filtered by entity type and search query.
 * Lazy loads specifications when a library is expanded.
 */
export const LibraryTree = memo(function LibraryTree({
  onImportRuntimePackage,
  onImportSingleSpec,
  onImportBatchml,
  onExportPDF,
  onExportPackage,
}: LibraryTreeProps) {
  const filteredLibraries = useFilteredLibraries()
  const {
    specifications,
    specTrees,
    selectedLibraryId,
    selectedSpecificationId,
    setSelectedLibrary,
    fetchSpecifications,
    fetchSpecTree,
    activeEntityType,
    searchQuery,
  } = useLibraryStore(
    useShallow((s) => ({
      specifications: s.specifications,
      specTrees: s.specTrees,
      selectedLibraryId: s.selectedLibraryId,
      selectedSpecificationId: s.selectedSpecificationId,
      setSelectedLibrary: s.setSelectedLibrary,
      fetchSpecifications: s.fetchSpecifications,
      fetchSpecTree: s.fetchSpecTree,
      activeEntityType: s.activeEntityType,
      searchQuery: s.searchQuery,
    })),
  )

  // Track which libraries are expanded, per entity type tab. Held in state
  // (not a ref) because the active tab's set is read during render; every
  // update replaces that tab's Set immutably. The active tab's set IS the
  // expanded-ids view — nothing to sync when the tab switches.
  const [expandedByType, setExpandedByType] = useState<Record<EntityType, Set<string>>>(() => ({
    workflow: new Set(),
    step: new Set(),
    environment: new Set(),
    action: new Set(),
  }))
  const expandedIds = expandedByType[activeEntityType]

  // Replace the active tab's set with `mutate` applied to a copy of it.
  const updateExpanded = useCallback(
    (mutate: (next: Set<string>) => void) => {
      setExpandedByType((prev) => {
        const next = new Set(prev[activeEntityType])
        mutate(next)
        return { ...prev, [activeEntityType]: next }
      })
    },
    [activeEntityType],
  )

  // Auto-expand libraries whose specifications match the search query. The
  // expansion is persisted in the tab's set, so it survives clearing the
  // search. Adjust-state-during-render (react.dev "storing information from
  // previous renders") rather than an effect.
  const [searchSeen, setSearchSeen] = useState<{
    searchQuery: string
    filteredLibraries: typeof filteredLibraries
    specifications: typeof specifications
  } | null>(null)
  if (
    searchSeen?.searchQuery !== searchQuery ||
    searchSeen?.filteredLibraries !== filteredLibraries ||
    searchSeen?.specifications !== specifications
  ) {
    setSearchSeen({ searchQuery, filteredLibraries, specifications })
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const toExpand = filteredLibraries
        .filter((lib) => (specifications.get(lib.id) || []).some((spec) => spec.name.toLowerCase().includes(query)))
        .map((lib) => lib.id)
      if (toExpand.some((id) => !expandedIds.has(id))) {
        updateExpanded((next) => toExpand.forEach((id) => next.add(id)))
      }
    }
  }

  // Auto-expand the library of the selected specification (e.g. picked from
  // the welcome screen). Same adjust-during-render pattern; the fetch that
  // may be needed for a not-yet-loaded library stays in the effect below.
  const selectionKey =
    selectedLibraryId && selectedSpecificationId ? `${selectedLibraryId}/${selectedSpecificationId}` : null
  const [selectionSeen, setSelectionSeen] = useState<string | null>(null)
  if (selectionKey !== selectionSeen) {
    setSelectionSeen(selectionKey)
    if (selectedLibraryId && selectedSpecificationId && !expandedIds.has(selectedLibraryId)) {
      updateExpanded((next) => next.add(selectedLibraryId))
    }
  }

  // Load the selected specification's library once per selection change, if
  // it hasn't been loaded yet (deliberately not re-run on every store update).
  useEffect(() => {
    if (selectedLibraryId && selectedSpecificationId && !specifications.has(selectedLibraryId)) {
      fetchSpecifications(selectedLibraryId)
      void fetchSpecTree(selectedLibraryId)
    }
  }, [selectedSpecificationId, selectedLibraryId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = useCallback(
    (libraryId: string) => {
      const expanding = !expandedIds.has(libraryId)
      updateExpanded((next) => {
        if (expanding) next.add(libraryId)
        else next.delete(libraryId)
      })
      // Lazy load specifications if not already loaded
      if (expanding && !specifications.has(libraryId)) {
        fetchSpecifications(libraryId)
        void fetchSpecTree(libraryId)
      }
    },
    [expandedIds, updateExpanded, specifications, fetchSpecifications, fetchSpecTree],
  )

  const handleExpand = useCallback(
    (libraryId: string) => {
      updateExpanded((next) => next.add(libraryId))
      // Always fetch to get latest specifications
      fetchSpecifications(libraryId)
      void fetchSpecTree(libraryId)
    },
    [updateExpanded, fetchSpecifications, fetchSpecTree],
  )

  const handleSelect = useCallback(
    (libraryId: string) => {
      setSelectedLibrary(libraryId)
    },
    [setSelectedLibrary],
  )

  const handleChildToggle = useCallback(
    (childId: string) => {
      const expanding = !expandedIds.has(childId)
      updateExpanded((next) => {
        if (expanding) next.add(childId)
        else next.delete(childId)
      })
      if (expanding && !specifications.has(childId)) {
        fetchSpecifications(childId)
        void fetchSpecTree(childId)
      }
    },
    [expandedIds, updateExpanded, specifications, fetchSpecifications, fetchSpecTree],
  )

  const handleChildExpand = useCallback(
    (childId: string) => {
      updateExpanded((next) => next.add(childId))
      fetchSpecifications(childId)
      void fetchSpecTree(childId)
    },
    [updateExpanded, fetchSpecifications, fetchSpecTree],
  )

  if (filteredLibraries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <FolderPlus className="h-10 w-10 text-slate-300 mb-3" />
        <p className="text-sm text-slate-500">No libraries found</p>
        <p className="text-xs text-slate-400 mt-1">Create your first library using the button below</p>
      </div>
    )
  }

  // Filter specifications based on search query
  const getFilteredSpecs = (libraryId: string) => {
    const specs = specifications.get(libraryId) || []
    if (!searchQuery) return specs
    const query = searchQuery.toLowerCase()
    return specs.filter((spec) => spec.name.toLowerCase().includes(query))
  }

  return (
    <div className="space-y-0.5" role="tree">
      {filteredLibraries.map((library) => (
        <div key={library.id} className="group">
          <LibraryItem
            library={library}
            isExpanded={expandedIds.has(library.id)}
            isSelected={selectedLibraryId === library.id}
            specifications={searchQuery ? getFilteredSpecs(library.id) : specifications.get(library.id) || []}
            specTree={specTrees.get(library.id)}
            onToggle={() => handleToggle(library.id)}
            onSelect={() => handleSelect(library.id)}
            onExpand={() => handleExpand(library.id)}
            searchQuery={searchQuery}
            onImportRuntimePackage={onImportRuntimePackage}
            onImportSingleSpec={onImportSingleSpec}
            onImportBatchml={onImportBatchml}
            childExpandedIds={expandedIds}
            onChildToggle={handleChildToggle}
            onChildExpand={handleChildExpand}
            onExportPDF={onExportPDF}
            onExportPackage={onExportPackage}
          />
        </div>
      ))}
    </div>
  )
})
