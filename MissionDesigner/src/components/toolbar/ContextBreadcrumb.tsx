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

import { useMemo, useCallback } from 'react'
import { ChevronRight, Workflow, Cog, Server, Zap } from 'lucide-react'
import { useLibraryStore, useSpecIndex } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import type { EntityType, Library } from '@/types/library'

const entityIcons: Record<EntityType, React.ComponentType<{ className?: string }>> = {
  workflow: Workflow,
  step: Cog,
  environment: Server,
  action: Zap,
}

const entityLabels: Record<EntityType, string> = {
  workflow: 'Workflow',
  step: 'Step',
  environment: 'Environment',
  action: 'Action',
}

/**
 * Breadcrumb showing current context: Entity Type > Library > Sub-Library > Spec Hierarchy
 * For sub-workflows, shows full parent chain: Parent Workflow > Child Workflow > Grandchild...
 */
export function ContextBreadcrumb() {
  const activeEntityType = useLibraryStore((s) => s.activeEntityType)
  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)
  const libraries = useLibraryStore((s) => s.libraries)
  const childLibraries = useLibraryStore((s) => s.childLibraries)
  const specIndex = useSpecIndex()
  const setSelectedLibrary = useLibraryStore((s) => s.setSelectedLibrary)
  const setSelectedSpecification = useLibraryStore((s) => s.setSelectedSpecification)

  const handleLibraryClick = useCallback(
    (libId: string) => {
      setSelectedLibrary(libId)
    },
    [setSelectedLibrary],
  )

  const handleSpecClick = useCallback(
    (specId: string) => {
      setSelectedSpecification(specId, selectedLibraryId)
    },
    [setSelectedSpecification, selectedLibraryId],
  )

  const Icon = entityIcons[activeEntityType]
  const entityLabel = entityLabels[activeEntityType]

  // Find selected library (check both top-level and child libraries)
  const selectedLibrary = (() => {
    if (!selectedLibraryId) return null
    // Check top-level libraries first
    const topLevel = libraries.find((lib) => lib.id === selectedLibraryId)
    if (topLevel) return topLevel
    // Check child libraries
    for (const children of childLibraries.values()) {
      const child = children.find((lib) => lib.id === selectedLibraryId)
      if (child) return child
    }
    return null
  })()

  // Build the library hierarchy (parent > child)
  const libraryHierarchy: Library[] = []
  if (selectedLibrary) {
    // If this is a sub-library, find and add the parent first
    if (selectedLibrary.parentLibraryId) {
      const parent = libraries.find((lib) => lib.id === selectedLibrary.parentLibraryId)
      if (parent) {
        libraryHierarchy.push(parent)
      }
    }
    libraryHierarchy.push(selectedLibrary)
  }

  const allSpecs = useSpecificationStore((s) => s.specs)

  // Build the full specification hierarchy (root > parent > ... > current) via specificationStore
  const specificationHierarchy = useMemo((): Array<{ id: string; name: string }> => {
    if (!selectedSpecificationId) return []

    const spec = allSpecs.get(selectedSpecificationId)
    if (!spec) {
      // Fall back to libraryStore specIndex for specs not yet loaded in specificationStore
      const rootSpec = specIndex.get(selectedSpecificationId)?.spec
      if (rootSpec) return [{ id: rootSpec.id, name: rootSpec.name }]
      return []
    }

    // Walk up the parentSpecificationId chain to build the full ancestry
    const chain: Array<{ id: string; name: string }> = []
    const visited = new Set<string>()
    let current = spec
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      chain.unshift({ id: current.id, name: current.name })
      if (current.parentSpecificationId) {
        const parent = allSpecs.get(current.parentSpecificationId)
        if (!parent) break
        current = parent
      } else {
        break
      }
    }

    return chain
  }, [selectedSpecificationId, allSpecs, specIndex])

  return (
    <div className="flex items-center gap-1 text-sm text-slate-600">
      <Icon className="h-4 w-4 text-slate-500" />
      <span className="font-medium">{entityLabel}</span>

      {libraryHierarchy.map((lib, index) => (
        <span key={lib.id} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 text-slate-500" />
          <button
            type="button"
            onClick={() => handleLibraryClick(lib.id)}
            className={`hover:underline hover:text-blue-600 cursor-pointer ${index === libraryHierarchy.length - 1 && specificationHierarchy.length === 0 ? 'text-slate-700' : 'text-slate-500'}`}
          >
            {lib.name}
          </button>
        </span>
      ))}

      {specificationHierarchy.map((spec, index) => (
        <span key={spec.id} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 text-slate-500" />
          <button
            type="button"
            onClick={() => handleSpecClick(spec.id)}
            className={`hover:underline hover:text-blue-600 cursor-pointer ${index === specificationHierarchy.length - 1 ? 'font-medium text-slate-700' : 'text-slate-500'}`}
          >
            {spec.name}
          </button>
        </span>
      ))}

      {libraryHierarchy.length === 0 && specificationHierarchy.length === 0 && (
        <>
          <ChevronRight className="h-3 w-3 text-slate-500" />
          <span className="text-slate-500 italic">No selection</span>
        </>
      )}
    </div>
  )
}
