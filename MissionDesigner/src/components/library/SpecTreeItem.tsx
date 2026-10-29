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

import { ArrowUpRight, ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useSpecExpansion } from '@/hooks/useSpecExpansion'
import { useLibraryStore } from '@/stores/libraryStore'
import { LibraryItemMenu } from './LibraryItemMenu'
import { usePrincipal } from '@/stores/principalStore'
import { specRowCapabilities } from '@/lib/specCapabilities'
import type { Library } from '@/types/library'

export interface ReferencedChild {
  specId: string
  specName: string
  libraryId: string
  libraryName: string
}

export interface SpecTreeNode {
  id: string
  libraryId: string | null
  name: string
  description: string | null
  version: string | null
  state: string | null
  createdAt: number
  updatedAt: number
  lastEditedByUserId: string | null
  children: SpecTreeNode[]
  referencedChildren: ReferencedChild[]
}

interface SpecTreeItemProps {
  node: SpecTreeNode
  libraryId: string
  depth: number
  searchQuery: string
  library?: Pick<Library, 'teamId' | 'entityType'>
  onDelete?: (specId: string) => void
  onChangeState?: (specId: string) => void
  onCreateVersion?: (specId: string) => void
  onExportPDF?: (specId: string) => void
  onExportPackage?: (specId: string) => void
}

const PADDING_BY_DEPTH: Record<number, string> = {
  0: 'pl-4',
  1: 'pl-8',
  2: 'pl-12',
  3: 'pl-16',
  4: 'pl-20',
  5: 'pl-24',
}

function paddingClass(depth: number): string {
  return PADDING_BY_DEPTH[depth] ?? `pl-[${(depth + 1) * 16}px]`
}

function matchesQuery(node: SpecTreeNode, q: string): boolean {
  if (node.name.toLowerCase().includes(q)) return true
  if (node.children.some((c) => matchesQuery(c, q))) return true
  if (node.referencedChildren.some((r) => r.specName.toLowerCase().includes(q))) return true
  return false
}

function nodeIsMatch(node: SpecTreeNode, q: string): boolean {
  return node.name.toLowerCase().includes(q)
}

export function SpecTreeItem({
  node,
  libraryId,
  depth,
  searchQuery,
  library,
  onDelete,
  onChangeState,
  onCreateVersion,
  onExportPDF,
  onExportPackage,
}: SpecTreeItemProps) {
  const hasChildren = node.children.length > 0 || node.referencedChildren.length > 0
  const isExpandedForRow = useSpecExpansion((s) => s.ids.has(node.id))
  const toggle = useSpecExpansion((s) => s.toggle)
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)
  const setSelectedSpecification = useLibraryStore((s) => s.setSelectedSpecification)
  const q = searchQuery.trim().toLowerCase()
  const searchMatchesDescendant = q.length > 0 && matchesQuery(node, q)
  const isExpanded = hasChildren && (isExpandedForRow || searchMatchesDescendant)
  const dim = q.length > 0 && !nodeIsMatch(node, q) && !searchMatchesDescendant
  const isSelected = selectedSpecificationId === node.id
  const principal = usePrincipal()
  const caps = specRowCapabilities(principal, library, node.state ?? 'Draft')

  return (
    <div>
      <div
        data-testid="spec-tree-row"
        className={`group flex items-center gap-1 ${paddingClass(depth)} py-1 rounded-md cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 ${
          isSelected ? 'border-l-2 border-blue-600 bg-blue-50 dark:bg-blue-900/30' : ''
        } ${dim ? 'opacity-50' : ''}`}
        onClick={() => setSelectedSpecification(node.id, libraryId)}
      >
        {hasChildren ? (
          <button
            className="p-0 shrink-0"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation()
              toggle(node.id)
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-slate-400" />
            ) : (
              <ChevronRight className="h-3 w-3 text-slate-400" />
            )}
          </button>
        ) : (
          <FileText className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="text-xs truncate dark:text-slate-200" title={node.name}>
            {node.name}
          </span>
          {depth === 0 && node.version && node.state && (
            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              <span>{`[${node.version}]`}</span> <span>{node.state}</span>
            </span>
          )}
        </div>
        {depth === 0 && onDelete && onExportPDF && onChangeState && onCreateVersion && (
          <LibraryItemMenu
            canChangeState={caps.canChangeState}
            canCreateVersion={caps.canCreateVersion}
            canDeleteSpec={caps.canDeleteSpec}
            onExportPackage={onExportPackage ? () => onExportPackage(node.id) : undefined}
            onExportPDF={() => onExportPDF(node.id)}
            onChangeState={() => onChangeState(node.id)}
            onCreateVersion={() => onCreateVersion(node.id)}
            onDelete={() => onDelete(node.id)}
          />
        )}
      </div>
      {isExpanded && (
        <div role="group">
          {node.children.map((child) => (
            <SpecTreeItem
              key={child.id}
              node={child}
              libraryId={libraryId}
              depth={depth + 1}
              searchQuery={searchQuery}
              library={library}
            />
          ))}
          {node.referencedChildren.map((ref) => (
            <div
              key={`ref-${ref.specId}`}
              data-testid="spec-tree-ref-row"
              className={`group flex items-center gap-1 ${paddingClass(depth + 1)} py-1 rounded-md cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800`}
              onClick={() => toast.info('Referenced workflows are only editable from the Step Workflow library')}
              title={`In ${ref.libraryName}`}
            >
              <ArrowUpRight className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="flex-1 text-xs italic truncate text-slate-500 dark:text-slate-400">{ref.specName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
