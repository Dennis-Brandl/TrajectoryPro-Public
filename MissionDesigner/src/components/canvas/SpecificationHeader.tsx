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

import { useEffect, useState, useMemo } from 'react'
import { Server, X } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import type { Specification } from '@/types/library'
import { OutdatedActionsChip } from './OutdatedActionsChip'

interface EnvironmentSpecWithLibrary {
  spec: Specification
  libraryName: string
}

/**
 * Header component for workflow/step specifications showing environment associations.
 * Allows selecting specific environment specifications (not just libraries).
 * Displays above the canvas when editing a specification.
 */
export function SpecificationHeader() {
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)
  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)
  const libraries = useLibraryStore((s) => s.libraries)
  const specifications = useLibraryStore((s) => s.specifications)
  const fetchSpecifications = useLibraryStore((s) => s.fetchSpecifications)

  // Store environment specification IDs (not library IDs)
  const [environmentSpecIds, setEnvironmentSpecIds] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)

  // Get the selected specification
  const selectedSpecification = useMemo(() => {
    if (!selectedSpecificationId || !selectedLibraryId) return null
    const libSpecs = specifications.get(selectedLibraryId)
    return libSpecs?.find((s) => s.id === selectedSpecificationId) || null
  }, [selectedSpecificationId, selectedLibraryId, specifications])

  // Get all environment libraries
  const environmentLibraries = useMemo(() => libraries.filter((lib) => lib.entityType === 'environment'), [libraries])

  // Fetch specifications for all environment libraries (parallel)
  useEffect(() => {
    const toFetch = environmentLibraries.filter((lib) => !specifications.has(lib.id))
    if (toFetch.length > 0) {
      Promise.all(toFetch.map((lib) => fetchSpecifications(lib.id))).catch((err) =>
        console.error('Failed to fetch environment specs:', err),
      )
    }
  }, [environmentLibraries, specifications, fetchSpecifications])

  // Build list of all environment specs with their library names
  const allEnvironmentSpecs = useMemo(() => {
    const result: EnvironmentSpecWithLibrary[] = []
    for (const lib of environmentLibraries) {
      const libSpecs = specifications.get(lib.id) || []
      for (const spec of libSpecs) {
        result.push({ spec, libraryName: lib.name })
      }
    }
    return result
  }, [environmentLibraries, specifications])

  // Load specification's environment spec IDs when selection changes
  // Support both old format (environmentLibraryIds) and new format (environmentSpecIds)
  useEffect(() => {
    if (selectedSpecification) {
      const specData = selectedSpecification.data as { environmentSpecIds?: string[] } | undefined
      // Prefer new format, fall back to empty array (not old library IDs)
      setEnvironmentSpecIds(specData?.environmentSpecIds || selectedSpecification.environmentLibraryIds || [])
    }
  }, [selectedSpecification])

  // Get available environment specs (not yet selected)
  const availableEnvironmentSpecs = useMemo(
    () => allEnvironmentSpecs.filter((e) => !environmentSpecIds.includes(e.spec.id)),
    [allEnvironmentSpecs, environmentSpecIds],
  )

  // Group available specs by library for the dropdown
  const groupedAvailableSpecs = useMemo(() => {
    const groups = new Map<string, EnvironmentSpecWithLibrary[]>()
    for (const envSpec of availableEnvironmentSpecs) {
      const existing = groups.get(envSpec.libraryName) || []
      existing.push(envSpec)
      groups.set(envSpec.libraryName, existing)
    }
    return groups
  }, [availableEnvironmentSpecs])

  const handleAddEnvironment = async (envSpecId: string) => {
    if (!envSpecId || !selectedSpecificationId) return
    if (environmentSpecIds.includes(envSpecId)) return

    const newIds = [...environmentSpecIds, envSpecId]
    setEnvironmentSpecIds(newIds)
    setIsSaving(true)

    try {
      // Get existing spec data to preserve other properties
      const existingData = (selectedSpecification?.data || {}) as Record<string, unknown>
      useSpecificationStore.getState().updateInMemory(selectedSpecificationId, {
        data: { ...existingData, environmentSpecIds: newIds },
      })
    } catch (error) {
      // Revert on error
      setEnvironmentSpecIds(environmentSpecIds)
      console.error('Failed to add environment:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleRemoveEnvironment = async (envSpecId: string) => {
    if (!selectedSpecificationId) return

    const newIds = environmentSpecIds.filter((id) => id !== envSpecId)
    setEnvironmentSpecIds(newIds)
    setIsSaving(true)

    try {
      // Get existing spec data to preserve other properties
      const existingData = (selectedSpecification?.data || {}) as Record<string, unknown>
      useSpecificationStore.getState().updateInMemory(selectedSpecificationId, {
        data: { ...existingData, environmentSpecIds: newIds },
      })
    } catch (error) {
      // Revert on error
      setEnvironmentSpecIds(environmentSpecIds)
      console.error('Failed to remove environment:', error)
    } finally {
      setIsSaving(false)
    }
  }

  // Find environment spec by ID
  const findEnvSpec = (specId: string) => {
    return allEnvironmentSpecs.find((e) => e.spec.id === specId)
  }

  if (!selectedSpecification) return null

  // Hide the header entirely when there are no environments to display or add
  if (environmentSpecIds.length === 0 && availableEnvironmentSpecs.length === 0) return null

  return (
    <div className="h-10 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center px-4 gap-4">
      {/* Environment specifications section */}
      <div className="flex items-center gap-2 flex-1">
        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">Environments:</span>

        {/* Selected environment tags */}
        {environmentSpecIds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {environmentSpecIds.map((envSpecId) => {
              const envSpec = findEnvSpec(envSpecId)
              return (
                <div
                  key={envSpecId}
                  className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 rounded text-xs"
                >
                  <Server className="h-3 w-3" />
                  <span>{envSpec?.spec.name || 'Unknown'}</span>
                  {envSpec && <span className="text-emerald-600 text-[10px]">({envSpec.libraryName})</span>}
                  <button
                    type="button"
                    onClick={() => handleRemoveEnvironment(envSpecId)}
                    className="ml-0.5 hover:text-emerald-600"
                    disabled={isSaving}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Add environment dropdown - grouped by library */}
        {groupedAvailableSpecs.size > 0 ? (
          <Select onValueChange={handleAddEnvironment} value="" disabled={isSaving}>
            <SelectTrigger className="h-7 w-56 text-xs">
              <SelectValue placeholder="Add environment..." />
            </SelectTrigger>
            <SelectContent>
              {Array.from(groupedAvailableSpecs.entries()).map(([libraryName, specs]) => (
                <SelectGroup key={libraryName}>
                  <SelectLabel className="text-xs text-slate-500 dark:text-slate-400">{libraryName}</SelectLabel>
                  {specs.map((envSpec) => (
                    <SelectItem key={envSpec.spec.id} value={envSpec.spec.id}>
                      <div className="flex items-center gap-2">
                        <Server className="h-3 w-3 text-emerald-600" />
                        <span className="text-xs">{envSpec.spec.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        ) : environmentSpecIds.length === 0 ? (
          <span className="text-xs text-slate-500 dark:text-slate-400 italic">No environments available</span>
        ) : null}

        {isSaving && <span className="text-xs text-slate-500 dark:text-slate-400">Saving...</span>}

        <OutdatedActionsChip />
      </div>
    </div>
  )
}
