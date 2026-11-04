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
import { cn, treeRowClass, StateTag } from '@mission/ui'
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
  onMoveToLibrary?: (spec: Specification) => void
  onMoveToTeam?: (spec: Specification) => void
  onExportPDF: (specId: string) => void
  onExportPackage?: (specId: string) => void
  onDragStart: (event: React.DragEvent, spec: Specification) => void
  libraryId: string
  library?: Pick<Library, 'teamId' | 'entityType'>
}

/**
 * Specification item for the library sidebar.
 * One line: the spec name, then a state tag. The name truncates;
 * the row's title carries the full name and `[version]`.
 */
export function SpecificationItem({
  spec,
  selectedSpecificationId,
  onSelect,
  onDelete,
  onChangeState,
  onCreateVersion,
  onMoveToLibrary,
  onMoveToTeam,
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
        className={cn(
          'group cursor-grab active:cursor-grabbing',
          treeRowClass({ selected: selectedSpecificationId === spec.id }),
        )}
        onClick={() => onSelect(spec.id)}
        title={spec.version ? `${spec.name} [${spec.version}]` : spec.name}
        draggable
        onDragStart={(e) => onDragStart(e, spec)}
      >
        {hasChildren ? (
          <button onClick={handleToggle} className="p-0 shrink-0">
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="flex-1 min-w-0 text-xs truncate dark:text-foreground">{spec.name}</span>
        {spec.version && spec.state && (
          <>
            <span className="shrink-0">
              <StateTag state={spec.state} />
            </span>
          </>
        )}
        <LibraryItemMenu
          canChangeState={caps.canChangeState}
          canCreateVersion={caps.canCreateVersion}
          canDeleteSpec={caps.canDeleteSpec}
          canMoveToLibrary={caps.canMoveToLibrary && !!onMoveToLibrary}
          canMoveToTeam={caps.canMoveToTeam && !!onMoveToTeam}
          onMoveToLibrary={onMoveToLibrary ? () => onMoveToLibrary(spec) : undefined}
          onMoveToTeam={onMoveToTeam ? () => onMoveToTeam(spec) : undefined}
          onExportPackage={onExportPackage ? () => onExportPackage(spec.id) : undefined}
          onExportPDF={() => onExportPDF(spec.id)}
          onChangeState={() => onChangeState(spec)}
          onCreateVersion={() => onCreateVersion(spec)}
          onDelete={() => onDelete(spec)}
        />
      </div>
      {expanded && hasChildren && (
        <div className="ml-4 border-l border-border pl-2">
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
      <div className={cn('group cursor-pointer', treeRowClass({ depth: 1 }))} onDoubleClick={handleDoubleClick}>
        {hasNested ? (
          <button onClick={() => setExpanded(!expanded)} className="p-0 shrink-0">
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <FileText className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="flex-1 text-xs truncate text-muted-foreground" title={child.name}>
          {child.name}
        </span>
      </div>
      {expanded && hasNested && (
        <div className="ml-4 border-l border-border pl-2">
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
