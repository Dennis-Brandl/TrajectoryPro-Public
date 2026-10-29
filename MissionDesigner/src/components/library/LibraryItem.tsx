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

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
  Plus,
  FolderPlus,
  Package,
  Upload,
  FileCode,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mission/ui'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mission/ui'
import { Input } from '@mission/ui'
import { Button } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import type { Library, Specification } from '@/types/library'
import { SpecificationItem } from './SpecificationItem'
import { SpecTreeItem, type SpecTreeNode } from './SpecTreeItem'
import { DeleteLibraryDialog } from './DeleteLibraryDialog'
import { ChangeStateDialog } from './ChangeStateDialog'
import { CreateNewVersionDialog } from './CreateNewVersionDialog'
import { usePrincipal, principalCan } from '@/stores/principalStore'
import {
  createLibrary as createLibraryFlow,
  renameLibrary as renameLibraryFlow,
} from '@/stores/specificationStore/libraryCrud'

interface LibraryItemProps {
  library: Library
  isExpanded: boolean
  isSelected: boolean
  specifications: Specification[]
  specTree?: SpecTreeNode[]
  onToggle: () => void
  onSelect: () => void
  onExpand: () => void
  depth?: number
  searchQuery?: string
  onImportRuntimePackage?: (libraryId: string, file: File) => Promise<void>
  onImportSingleSpec?: (libraryId: string, file: File) => Promise<void>
  /** Import a Mission Designer BatchML export (.batchml.xml) as a workflow (workflow libraries only). */
  onImportBatchml?: (libraryId: string, file: File) => Promise<void>
  /** Externally-managed expanded IDs for child libraries (lifted from local state). */
  childExpandedIds?: Set<string>
  /** Callback to toggle a child library's expanded state. */
  onChildToggle?: (childId: string) => void
  /** Callback to expand a child library and trigger data fetch. */
  onChildExpand?: (childId: string) => void
  onExportPDF?: (specId: string, libraryId: string) => void
  onExportPackage?: (specId: string, libraryId: string) => void
}

/**
 * Single library item in the tree with expand/collapse and context menu.
 * Supports nested libraries for action type.
 */
export function LibraryItem({
  library,
  isExpanded,
  isSelected,
  specifications,
  specTree,
  onToggle,
  onSelect,
  onExpand,
  depth = 0,
  searchQuery = '',
  onImportRuntimePackage,
  onImportSingleSpec,
  onImportBatchml,
  childExpandedIds: externalChildExpandedIds,
  onChildToggle: externalChildToggle,
  onChildExpand: externalChildExpand,
  onExportPDF,
  onExportPackage,
}: LibraryItemProps) {
  const exportPackageHandler = library.entityType === 'environment' ? onExportPackage : undefined
  const principal = usePrincipal()
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showAddSpecDialog, setShowAddSpecDialog] = useState(false)
  const [showAddSubLibraryDialog, setShowAddSubLibraryDialog] = useState(false)
  const [newName, setNewName] = useState(library.name)
  const [newSpecName, setNewSpecName] = useState('')
  const [newSubLibraryName, setNewSubLibraryName] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [isCreatingSpec, setIsCreatingSpec] = useState(false)
  const [isCreatingSubLibrary, setIsCreatingSubLibrary] = useState(false)
  // Use externally-lifted expand state if provided, otherwise local fallback
  const [localChildExpandedIds, setLocalChildExpandedIds] = useState<Set<string>>(new Set())
  const childExpandedIds = externalChildExpandedIds ?? localChildExpandedIds
  const [isImportingRuntime, setIsImportingRuntime] = useState(false)
  const runtimeInputRef = useRef<HTMLInputElement>(null)
  const [isImportingSingleSpec, setIsImportingSingleSpec] = useState(false)
  const singleSpecInputRef = useRef<HTMLInputElement>(null)
  const [isImportingBatchml, setIsImportingBatchml] = useState(false)
  const batchmlInputRef = useRef<HTMLInputElement>(null)

  // Right-gated affordances (design §6) — team rights replace the owner/isShared
  // model. teamId-null libraries (test fixtures) yield no rights for non-admins.
  const canEdit = principalCan(principal, library, 'edit') // spec edit + library rename
  const canCreateSpec = principalCan(principal, library, 'create')
  const canCreateLib = principalCan(principal, library, 'library.create')
  const canDeleteLib = principalCan(principal, library, 'library.delete')
  const showActions = canEdit || canCreateSpec || canCreateLib || canDeleteLib

  const fetchSpecifications = useLibraryStore((s) => s.fetchSpecifications)
  const deleteSpecification = (id: string): Promise<void> => {
    const spec = useSpecificationStore.getState().specs.get(id)
    const libraryId = spec?.libraryId
    useSpecificationStore.getState().deleteSpecInMemory(id)
    if (libraryId) {
      fetchSpecifications(libraryId)
    }
    return Promise.resolve()
  }
  const createSpecification = async (
    libId: string,
    init: { name: string; description?: string; data: Record<string, unknown>; dataSchemaVersion?: number },
  ): Promise<Specification | null> => {
    const newId = useSpecificationStore.getState().createSpecInMemory({ parentId: null, libraryId: libId, init })
    // Sync libraryStore view layer so sidebar shows the new spec
    fetchSpecifications(libId)
    // Re-read from store to return the created spec shape
    const spec = useSpecificationStore.getState().specs.get(newId)
    if (!spec) return null
    return {
      id: spec.id,
      libraryId: spec.libraryId,
      name: spec.name,
      description: spec.description,
      version: spec.version,
      state: spec.state as Specification['state'],
      data: spec.data,
      history: spec.history,
      createdAt: spec.createdAt,
      updatedAt: spec.updatedAt,
    }
  }
  const fetchChildLibraries = useCallback((_libId: string): void => {
    // No-op: childLibraries are already populated by fetchLibraries during boot/sync
  }, [])
  const childLibraries = useLibraryStore((s) => s.childLibraries)
  const allSpecifications = useLibraryStore((s) => s.specifications)
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)
  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)
  const setSelectedSpecification = useLibraryStore((s) => s.setSelectedSpecification)
  const setSelectedLibrary = useLibraryStore((s) => s.setSelectedLibrary)

  // State for spec deletion
  const [specToDelete, setSpecToDelete] = useState<Specification | null>(null)
  const [isDeletingSpec, setIsDeletingSpec] = useState(false)

  // Dialog state for change-state and create-new-version actions
  const [stateChangeSpec, setStateChangeSpec] = useState<Specification | null>(null)
  const [newVersionSpec, setNewVersionSpec] = useState<Specification | null>(null)

  // State filter from store
  const stateFilter = useLibraryStore((s) => s.stateFilter)
  const applyNewVersion = useLibraryStore((s) => s.applyNewVersion)
  const applyStateChange = useLibraryStore((s) => s.applyStateChange)

  // Lookup map for SpecTreeItem callbacks (which only receive specId)
  const specsById = useMemo(() => {
    const map = new Map<string, Specification>()
    for (const s of specifications) map.set(s.id, s)
    return map
  }, [specifications])

  // Flat list of specs (used when no specTree)
  const visibleSpecs = specifications

  function passesStateFilter(state: string): boolean {
    return stateFilter === 'all' || state === stateFilter
  }

  const handleDeleteSpec = async () => {
    if (!specToDelete) return
    setIsDeletingSpec(true)
    const deletedId = specToDelete.id
    // Collect the deleted spec + its descendants so we can drop the editor
    // if the currently-selected spec is anywhere in that subtree.
    const deletedIds = new Set<string>([deletedId])
    {
      const specStore = useSpecificationStore.getState()
      const queue = [deletedId]
      while (queue.length > 0) {
        const cur = queue.shift()!
        for (const spec of specStore.specs.values()) {
          if (spec.parentSpecificationId === cur && !deletedIds.has(spec.id)) {
            deletedIds.add(spec.id)
            queue.push(spec.id)
          }
        }
      }
    }
    await deleteSpecification(deletedId)
    if (selectedSpecificationId && deletedIds.has(selectedSpecificationId)) {
      setSelectedSpecification(null, null)
    }
    setIsDeletingSpec(false)
    setSpecToDelete(null)
  }

  const children = childLibraries.get(library.id) || []

  // Fetch child libraries when expanded
  useEffect(() => {
    if (isExpanded) {
      fetchChildLibraries(library.id)
    }
  }, [isExpanded, library.id, fetchChildLibraries])

  /**
   * Handle drag start for specification items.
   * Sets the full spec data as a custom MIME type for the canvas to consume.
   */
  const onDragStart = useCallback((event: React.DragEvent, spec: Specification) => {
    // Set custom MIME type with full spec data for pre-populating node properties
    // The canvas checks for this first, then falls back to application/reactflow
    event.dataTransfer.setData(
      'application/trajectory-spec',
      JSON.stringify({
        id: spec.id,
        name: spec.name,
        description: spec.description,
        data: spec.data,
        libraryId: spec.libraryId,
      }),
    )
    event.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleRename = async () => {
    if (!newName.trim() || newName === library.name) {
      setShowRenameDialog(false)
      return
    }
    setIsRenaming(true)
    const success = await renameLibraryFlow(library.id, newName.trim())
    setIsRenaming(false)
    if (success) {
      setShowRenameDialog(false)
    }
  }

  const handleDeleted = () => {
    if (selectedLibraryId === library.id) {
      setSelectedLibrary(null)
    }
  }

  const handleAddSpec = async () => {
    if (!newSpecName.trim()) {
      return
    }
    setIsCreatingSpec(true)
    const spec = await createSpecification(library.id, {
      name: newSpecName.trim(),
      data: { nodes: [] },
    })
    setIsCreatingSpec(false)
    if (spec) {
      setNewSpecName('')
      setShowAddSpecDialog(false)
      // Expand the library to show specs and refresh the list
      onExpand()
      // Select the newly created specification
      setSelectedSpecification(spec.id, library.id)
    }
  }

  const handleAddSubLibrary = async () => {
    if (!newSubLibraryName.trim()) {
      return
    }
    setIsCreatingSubLibrary(true)
    const subLib = await createLibraryFlow({
      name: newSubLibraryName.trim(),
      entityType: library.entityType as 'workflow' | 'action' | 'environment' | 'step',
      parentLibraryId: library.id,
      teamId: library.teamId ?? '',
    })
    setIsCreatingSubLibrary(false)
    if (subLib) {
      setNewSubLibraryName('')
      setShowAddSubLibraryDialog(false)
      // Expand the library to show the new sub-library
      onExpand()
      // Select the newly created sub-library
      setSelectedLibrary(subLib.id)
    }
  }

  const toggleChildExpanded = (childId: string) => {
    if (externalChildToggle) {
      externalChildToggle(childId)
    } else {
      setLocalChildExpandedIds((prev) => {
        const next = new Set(prev)
        if (next.has(childId)) {
          next.delete(childId)
        } else {
          next.add(childId)
        }
        return next
      })
    }
  }

  const expandChild = (childId: string) => {
    if (externalChildExpand) {
      externalChildExpand(childId)
    } else {
      setLocalChildExpandedIds((prev) => new Set(prev).add(childId))
      fetchSpecifications(childId)
      fetchChildLibraries(childId)
    }
  }

  const importBatchmlFile = async (file: File) => {
    if (!onImportBatchml) return
    setIsImportingBatchml(true)
    try {
      await onImportBatchml(library.id, file)
      onExpand()
    } finally {
      setIsImportingBatchml(false)
      if (batchmlInputRef.current) batchmlInputRef.current.value = ''
    }
  }

  const handleBatchmlFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await importBatchmlFile(file)
  }

  const handleRuntimeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // A BatchML export picked through this entry (via "All Files") is not a
    // .WFmasterX zip — hand it to the BatchML importer instead of failing on it.
    if (onImportBatchml && file.name.toLowerCase().endsWith('.xml')) {
      if (runtimeInputRef.current) runtimeInputRef.current.value = ''
      await importBatchmlFile(file)
      return
    }
    if (!onImportRuntimePackage) return
    setIsImportingRuntime(true)
    try {
      await onImportRuntimePackage(library.id, file)
      onExpand()
    } finally {
      setIsImportingRuntime(false)
      if (runtimeInputRef.current) runtimeInputRef.current.value = ''
    }
  }

  const handleSingleSpecFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !onImportSingleSpec) return
    setIsImportingSingleSpec(true)
    try {
      await onImportSingleSpec(library.id, file)
      onExpand()
    } finally {
      setIsImportingSingleSpec(false)
      if (singleSpecInputRef.current) singleSpecInputRef.current.value = ''
    }
  }

  const FolderIcon = isExpanded ? FolderOpen : Folder

  return (
    <div className="select-none">
      {/* Library row */}
      <div
        className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 ${
          isSelected ? 'bg-slate-100 dark:bg-slate-800' : ''
        }`}
        role="treeitem"
        aria-expanded={isExpanded}
        aria-level={depth + 1}
        aria-selected={isSelected}
        onClick={() => {
          onSelect()
          onToggle()
        }}
      >
        <button
          className="p-0.5 hover:bg-slate-200 rounded"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          <FolderIcon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        </button>
        <span className="flex-1 text-sm truncate dark:text-slate-200">{library.name}</span>
        {showActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Library actions"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canCreateSpec && (
                <>
                  <DropdownMenuItem onClick={() => setShowAddSpecDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    {library.entityType === 'action'
                      ? 'Add Action'
                      : library.entityType === 'environment'
                        ? 'Add Environment'
                        : library.entityType === 'workflow'
                          ? 'Add Workflow'
                          : library.entityType === 'step'
                            ? 'Add Step Workflow'
                            : 'Add Specification'}
                  </DropdownMenuItem>
                  {onImportSingleSpec && (library.entityType === 'action' || library.entityType === 'environment') && (
                    <DropdownMenuItem
                      disabled={isImportingSingleSpec}
                      onClick={() => singleSpecInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {library.entityType === 'action' ? 'Import Action' : 'Import Environment'}
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {canCreateLib && (
                <DropdownMenuItem onClick={() => setShowAddSubLibraryDialog(true)}>
                  <FolderPlus className="h-4 w-4 mr-2" />
                  Add Sub-Library
                </DropdownMenuItem>
              )}
              {(canCreateSpec || canCreateLib) && (canEdit || canDeleteLib) && <DropdownMenuSeparator />}
              {canEdit && (
                <DropdownMenuItem onClick={() => setShowRenameDialog(true)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Rename
                </DropdownMenuItem>
              )}
              {canDeleteLib && (
                <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
              {library.entityType === 'workflow' && canCreateSpec && onImportRuntimePackage && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={isImportingRuntime} onClick={() => runtimeInputRef.current?.click()}>
                    <Package className="h-4 w-4 mr-2" />
                    {isImportingRuntime ? 'Importing...' : 'Import Workflow Package'}
                  </DropdownMenuItem>
                </>
              )}
              {library.entityType === 'workflow' && canCreateSpec && onImportBatchml && (
                <DropdownMenuItem disabled={isImportingBatchml} onClick={() => batchmlInputRef.current?.click()}>
                  <FileCode className="h-4 w-4 mr-2" />
                  {isImportingBatchml ? 'Importing...' : 'Import BatchML (ISA-88)'}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Children (sub-libraries and specifications) */}
      {isExpanded && (
        <div className="ml-4 border-l border-slate-200 dark:border-slate-700 pl-2" role="group">
          {/* Child libraries */}
          {children.map((child) => {
            // Filter child specifications based on search query
            const childSpecs = allSpecifications.get(child.id) || []
            const filteredChildSpecs = searchQuery
              ? childSpecs.filter((spec) => spec.name.toLowerCase().includes(searchQuery.toLowerCase()))
              : childSpecs

            return (
              <LibraryItem
                key={child.id}
                library={child}
                isExpanded={childExpandedIds.has(child.id)}
                isSelected={selectedLibraryId === child.id}
                specifications={filteredChildSpecs}
                onToggle={() => toggleChildExpanded(child.id)}
                onSelect={() => setSelectedLibrary(child.id)}
                onExpand={() => expandChild(child.id)}
                depth={depth + 1}
                searchQuery={searchQuery}
                onImportRuntimePackage={onImportRuntimePackage}
                onImportSingleSpec={onImportSingleSpec}
                onImportBatchml={onImportBatchml}
                childExpandedIds={externalChildExpandedIds}
                onChildToggle={externalChildToggle}
                onChildExpand={externalChildExpand}
                onExportPDF={onExportPDF}
                onExportPackage={onExportPackage}
              />
            )
          })}
          {specTree && specTree.length > 0
            ? specTree
                .filter((root) => passesStateFilter(root.state ?? 'Draft'))
                .map((root) => (
                  <SpecTreeItem
                    key={root.id}
                    node={root}
                    libraryId={library.id}
                    depth={0}
                    searchQuery={searchQuery}
                    library={library}
                    onDelete={(specId) => {
                      const spec = specsById.get(specId)
                      if (spec) setSpecToDelete(spec)
                    }}
                    onChangeState={(specId) => {
                      const spec = specsById.get(specId)
                      if (spec) setStateChangeSpec(spec)
                    }}
                    onCreateVersion={(specId) => {
                      const spec = specsById.get(specId)
                      if (spec) setNewVersionSpec(spec)
                    }}
                    onExportPDF={(specId) => onExportPDF?.(specId, library.id)}
                    onExportPackage={
                      exportPackageHandler ? (specId) => exportPackageHandler(specId, library.id) : undefined
                    }
                  />
                ))
            : visibleSpecs
                .filter((spec) => passesStateFilter(spec.state))
                .map((spec) => (
                  <SpecificationItem
                    key={spec.id}
                    spec={spec}
                    selectedSpecificationId={selectedSpecificationId}
                    onSelect={(specId) => setSelectedSpecification(specId, library.id)}
                    onDelete={setSpecToDelete}
                    onChangeState={setStateChangeSpec}
                    onCreateVersion={setNewVersionSpec}
                    onExportPDF={(specId) => onExportPDF?.(specId, library.id)}
                    onExportPackage={
                      exportPackageHandler ? (specId) => exportPackageHandler(specId, library.id) : undefined
                    }
                    onDragStart={onDragStart}
                    libraryId={library.id}
                    library={library}
                  />
                ))}
          {/* Empty state */}
          {children.length === 0 && specifications.length === 0 && (
            <div className="text-xs text-slate-400 py-1 px-2">No sub-libraries or specifications</div>
          )}
        </div>
      )}

      {/* Hidden file input for runtime package import */}
      {library.entityType === 'workflow' && onImportRuntimePackage && (
        <input
          ref={runtimeInputRef}
          type="file"
          accept=".WFmasterX"
          className="hidden"
          onChange={handleRuntimeFileChange}
        />
      )}
      {/* Hidden file input for BatchML (ISA-88) workflow import */}
      {library.entityType === 'workflow' && onImportBatchml && (
        <input
          ref={batchmlInputRef}
          type="file"
          accept=".batchml.xml,.xml"
          className="hidden"
          onChange={handleBatchmlFileChange}
        />
      )}
      {/* Hidden file input for single spec import */}
      {onImportSingleSpec && (library.entityType === 'action' || library.entityType === 'environment') && (
        <input
          ref={singleSpecInputRef}
          type="file"
          accept={library.entityType === 'action' ? '.WFaction' : '.WFenvir,.WFenvirX'}
          className="hidden"
          onChange={handleSingleSpecFileChange}
        />
      )}

      {/* Rename Dialog */}
      <AlertDialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <AlertDialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input')?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Rename Library</AlertDialogTitle>
            <AlertDialogDescription>Enter a new name for "{library.name}".</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Library name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isRenaming) {
                  handleRename()
                }
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRenaming}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRename} disabled={isRenaming}>
              {isRenaming ? 'Renaming...' : 'Rename'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <DeleteLibraryDialog
        library={library}
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onDeleted={handleDeleted}
      />

      {/* Add Specification Dialog */}
      <AlertDialog open={showAddSpecDialog} onOpenChange={setShowAddSpecDialog}>
        <AlertDialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input')?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {library.entityType === 'action'
                ? 'Add Master Action Specification'
                : library.entityType === 'environment'
                  ? 'Add Master Environment'
                  : library.entityType === 'workflow'
                    ? 'Add Master Workflow'
                    : library.entityType === 'step'
                      ? 'Add Step Workflow'
                      : 'Add Specification'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {library.entityType === 'action'
                ? `Create a new action in "${library.name}" Library.`
                : library.entityType === 'environment'
                  ? `Create a new environment in "${library.name}" Library.`
                  : library.entityType === 'workflow'
                    ? `Create a new workflow in "${library.name}" Library.`
                    : library.entityType === 'step'
                      ? `Create a new Step Workflow in "${library.name}" Library.`
                      : `Create a new specification in "${library.name}".`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Input
              value={newSpecName}
              onChange={(e) => setNewSpecName(e.target.value)}
              placeholder={library.entityType === 'step' ? 'Step workflow name' : 'Specification name'}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isCreatingSpec) {
                  handleAddSpec()
                }
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCreatingSpec}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAddSpec} disabled={isCreatingSpec || !newSpecName.trim()}>
              {isCreatingSpec ? 'Creating...' : 'Create'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Sub-Library Dialog */}
      <AlertDialog open={showAddSubLibraryDialog} onOpenChange={setShowAddSubLibraryDialog}>
        <AlertDialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input')?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Add Sub-Library</AlertDialogTitle>
            <AlertDialogDescription>
              {library.entityType === 'action'
                ? `Create a new action library inside "${library.name}" Library.`
                : library.entityType === 'environment'
                  ? `Create a new environment library inside "${library.name}" Library.`
                  : library.entityType === 'workflow'
                    ? `Create a new workflow library inside "${library.name}" Library.`
                    : library.entityType === 'step'
                      ? `Create a new step library inside "${library.name}" Library.`
                      : `Create a new library inside "${library.name}".`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Input
              value={newSubLibraryName}
              onChange={(e) => setNewSubLibraryName(e.target.value)}
              placeholder="Sub-library name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isCreatingSubLibrary) {
                  handleAddSubLibrary()
                }
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCreatingSubLibrary}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAddSubLibrary}
              disabled={isCreatingSubLibrary || !newSubLibraryName.trim()}
            >
              {isCreatingSubLibrary ? 'Creating...' : 'Create'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Change State Dialog */}
      {stateChangeSpec && (
        <ChangeStateDialog
          spec={stateChangeSpec}
          library={library}
          open
          onOpenChange={(o) => {
            if (!o) setStateChangeSpec(null)
          }}
          onSuccess={(updated) => {
            void applyStateChange(updated)
          }}
        />
      )}

      {/* Create New Version Dialog */}
      {newVersionSpec && (
        <CreateNewVersionDialog
          spec={newVersionSpec}
          siblingVersions={specifications
            .filter((s) => s.name === newVersionSpec.name && s.id !== newVersionSpec.id)
            .map((s) => s.version)}
          open
          onOpenChange={(o) => {
            if (!o) setNewVersionSpec(null)
          }}
          onSuccess={(newSpec) => {
            void applyNewVersion(newSpec)
          }}
        />
      )}

      {/* Delete Specification Dialog */}
      <AlertDialog open={specToDelete !== null} onOpenChange={(open) => !open && setSpecToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete{' '}
              {library.entityType === 'workflow'
                ? 'Workflow'
                : library.entityType === 'step'
                  ? 'Step'
                  : 'Specification'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{specToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingSpec}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSpec}
              disabled={isDeletingSpec}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeletingSpec ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
