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

import { useEffect, useRef, useCallback } from 'react'
import {
  Copy,
  Trash2,
  Edit,
  CopyPlus,
  Navigation,
  Clipboard,
  MousePointerSquareDashed,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  Rows3,
  Replace,
} from 'lucide-react'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { WorkflowNode, StepNodeData } from '@/types/nodes'
import { cloneFormDocument } from '@/lib/form-document/clone-document'

interface CanvasContextMenuProps {
  position: { x: number; y: number } | null
  type: 'node' | 'pane' | 'edge'
  targetId?: string
  onClose: () => void
  canEdit: boolean
  /** Opens the workflow-wide Convert buttons dialog (owned by the canvas, since this menu closes). */
  onConvertButtons?: () => void
}

/**
 * Positioned dropdown menu that appears at cursor position on right-click.
 * Three variants: node, pane (empty canvas), and edge context menus.
 */
export function CanvasContextMenu({
  position,
  type,
  targetId,
  onClose,
  canEdit,
  onConvertButtons,
}: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!position) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    // Delay to prevent immediate close from the right-click event itself
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    })

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [position, onClose])

  if (!position) return null

  return (
    <div
      ref={menuRef}
      className="bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[160px]"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 100,
      }}
    >
      {type === 'node' && <NodeContextMenuItems targetId={targetId} onClose={onClose} canEdit={canEdit} />}
      {type === 'pane' && (
        <PaneContextMenuItems onClose={onClose} canEdit={canEdit} onConvertButtons={onConvertButtons} />
      )}
      {type === 'edge' && <EdgeContextMenuItems targetId={targetId} onClose={onClose} canEdit={canEdit} />}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Align + Distribute menu items (shared by node and pane menus)
// ──────────────────────────────────────────────────────────────

/**
 * Renders the Align (2+ selected) and Distribute (3+ selected) sections,
 * each with its own header and divider. Returns null when neither section
 * applies, so callers can drop it in unconditionally.
 */
function SelectionMenuItems({ onClose }: { onClose: () => void }) {
  const nodes = useFlowStore((s) => s.nodes)
  const alignSelectedNodes = useFlowStore((s) => s.alignSelectedNodes)
  const distributeSelectedNodes = useFlowStore((s) => s.distributeSelectedNodes)

  const selectedCount = nodes.filter((n) => n.selected).length
  const showAlign = selectedCount >= 2
  const showDistribute = selectedCount >= 3
  if (!showAlign && !showDistribute) return null

  const align = (kind: Parameters<typeof alignSelectedNodes>[0]) => {
    alignSelectedNodes(kind)
    onClose()
  }
  const distribute = (axis: Parameters<typeof distributeSelectedNodes>[0]) => {
    distributeSelectedNodes(axis)
    onClose()
  }

  return (
    <>
      {showAlign && (
        <>
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-400 select-none">
            Align ({selectedCount} selected)
          </div>
          <MenuItem
            icon={<AlignStartVertical className="h-3.5 w-3.5" />}
            label="Align Left"
            onClick={() => align('left')}
          />
          <MenuItem
            icon={<AlignCenterVertical className="h-3.5 w-3.5" />}
            label="Align Center H"
            onClick={() => align('centerH')}
          />
          <MenuItem
            icon={<AlignEndVertical className="h-3.5 w-3.5" />}
            label="Align Right"
            onClick={() => align('right')}
          />
          <MenuItem
            icon={<AlignStartHorizontal className="h-3.5 w-3.5" />}
            label="Align Top"
            onClick={() => align('top')}
          />
          <MenuItem
            icon={<AlignCenterHorizontal className="h-3.5 w-3.5" />}
            label="Align Center V"
            onClick={() => align('centerV')}
          />
          <MenuItem
            icon={<AlignEndHorizontal className="h-3.5 w-3.5" />}
            label="Align Bottom"
            onClick={() => align('bottom')}
          />
          <div className="my-1 border-t border-slate-200" />
        </>
      )}
      {showDistribute && (
        <>
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-400 select-none">Distribute</div>
          <MenuItem
            icon={<Rows3 className="h-3.5 w-3.5" />}
            label="Distribute Horizontally"
            onClick={() => distribute('horizontal')}
          />
          <MenuItem
            icon={<Rows3 className="h-3.5 w-3.5 rotate-90" />}
            label="Distribute Vertically"
            onClick={() => distribute('vertical')}
          />
          <div className="my-1 border-t border-slate-200" />
        </>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Node context menu
// ──────────────────────────────────────────────────────────────

function NodeContextMenuItems({
  targetId,
  onClose,
  canEdit,
}: {
  targetId?: string
  onClose: () => void
  canEdit: boolean
}) {
  const nodes = useFlowStore((s) => s.nodes)
  const setNodes = useFlowStore((s) => s.setNodes)
  const deleteSelectedNodes = useFlowStore((s) => s.deleteSelectedNodes)
  const addNode = useFlowStore((s) => s.addNode)
  const requestEditDialog = useFlowStore((s) => s.requestEditDialog)
  const setSelectedSpecification = useLibraryStore((s) => s.setSelectedSpecification)
  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)

  const targetNode = nodes.find((n) => n.id === targetId) as WorkflowNode | undefined

  // Show selection-scoped Align/Distribute only when the right-clicked node
  // is part of the active multi-selection. Otherwise the menu's existing
  // single-target operations (Edit/Duplicate/Copy/Delete) apply to the
  // right-clicked node and selection-scoped entries would have ambiguous
  // scope. (Pane right-click has no such ambiguity, so it always shows
  // them when 2+/3+ are selected.)
  const targetInSelection = !!targetId && nodes.find((n) => n.id === targetId)?.selected === true

  const handleEdit = useCallback(() => {
    if (!targetId) return
    // Select the node first, then request edit dialog
    setNodes(nodes.map((n) => ({ ...n, selected: n.id === targetId })))
    requestEditDialog('node')
    onClose()
  }, [targetId, nodes, setNodes, requestEditDialog, onClose])

  const handleDuplicate = useCallback(() => {
    if (!targetNode) return
    const clonedData = { ...targetNode.data }

    // v2 form document — fresh identity (new section/row/block ids and image imageOids)
    if (clonedData.formDocument) {
      clonedData.formDocument = cloneFormDocument(clonedData.formDocument)
    }

    const newNode: WorkflowNode = {
      ...targetNode,
      id: crypto.randomUUID(),
      position: {
        x: targetNode.position.x + 20,
        y: targetNode.position.y + 20,
      },
      selected: true,
      data: clonedData,
    }
    // Deselect existing, add duplicate
    setNodes(nodes.map((n) => ({ ...n, selected: false })))
    addNode(newNode)
    onClose()
  }, [targetNode, nodes, setNodes, addNode, onClose])

  const handleDelete = useCallback(() => {
    if (!targetId) return
    // Select the target node, then delete selected
    const { nodes: currentNodes } = useFlowStore.getState()
    useFlowStore.setState({
      nodes: currentNodes.map((n) => ({ ...n, selected: n.id === targetId })),
    })
    // Use a microtask to ensure state is updated before delete
    queueMicrotask(() => {
      deleteSelectedNodes()
    })
    onClose()
  }, [targetId, deleteSelectedNodes, onClose])

  const handleCopy = useCallback(() => {
    if (!targetId) return
    // Select the node and trigger a copy event
    setNodes(nodes.map((n) => ({ ...n, selected: n.id === targetId })))
    document.execCommand('copy')
    onClose()
  }, [targetId, nodes, setNodes, onClose])

  const handleNavigateToChild = useCallback(() => {
    if (!targetNode) return
    const data = targetNode.data as StepNodeData
    if (data.subWorkflowMode === 'embedded' && data.embeddedWorkflowSpecId) {
      setSelectedSpecification(data.embeddedWorkflowSpecId, selectedLibraryId)
    }
    onClose()
  }, [targetNode, setSelectedSpecification, selectedLibraryId, onClose])

  const isWorkflowProxy = targetNode?.type === 'workflowProxy'
  const isEmbedded = isWorkflowProxy && (targetNode?.data as StepNodeData)?.subWorkflowMode === 'embedded'

  return (
    <>
      {targetInSelection && canEdit && <SelectionMenuItems onClose={onClose} />}
      {canEdit && <MenuItem icon={<Edit className="h-3.5 w-3.5" />} label="Edit" onClick={handleEdit} />}
      {canEdit && <MenuItem icon={<CopyPlus className="h-3.5 w-3.5" />} label="Duplicate" onClick={handleDuplicate} />}
      <MenuItem icon={<Copy className="h-3.5 w-3.5" />} label="Copy" onClick={handleCopy} />
      {isEmbedded && (
        <MenuItem
          icon={<Navigation className="h-3.5 w-3.5" />}
          label="Navigate to Child"
          onClick={handleNavigateToChild}
        />
      )}
      {canEdit && (
        <>
          <div className="my-1 border-t border-slate-200" />
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />}
            label="Delete"
            onClick={handleDelete}
            danger
          />
        </>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Pane context menu (right-click empty canvas)
// ──────────────────────────────────────────────────────────────

function PaneContextMenuItems({
  onClose,
  canEdit,
  onConvertButtons,
}: {
  onClose: () => void
  canEdit: boolean
  onConvertButtons?: () => void
}) {
  const setNodes = useFlowStore((s) => s.setNodes)
  const nodes = useFlowStore((s) => s.nodes)

  const handlePaste = useCallback(() => {
    document.execCommand('paste')
    onClose()
  }, [onClose])

  const handleSelectAll = useCallback(() => {
    setNodes(nodes.map((n) => ({ ...n, selected: true })))
    onClose()
  }, [nodes, setNodes, onClose])

  return (
    <>
      {/* Selection-scoped sections come first so they're prominent when the
          user has nodes selected; falls through to Paste/Select All otherwise. */}
      {canEdit && <SelectionMenuItems onClose={onClose} />}
      {canEdit && (
        <MenuItem icon={<Clipboard className="h-3.5 w-3.5" />} label="Paste" onClick={handlePaste} shortcut="Ctrl+V" />
      )}
      {canEdit && (
        <MenuItem
          icon={<Replace className="h-3.5 w-3.5" />}
          label="Convert buttons in all forms..."
          onClick={() => {
            onConvertButtons?.()
            onClose()
          }}
        />
      )}
      <MenuItem
        icon={<MousePointerSquareDashed className="h-3.5 w-3.5" />}
        label="Select All"
        onClick={handleSelectAll}
        shortcut="Ctrl+A"
      />
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Edge context menu
// ──────────────────────────────────────────────────────────────

function EdgeContextMenuItems({
  targetId,
  onClose,
  canEdit,
}: {
  targetId?: string
  onClose: () => void
  canEdit: boolean
}) {
  const edges = useFlowStore((s) => s.edges)
  const setEdges = useFlowStore((s) => s.setEdges)
  const nodes = useFlowStore((s) => s.nodes)
  const requestEditDialog = useFlowStore((s) => s.requestEditDialog)

  const targetEdge = edges.find((e) => e.id === targetId)
  const sourceNode = targetEdge ? nodes.find((n) => n.id === targetEdge.source) : undefined
  const isSelect1Edge = sourceNode?.type === 'select1'

  const handleDelete = useCallback(() => {
    if (!targetId) return
    setEdges(edges.filter((e) => e.id !== targetId))
    onClose()
  }, [targetId, edges, setEdges, onClose])

  const handleEditCondition = useCallback(() => {
    if (!targetId || !sourceNode) return
    // Select the edge by setting it as selected, then request edit
    setEdges(edges.map((e) => ({ ...e, selected: e.id === targetId })))
    requestEditDialog('node')
    onClose()
  }, [targetId, sourceNode, edges, setEdges, requestEditDialog, onClose])

  return (
    <>
      {isSelect1Edge && canEdit && (
        <MenuItem icon={<Edit className="h-3.5 w-3.5" />} label="Edit Condition" onClick={handleEditCondition} />
      )}
      {canEdit && (
        <MenuItem icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />} label="Delete" onClick={handleDelete} danger />
      )}
      {!canEdit && <div className="px-3 py-1.5 text-sm text-slate-400 select-none">Read-only</div>}
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Shared menu item component
// ──────────────────────────────────────────────────────────────

function MenuItem({
  icon,
  label,
  onClick,
  shortcut,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  shortcut?: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={`w-full px-3 py-1.5 text-sm cursor-pointer flex items-center gap-2 ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100'
      }`}
      onClick={onClick}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-xs text-slate-400 ml-4">{shortcut}</span>}
    </button>
  )
}
