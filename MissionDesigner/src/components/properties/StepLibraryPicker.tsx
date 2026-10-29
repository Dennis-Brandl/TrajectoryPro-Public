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

import { useEffect, useMemo, useState, useCallback } from 'react'
import { ChevronRight, ChevronDown, FileText, FolderOpen, Search, Layers } from 'lucide-react'
import { Input } from '@mission/ui'
import { ScrollArea } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import type { Library, Specification } from '@/types/library'
import type { ParameterSpec } from '@/types/nodes'
import { cn } from '@mission/ui'

interface StepLibraryPickerProps {
  /** Called when a step specification is selected */
  onSelect: (spec: Specification, library: Library) => void
  /** Currently selected spec ID (for highlighting) */
  selectedSpecId?: string
  /** Optional class name */
  className?: string
}

interface TreeNodeProps {
  library: Library
  level: number
  expandedLibraries: Set<string>
  onToggle: (libraryId: string) => void
  onSelect: (spec: Specification, library: Library) => void
  selectedSpecId?: string
  searchQuery: string
}

/**
 * Recursive tree node for a library and its specs/children
 */
function TreeNode({
  library,
  level,
  expandedLibraries,
  onToggle,
  onSelect,
  selectedSpecId,
  searchQuery,
}: TreeNodeProps) {
  const specifications = useLibraryStore((s) => s.specifications)
  const childLibraries = useLibraryStore((s) => s.childLibraries)
  const fetchSpecifications = useLibraryStore((s) => s.fetchSpecifications)

  const isExpanded = expandedLibraries.has(library.id)
  // Memoized so a missing entry yields a stable empty array for the memos below.
  const specs = useMemo(() => specifications.get(library.id) ?? [], [specifications, library.id])
  const children = childLibraries.get(library.id) || []

  // Fetch specs when expanded (childLibraries are populated by fetchLibraries)
  useEffect(() => {
    if (isExpanded) {
      if (!specifications.has(library.id)) {
        fetchSpecifications(library.id)
      }
    }
  }, [isExpanded, library.id, specifications, childLibraries, fetchSpecifications])

  // Filter specs by search query
  const filteredSpecs = useMemo(() => {
    if (!searchQuery) return specs
    const query = searchQuery.toLowerCase()
    return specs.filter((s) => s.name.toLowerCase().includes(query))
  }, [specs, searchQuery])

  // Check if library or children match search
  const matchesSearch = useMemo(() => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    if (library.name.toLowerCase().includes(query)) return true
    if (filteredSpecs.length > 0) return true
    return false
  }, [library.name, searchQuery, filteredSpecs])

  if (!matchesSearch && searchQuery) return null

  const hasChildren = children.length > 0 || specs.length > 0

  return (
    <div>
      {/* Library row */}
      <button
        className={cn(
          'flex items-center gap-1 w-full px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-sm',
          level > 0 && 'ml-3',
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onToggle(library.id)}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="h-3 w-3 text-slate-400 dark:text-slate-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-slate-400 dark:text-slate-500 flex-shrink-0" />
          )
        ) : (
          <span className="w-3" />
        )}
        <FolderOpen className="h-3 w-3 text-amber-500 flex-shrink-0" />
        <span className="truncate text-slate-700 dark:text-slate-200">{library.name}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto flex-shrink-0">{specs.length}</span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div>
          {/* Child libraries */}
          {children.map((child) => (
            <TreeNode
              key={child.id}
              library={child}
              level={level + 1}
              expandedLibraries={expandedLibraries}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedSpecId={selectedSpecId}
              searchQuery={searchQuery}
            />
          ))}

          {/* Specifications */}
          {filteredSpecs.map((spec) => {
            const specData = spec.data as { inputs?: ParameterSpec[]; outputs?: ParameterSpec[] } | undefined
            const inputCount = specData?.inputs?.length || 0
            const outputCount = specData?.outputs?.length || 0

            return (
              <button
                key={spec.id}
                className={cn(
                  'flex items-center gap-1 w-full px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-sm',
                  selectedSpecId === spec.id && 'bg-blue-50 hover:bg-blue-100',
                )}
                style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}
                onClick={() => onSelect(spec, library)}
              >
                <span className="w-3" />
                <FileText className="h-3 w-3 text-sky-500 flex-shrink-0" />
                <span
                  className={cn(
                    'truncate',
                    selectedSpecId === spec.id ? 'text-blue-700' : 'text-slate-700 dark:text-slate-200',
                  )}
                >
                  {spec.name}
                </span>
                {(inputCount > 0 || outputCount > 0) && (
                  <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto flex-shrink-0">
                    {inputCount}in/{outputCount}out
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Tree view component for browsing and selecting Step Library specifications.
 *
 * Features:
 * - Lists all Step Libraries and their specifications
 * - Supports nested sub-libraries
 * - Filter/search capability
 * - Shows spec metadata (input/output counts)
 */
export function StepLibraryPicker({ onSelect, selectedSpecId, className }: StepLibraryPickerProps) {
  const libraries = useLibraryStore((s) => s.libraries)
  const fetchLibraries = useLibraryStore((s) => s.fetchLibraries)

  const [searchQuery, setSearchQuery] = useState('')
  const [expandedLibraries, setExpandedLibraries] = useState<Set<string>>(new Set())

  // Fetch libraries on mount
  useEffect(() => {
    if (libraries.length === 0) {
      fetchLibraries()
    }
  }, [libraries.length, fetchLibraries])

  // Get top-level step libraries
  const stepLibraries = useMemo(() => {
    return libraries.filter((lib) => lib.entityType === 'step' && !lib.parentLibraryId)
  }, [libraries])

  const handleToggle = useCallback((libraryId: string) => {
    setExpandedLibraries((prev) => {
      const next = new Set(prev)
      if (next.has(libraryId)) {
        next.delete(libraryId)
      } else {
        next.add(libraryId)
      }
      return next
    })
  }, [])

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Search input */}
      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 dark:text-slate-500" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search steps..."
          className="h-7 pl-7 text-sm"
        />
      </div>

      {/* Tree view */}
      <ScrollArea className="h-48 border rounded">
        <div className="p-1">
          {stepLibraries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400 dark:text-slate-500">
              <Layers className="h-6 w-6 mb-2" />
              <p className="text-xs">No step libraries found</p>
              <p className="text-xs">Create a step library first</p>
            </div>
          ) : (
            stepLibraries.map((lib) => (
              <TreeNode
                key={lib.id}
                library={lib}
                level={0}
                expandedLibraries={expandedLibraries}
                onToggle={handleToggle}
                onSelect={onSelect}
                selectedSpecId={selectedSpecId}
                searchQuery={searchQuery}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
