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

import { useEffect, useState } from 'react'
import { FileText, ChevronRight, ChevronDown } from 'lucide-react'
import type { Library, Specification } from '@/types/library'
import { LibraryItemMenu } from './LibraryItemMenu'
import { useSpecificationStore } from '@/stores/specificationStore'
import { useChildren } from '@/stores/specificationStore/selectors'
import { useLibraryStore } from '@/stores/libraryStore'
import type { Specification as SpecStoreSpec } from '@/stores/specificationStore/types'
import { usePrincipal } from '@/stores/principalStore'
import { specRowCapabilities } from '@/lib/specCapabilities'

export interface SpecificationItemProps {
  spec: Specification
  selectedSpecificationId: string | null
  onSelect: (specId: string) => void
  onDelete: (spec: Specification) => void
  onChangeState: (spec: Specification) => void
  onCreateVersion: (spec: Specification) => void
  onExportPDF: (specId: string) => void
  onExportPackage?: (specId: string) => void
  onDragStart: (event: React.DragEvent, spec: Specification) => void
  libraryId: string
  library?: Pick<Library, 'teamId' | 'entityType'>
}

/**
 * Specification item for the library sidebar.
 * Displays the spec name with `[version] state` on a sub-line beneath it,
 * matching the SpecTreeItem layout used by hierarchies that have a specTree.
 */
export function SpecificationItem({
  spec,
  selectedSpecificationId,
  onSelect,
  onDelete,
  onChangeState,
  onCreateVersion,
  onExportPDF,
  onExportPackage,
  onDragStart,
  libraryId,
  library,
}: SpecificationItemProps) {
  const [expanded, setExpanded] = useState(false)
  const directChildren = useChildren(spec.id)
  const hasChildren = directChildren.length > 0
  const principal = usePrincipal()
  const caps = specRowCapabilities(principal, library, spec.state)

  // Load the tree if children are not yet loaded
  useEffect(() => {
    if (expanded && !useSpecificationStore.getState().loadedRootIds.has(spec.id)) {
      void useSpecificationStore.getState().loadTree(spec.id)
    }
  }, [expanded, spec.id])

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded(!expanded)
  }

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1 rounded-md cursor-grab active:cursor-grabbing hover:bg-slate-100 dark:hover:bg-slate-800 ${
          selectedSpecificationId === spec.id ? 'border-l-2 border-blue-600 bg-blue-50 dark:bg-blue-900/30' : ''
        }`}
        onClick={() => onSelect(spec.id)}
        draggable
        onDragStart={(e) => onDragStart(e, spec)}
      >
        {hasChildren ? (
          <button onClick={handleToggle} className="p-0 shrink-0">
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-slate-400" />
            ) : (
              <ChevronRight className="h-3 w-3 text-slate-400" />
            )}
          </button>
        ) : (
          <FileText className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="text-xs truncate dark:text-slate-200" title={spec.name}>
            {spec.name}
          </span>
          {spec.version && spec.state && (
            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              <span>{`[${spec.version}]`}</span> <span>{spec.state}</span>
            </span>
          )}
        </div>
        <LibraryItemMenu
          canChangeState={caps.canChangeState}
          canCreateVersion={caps.canCreateVersion}
          canDeleteSpec={caps.canDeleteSpec}
          onExportPackage={onExportPackage ? () => onExportPackage(spec.id) : undefined}
          onExportPDF={() => onExportPDF(spec.id)}
          onChangeState={() => onChangeState(spec)}
          onCreateVersion={() => onCreateVersion(spec)}
          onDelete={() => onDelete(spec)}
        />
      </div>
      {expanded && hasChildren && (
        <div className="ml-4 border-l border-slate-200 dark:border-slate-700 pl-2">
          {directChildren.map((child) => (
            <ChildSpecItem key={child.id} child={child} depth={1} libraryId={libraryId} onNavigate={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Renders a child specification in the sidebar tree, with recursive grandchildren.
 * Uses specificationStore childrenOf index instead of the deleted child spec store.
 */
function ChildSpecItem({
  child,
  depth,
  libraryId,
  onNavigate,
}: {
  child: SpecStoreSpec
  depth: number
  libraryId: string
  onNavigate: (specId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const nestedChildren = useChildren(child.id)
  const hasNested = nestedChildren.length > 0
  const setSelectedSpecification = useLibraryStore((s) => s.setSelectedSpecification)

  const handleDoubleClick = () => {
    setSelectedSpecification(child.id, libraryId)
  }

  return (
    <div>
      <div
        className="group flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
        onDoubleClick={handleDoubleClick}
      >
        {hasNested ? (
          <button onClick={() => setExpanded(!expanded)} className="p-0 shrink-0">
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-slate-400" />
            ) : (
              <ChevronRight className="h-3 w-3 text-slate-400" />
            )}
          </button>
        ) : (
          <FileText className="h-3 w-3 text-slate-400 dark:text-slate-500" />
        )}
        <span className="flex-1 text-xs truncate text-slate-500 dark:text-slate-400" title={child.name}>
          {child.name}
        </span>
      </div>
      {expanded && hasNested && (
        <div className="ml-4 border-l border-slate-200 dark:border-slate-700 pl-2">
          {nestedChildren.map((nested) => (
            <ChildSpecItem
              key={nested.id}
              child={nested}
              depth={depth + 1}
              libraryId={libraryId}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}
