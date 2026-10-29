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

import { useCallback, useEffect, useRef } from 'react'
import { useFlowStore } from '@/stores/flowStore'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { snapshotReferencedImages, getSpecImages, setSpecImages } from '@/stores/specificationStore/imageHelpers'
import type { WorkflowNode, StepNodeData } from '@/types/nodes'
import type { Edge } from '@xyflow/react'
import { generateOID, WORKER_STEP, WORKER_INTERNAL } from '@/lib/snowflake'
import { cloneStepData } from '@/lib/clone-step-data'
import { normalizeCatchOutputsInNodes } from '@/lib/catch-outputs'

const MIME_TYPE = 'application/trajectory-nodes'
const PASTE_OFFSET = 20

/** Clipboard payload — nodes, edges, and any referenced image data URIs. */
interface ClipboardPayload {
  nodes: WorkflowNode[]
  edges: Edge[]
  images?: Record<string, string>
}

/**
 * Hook for copy/paste/delete operations on nodes.
 * Attaches to document-level clipboard and keyboard events.
 *
 * Usage: Call once in the component that contains ReactFlow.
 */
export function useCopyPaste() {
  const setNodes = useFlowStore((state) => state.setNodes)
  const setEdges = useFlowStore((state) => state.setEdges)
  const deleteSelectedNodes = useFlowStore((state) => state.deleteSelectedNodes)
  const canEdit = useCanEditActiveSpec()

  // Track copied data for internal paste (fallback if clipboard API fails)
  const copiedRef = useRef<ClipboardPayload | null>(null)

  const onCopy = useCallback((event: ClipboardEvent) => {
    // Don't intercept copy when form designer is open — it handles its own clipboard
    if (useFormDocumentStore.getState().openNodeId !== null) return

    // Don't intercept copy if user is typing in an input field
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      return
    }

    const nodes = useFlowStore.getState().nodes
    const edges = useFlowStore.getState().edges

    const selectedNodes = nodes.filter((n) => n.selected)
    if (selectedNodes.length === 0) return

    // Get edges between selected nodes
    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id))
    const selectedEdges = edges.filter((e) => selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target))

    // Snapshot image data URIs so they survive cross-workflow navigation
    const specId = useLibraryStore.getState().selectedSpecificationId
    const images = snapshotReferencedImages(specId, selectedNodes)
    const data: ClipboardPayload = { nodes: selectedNodes, edges: selectedEdges, images }

    // Store locally for paste
    copiedRef.current = data

    // Also set clipboard data
    event.preventDefault()
    event.clipboardData?.setData(MIME_TYPE, JSON.stringify(data))
  }, [])

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      // Don't intercept paste when form designer is open — it handles its own clipboard
      if (useFormDocumentStore.getState().openNodeId !== null) return

      // Don't intercept paste if user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return
      }

      if (!canEdit) return

      // Try clipboard first
      let data: ClipboardPayload | null = copiedRef.current
      const clipboardData = event.clipboardData?.getData(MIME_TYPE)
      if (clipboardData) {
        try {
          data = JSON.parse(clipboardData)
        } catch {
          // Use ref fallback
        }
      }

      if (!data || data.nodes.length === 0) return

      event.preventDefault()

      // Merge pasted images into current spec (current-spec wins on collisions)
      if (data.images && Object.keys(data.images).length > 0) {
        const targetSpecId = useLibraryStore.getState().selectedSpecificationId
        if (targetSpecId) {
          const existing = getSpecImages(targetSpecId)
          const merged: Record<string, string> = { ...data.images, ...existing }
          setSpecImages(targetSpecId, merged)
        }
      }

      const currentNodes = useFlowStore.getState().nodes
      const currentEdges = useFlowStore.getState().edges

      // Build ID mapping for new nodes
      const idMap = new Map<string, string>()
      data.nodes.forEach((node) => {
        idMap.set(node.id, generateOID(WORKER_STEP))
      })

      // Create new nodes with new IDs and offset positions
      const newNodes: WorkflowNode[] = data.nodes.map((node) => {
        const newId = idMap.get(node.id)!

        // Deep clone data with regenerated internal IDs
        const updatedData = cloneStepData(node.data as StepNodeData)

        return {
          ...node,
          id: newId,
          data: updatedData,
          position: {
            x: node.position.x + PASTE_OFFSET,
            y: node.position.y + PASTE_OFFSET,
          },
          selected: true,
        }
      })

      // Create new edges with remapped source/target
      const newEdges: Edge[] = data.edges.map((edge) => ({
        ...edge,
        id: generateOID(WORKER_INTERNAL),
        source: idMap.get(edge.source) ?? edge.source,
        target: idMap.get(edge.target) ?? edge.target,
      }))

      // Deselect existing nodes, add new ones. A CATCH pasted from a stale
      // cross-version clipboard payload may lack the canonical outputs —
      // backfill them so the Source picker sees them immediately.
      setNodes([...currentNodes.map((n) => ({ ...n, selected: false })), ...normalizeCatchOutputsInNodes(newNodes)])

      // Add new edges
      setEdges([...currentEdges, ...newEdges])
    },
    [canEdit, setNodes, setEdges],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't intercept keys when form designer is open
      if (useFormDocumentStore.getState().openNodeId !== null) return

      // Delete or Backspace deletes selected nodes (Ctrl+Z is the safety net)
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // Don't delete if user is typing in an input
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
          return
        }
        if (!canEdit) return
        event.preventDefault()
        deleteSelectedNodes()
      }
    },
    [canEdit, deleteSelectedNodes],
  )

  useEffect(() => {
    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onCopy, onPaste, onKeyDown])
}
