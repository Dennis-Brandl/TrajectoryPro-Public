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

import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { Lock, Map } from 'lucide-react'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  BackgroundVariant,
  SelectionMode,
  useReactFlow,
  useUpdateNodeInternals,
  MarkerType,
  type Connection,
  type XYPosition,
  type Node,
  type Viewport,
} from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'
import { useFlowStore } from '@/stores/flowStore'
import { useNotationStore } from '@/stores/notationStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useWorkflowSessionStore } from '@/stores/workflowSessionStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { getChildren } from '@/stores/specificationStore/selectors'
import { useNodeTypes } from '@/components/nodes'
import { edgeTypes } from '@/components/edges'
import {
  SubWorkflowCreationDialog,
  type SubWorkflowCreationResult,
} from '@/components/properties/SubWorkflowCreationDialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@mission/ui'
import { Button } from '@mission/ui'
import { Input } from '@mission/ui'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasContextMenu } from './CanvasContextMenu'
import { CanvasSearchBar } from './CanvasSearchBar'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { ConvertButtonsDialog } from '@/components/form-designer/v2/ConvertButtonsDialog'
import { AlignDropdown } from './AlignDropdown'
import { DistributeDropdown } from './DistributeDropdown'
import type { NodeType, WorkflowNode, StepNodeData, ParameterSpec, ValueSpec, StepResourceCommand } from '@/types/nodes'
import { cloneStepData } from '@/lib/clone-step-data'
import { defaultStepData } from '@/lib/default-step-data'
import { generateOID, WORKER_STEP } from '@/lib/snowflake'
import { isTryCatchConnectionValid } from '@/lib/canvas/try-catch-connection'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { emptyDocument } from '@/lib/form-document/document-ops'
import { toast } from 'sonner'

import '@xyflow/react/dist/style.css'

const FormDocumentDesignerModal = lazy(() => import('@/components/form-designer/v2/FormDocumentDesignerModal'))

/** Stable color function for MiniMap (no closure deps, defined at module scope). */
function miniMapNodeColor(node: { type?: string }): string {
  switch (node.type) {
    case 'start':
      return '#22c55e'
    case 'end':
      return '#ef4444'
    case 'select1':
    case 'waitAny':
    case 'gateStep':
      return '#f59e0b'
    case 'parallel':
    case 'waitAll':
      return '#8b5cf6'
    default:
      return '#64748b'
  }
}

/**
 * Returns the default label for a given node type.
 */
function getDefaultLabel(type: NodeType): string {
  switch (type) {
    case 'start':
      return 'START'
    case 'end':
      return 'END'
    case 'actionProxyWait':
      return 'Env Action'
    case 'yesNoStep':
      return 'Yes/No'
    case 'userInteractionStep':
      return 'User Interaction'
    case 'scriptStep':
      return 'Script'
    case 'workflowProxy':
      return 'Child Workflow'
    case 'select1':
      return 'SELECT 1'
    case 'waitAny':
      return 'WAIT ANY'
    case 'parallel':
      return 'PARALLEL'
    case 'waitAll':
      return 'WAIT ALL'
    case 'catch':
      return 'CATCH'
    case 'return':
      return 'RETURN'
    case 'gateStep':
      return 'Gate'
  }
}

/**
 * Returns the dimensions of a node type for centering on drop.
 */
function getNodeDimensions(type: NodeType): { width: number; height: number } {
  switch (type) {
    case 'start':
    case 'end':
      return { width: 30, height: 30 }
    case 'select1':
    case 'waitAny':
    case 'parallel':
    case 'waitAll':
      return { width: 90, height: 40 }
    case 'gateStep':
      return { width: 60, height: 60 }
    default:
      return { width: 140, height: 60 }
  }
}

/**
 * Returns the derived label for a node.
 * For other types, returns the existing data.label.
 */
export function getDerivedLabel(node: WorkflowNode): string {
  if (node.type === 'userInteractionStep') {
    const label = node.data.label
    if (label) {
      return label.length > 30 ? label.substring(0, 30) + '...' : label
    }
    return 'User Interaction'
  }
  if (node.type === 'scriptStep') {
    const lang = node.data.scriptLanguage
    if (lang) {
      return lang.charAt(0).toUpperCase() + lang.slice(1)
    }
    return 'Script'
  }
  if (node.type === 'select1') {
    const name = node.data.select1InputName
    if (name) {
      return name.length > 30 ? name.substring(0, 30) + '...' : name
    }
    return 'SELECT 1'
  }
  return node.data.label
}

interface FlowCanvasProps {
  /** Called when the user finishes panning/zooming the canvas */
  onMoveEnd?: (viewport: Viewport) => void
  /** Viewport to restore on mount (if undefined, fitView is used) */
  initialViewport?: Viewport
}

export function FlowCanvas({ onMoveEnd, initialViewport }: FlowCanvasProps = {}) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    createEmbeddedSubWorkflow,
    createReferencedSubWorkflow,
  } = useFlowStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
      onNodesChange: state.onNodesChange,
      onEdgesChange: state.onEdgesChange,
      onConnect: state.onConnect,
      addNode: state.addNode,
      createEmbeddedSubWorkflow: state.createEmbeddedSubWorkflow,
      createReferencedSubWorkflow: state.createReferencedSubWorkflow,
    })),
  )

  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)
  const setSelectedSpecification = useLibraryStore((s) => s.setSelectedSpecification)

  const canEdit = useCanEditActiveSpec()

  const { screenToFlowPosition } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()

  // Wrap onConnect to recalculate handle positions after dynamic handle creation
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!canEdit) return
      const sourceNode = nodes.find((n) => n.id === connection.source)
      const targetNode = nodes.find((n) => n.id === connection.target)
      onConnect(connection)

      // Recalculate handle positions after dynamic handle creation
      const nodeIdsToUpdate: string[] = []

      if (sourceNode?.type === 'select1' && connection.sourceHandle === 'default') {
        nodeIdsToUpdate.push(connection.source!)
      }
      if (sourceNode?.type === 'parallel' && connection.sourceHandle === 'default') {
        nodeIdsToUpdate.push(connection.source!)
      }
      if ((targetNode?.type === 'waitAny' || targetNode?.type === 'waitAll') && connection.targetHandle === 'default') {
        nodeIdsToUpdate.push(connection.target!)
      }

      if (nodeIdsToUpdate.length > 0) {
        requestAnimationFrame(() => {
          updateNodeInternals(nodeIdsToUpdate)
        })
      }
    },
    [canEdit, nodes, onConnect, updateNodeInternals],
  )

  // Force handle position recalculation on initial load (IndexedDB rehydration)
  // and when notation changes cause node component swaps.
  // Track node IDs to detect structural changes (add/remove), not property changes.
  const prevNodeIdSetRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const currentIdSet = new Set(nodes.map((n) => n.id))
    const prevIdSet = prevNodeIdSetRef.current

    if (currentIdSet.size > 0 && (prevIdSet.size === 0 || currentIdSet.size !== prevIdSet.size)) {
      // Initial load or structure changed — find new/changed node IDs
      const toUpdate =
        prevIdSet.size === 0
          ? [...currentIdSet] // Initial load: update all
          : [...currentIdSet].filter((id) => !prevIdSet.has(id)) // Only new nodes

      if (toUpdate.length > 0) {
        const timer = setTimeout(() => {
          updateNodeInternals(toUpdate)
        }, 150)
        prevNodeIdSetRef.current = currentIdSet
        return () => clearTimeout(timer)
      }
    }
    prevNodeIdSetRef.current = currentIdSet
  }, [nodes, updateNodeInternals])

  // Defensive: when the active notation changes (workflow switch with a
  // different saved notation, or explicit user toggle), force RF to re-measure
  // every node's handle positions. Without this, edge paths can keep targeting
  // handle coords cached under the previous notation — connection lines render
  // pointing to BPMN handle positions even after the nodes re-render with
  // flowchart handles, and vice versa.
  const notation = useNotationStore((s) => s.notation)
  useEffect(() => {
    const ids = useFlowStore.getState().nodes.map((n) => n.id)
    if (ids.length === 0) return
    const timer = setTimeout(() => updateNodeInternals(ids), 0)
    return () => clearTimeout(timer)
  }, [notation, updateNodeInternals])

  // Sub-workflow creation dialog state (reference mode)
  const [showSubWorkflowDialog, setShowSubWorkflowDialog] = useState(false)

  // Child workflow name dialog state (embedded mode via child specification store)
  const [showChildNameDialog, setShowChildNameDialog] = useState(false)
  const [childWorkflowName, setChildWorkflowName] = useState('')
  const [childNameError, setChildNameError] = useState('')
  const [childDropPosition, setChildDropPosition] = useState<XYPosition | null>(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number }
    type: 'node' | 'pane' | 'edge'
    targetId?: string
  } | null>(null)

  // Search bar state (Ctrl+F)
  const [showSearchBar, setShowSearchBar] = useState(false)

  // Keyboard shortcuts dialog state (?)
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false)
  const [showConvertButtons, setShowConvertButtons] = useState(false)

  // MiniMap visibility toggle
  const [showMiniMap, setShowMiniMap] = useState(true)

  // Dynamic nodeTypes based on current notation
  const nodeTypes = useNodeTypes()

  /**
   * Validates if a connection between two nodes is allowed.
   * Rules:
   * - START can only be source, never target
   * - END can only be target, never source
   * - No self-connections allowed
   * - No duplicate connections (same source+target+handles)
   */
  const isValidConnection = useCallback(
    (
      connection:
        | Connection
        | { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null },
    ) => {
      const sourceNode = nodes.find((n) => n.id === connection.source)
      const targetNode = nodes.find((n) => n.id === connection.target)

      if (!sourceNode || !targetNode) return false

      // START can only be source, never target
      if (targetNode.type === 'start') return false

      // END can only be target, never source
      if (sourceNode.type === 'end') return false

      // Prevent self-connections
      if (connection.source === connection.target) return false

      // Prevent duplicate connections
      const existingEdge = edges.find(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          e.sourceHandle === connection.sourceHandle &&
          e.targetHandle === connection.targetHandle,
      )
      if (existingEdge) return false

      if (
        !isTryCatchConnectionValid({ source: connection.source ?? '', target: connection.target ?? '' }, nodes, edges)
      ) {
        return false
      }

      return true
    },
    [nodes, edges],
  )

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'conditional' as const,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 8,
        height: 8,
        color: '#64748b',
      },
      style: {
        stroke: '#64748b',
        strokeWidth: 2,
      },
    }),
    [],
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      if (!canEdit) return

      // Check for library spec first (more specific MIME type)
      const specData = event.dataTransfer.getData('application/trajectory-spec')
      if (specData) {
        try {
          const spec = JSON.parse(specData) as {
            id: string
            name: string
            description: string | null
            data: Record<string, unknown>
            libraryId: string
          }

          const position = screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          })

          // Determine node type from spec data, default to actionProxyWait
          const nodeType = (spec.data?.type as NodeType) || 'actionProxyWait'

          // Snap the center to 5px grid, then offset to top-left
          const dimensions = getNodeDimensions(nodeType)
          const snappedPosition = {
            x: Math.round(position.x / 5) * 5 - dimensions.width / 2,
            y: Math.round(position.y / 5) * 5 - dimensions.height / 2,
          }

          const newNode: WorkflowNode = {
            id: generateOID(WORKER_STEP),
            type: nodeType,
            position: snappedPosition,
            data: cloneStepData({
              label: spec.name,
              description: spec.description ?? undefined,
              stepType: nodeType,
              // Spread any pre-configured properties from the spec
              inputs: (spec.data?.inputs as ParameterSpec[] | undefined) || [],
              outputs: (spec.data?.outputs as ParameterSpec[] | undefined) || [],
              values: (spec.data?.values as ValueSpec[] | undefined) || [],
              resourceCommands: spec.data?.resourceCommands as StepResourceCommand[] | undefined,
              uiParameters: spec.data?.uiParameters as StepNodeData['uiParameters'],
              select1Options: spec.data?.select1Options as StepNodeData['select1Options'],
              formDocument: spec.data?.formDocument as StepNodeData['formDocument'],
              isa88TargetHandles: spec.data?.isa88TargetHandles as StepNodeData['isa88TargetHandles'],
              isa88SourceHandles: spec.data?.isa88SourceHandles as StepNodeData['isa88SourceHandles'],
              // Carry through other spec data fields
              yesNoYesValue: spec.data?.yesNoYesValue as string | undefined,
              yesNoNoValue: spec.data?.yesNoNoValue as string | undefined,
              yesNoDefaultSelection: spec.data?.yesNoDefaultSelection as StepNodeData['yesNoDefaultSelection'],
              select1InputName: spec.data?.select1InputName as string | undefined,
              select1InputValueType: spec.data?.select1InputValueType as StepNodeData['select1InputValueType'],
              scriptSource: spec.data?.scriptSource as string | undefined,
              scriptLanguage: spec.data?.scriptLanguage as string | undefined,
              actionName: spec.data?.actionName as string | undefined,
              actionLibraryName: spec.data?.actionLibraryName as string | undefined,
              actionVisibility: spec.data?.actionVisibility as StepNodeData['actionVisibility'],
              // Track source for reference
              sourceSpecId: spec.id,
              sourceLibraryId: spec.libraryId,
            } as StepNodeData),
          }

          addNode(newNode)

          // Auto-add the step's environment spec to the parent workflow if not already present
          const stepEnvSpecId = spec.data?.environmentSpecId as string | undefined
          if (stepEnvSpecId) {
            const libStore = useLibraryStore.getState()
            const parentSpecId = libStore.selectedSpecificationId
            if (parentSpecId) {
              const parentSpec = useSpecificationStore.getState().specs.get(parentSpecId)
              if (parentSpec) {
                const parentData = (parentSpec.data || {}) as { environmentSpecIds?: string[] }
                const existing = parentData.environmentSpecIds || []
                if (!existing.includes(stepEnvSpecId)) {
                  const updatedData = { ...parentSpec.data, environmentSpecIds: [...existing, stepEnvSpecId] }
                  useSpecificationStore
                    .getState()
                    .updateInMemory(parentSpecId, { data: updatedData as Record<string, unknown> })
                }
              }
            }
          }

          return
        } catch (e) {
          console.error('Failed to parse spec data:', e)
        }
      }

      // Fallback: handle step palette drops (application/reactflow)
      const type = event.dataTransfer.getData('application/reactflow') as NodeType
      if (!type) return

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      // Snap the center to 5px grid, then offset to top-left
      const dimensions = getNodeDimensions(type)
      const snappedPosition = {
        x: Math.round(position.x / 5) * 5 - dimensions.width / 2,
        y: Math.round(position.y / 5) * 5 - dimensions.height / 2,
      }

      // For workflowProxy, show sub-workflow creation dialog with all three options
      if (type === 'workflowProxy') {
        setChildDropPosition(snappedPosition)
        setShowSubWorkflowDialog(true)
        return
      }

      const newNode: WorkflowNode = {
        id: generateOID(WORKER_STEP),
        type,
        position: snappedPosition,
        data: defaultStepData(type, getDefaultLabel(type)),
      }

      addNode(newNode)
    },
    [canEdit, screenToFlowPosition, addNode],
  )

  // Get the current workflow specification ID
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)

  // Handle embedded child workflow creation via specificationStore
  const handleCreateChildWorkflow = useCallback(async () => {
    if (!childDropPosition || !selectedLibraryId) return
    const name = childWorkflowName.trim()
    if (!name) {
      setChildNameError('Name is required')
      return
    }

    // Determine root spec ID: use workflowSession root if available, otherwise use current spec
    const rootSpecId = useWorkflowSessionStore.getState().editingRootSpecId || selectedSpecificationId
    if (!rootSpecId) {
      console.warn('No root spec ID for creating child workflow')
      return
    }

    // Pre-validate: check for duplicate name among existing children
    const existingChildren = getChildren(rootSpecId)
    if (existingChildren.some((c) => c.name === name)) {
      setChildNameError('A child workflow with this name already exists')
      return
    }

    // If currently editing a child spec, new child is a grandchild
    const parentId = selectedSpecificationId !== rootSpecId ? selectedSpecificationId : rootSpecId

    const childId = useSpecificationStore.getState().createSpecInMemory({
      parentId,
      libraryId: selectedLibraryId,
      init: { name },
    })

    createEmbeddedSubWorkflow(childDropPosition, childId, selectedLibraryId, name, [], [], [], [])
    setShowChildNameDialog(false)
    setChildWorkflowName('')
    setChildNameError('')
    setChildDropPosition(null)
  }, [childDropPosition, childWorkflowName, selectedLibraryId, selectedSpecificationId, createEmbeddedSubWorkflow])

  // Handle sub-workflow creation from SubWorkflowCreationDialog (all three modes)
  const handleSubWorkflowCreate = useCallback(
    async (result: SubWorkflowCreationResult) => {
      if (!selectedLibraryId || !selectedSpecificationId) {
        console.warn('No library or specification selected for creating sub-workflow')
        return
      }

      if (result.mode === 'reference' && result.referencedSpec && result.referencedLibrary) {
        // Reference mode — link to existing step library spec
        createReferencedSubWorkflow(
          result.position,
          result.referencedSpec.id,
          result.referencedLibrary.id,
          result.referencedSpec.name,
          result.inputs,
          result.outputs,
          result.values,
          result.resourceCommands,
        )
      } else if (result.mode === 'embedded') {
        // Embedded mode — create new child or copy via specificationStore
        const rootSpecId = useWorkflowSessionStore.getState().editingRootSpecId || selectedSpecificationId
        if (!rootSpecId) return

        // If currently editing a child spec (not the root), the new child is a grandchild
        // and parentId points to the current child spec; otherwise use rootSpecId as parent
        const parentId = selectedSpecificationId !== rootSpecId ? selectedSpecificationId : rootSpecId

        if (result.sourceSpec) {
          // Copy mode — deep copy the source spec's data into a new child
          const sourceData = result.sourceSpec.data as Record<string, unknown> | undefined
          const childId = useSpecificationStore.getState().createSpecInMemory({
            parentId,
            libraryId: selectedLibraryId,
            init: {
              name: result.sourceSpec.name,
              description: result.sourceSpec.description ?? undefined,
              data: sourceData ? { ...sourceData } : undefined,
              dataSchemaVersion: result.sourceSpec.dataSchemaVersion,
            },
          })
          createEmbeddedSubWorkflow(
            result.position,
            childId,
            selectedLibraryId,
            result.sourceSpec.name,
            result.inputs || [],
            result.outputs || [],
            result.values || [],
            result.resourceCommands || [],
          )
        } else if (result.newSpecName) {
          // New empty mode — create blank child
          const childId = useSpecificationStore.getState().createSpecInMemory({
            parentId,
            libraryId: selectedLibraryId,
            init: { name: result.newSpecName },
          })
          createEmbeddedSubWorkflow(result.position, childId, selectedLibraryId, result.newSpecName, [], [], [], [])
        }
      }
    },
    [selectedLibraryId, selectedSpecificationId, createReferencedSubWorkflow, createEmbeddedSubWorkflow],
  )

  const requestEditDialog = useFlowStore((s) => s.requestEditDialog)

  const v2OpenNodeId = useFormDocumentStore((s) => s.openNodeId)

  // Handle double-click on nodes - opens edit dialog, or navigates to child workflow
  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const wfNode = node as WorkflowNode
      if (
        wfNode.type === 'workflowProxy' &&
        wfNode.data?.subWorkflowMode === 'embedded' &&
        wfNode.data?.embeddedWorkflowSpecId
      ) {
        // Navigate to the embedded child workflow canvas (use current library context)
        setSelectedSpecification(wfNode.data.embeddedWorkflowSpecId, selectedLibraryId)
        return
      }
      // Block navigation into referenced child workflows
      if (wfNode.type === 'workflowProxy' && wfNode.data?.subWorkflowMode === 'reference') {
        toast.info('A referenced library step can only be edited in the step library.')
        return
      }
      // Open the v2 form designer for form-designable step types.
      if (wfNode.type === 'userInteractionStep' || wfNode.type === 'yesNoStep') {
        useFormDocumentStore.getState().openForNode(wfNode.id, emptyDocument())
        return
      }
      // Open script editor for script steps and gate steps
      if (wfNode.type === 'scriptStep' || wfNode.type === 'gateStep') {
        useFlowStore.getState().requestEditDialog('scriptEditor')
        return
      }
      requestEditDialog('node')
    },
    [requestEditDialog, setSelectedSpecification, selectedLibraryId],
  )

  // Track pane clicks for double-click detection (opens workflow dialog)
  const lastPaneClickRef = useRef<number>(0)
  const onPaneClick = useCallback(() => {
    const now = Date.now()
    if (now - lastPaneClickRef.current < 400) {
      requestEditDialog('workflow')
      lastPaneClickRef.current = 0
    } else {
      lastPaneClickRef.current = now
    }
    // Close context menu on any pane click
    setContextMenu(null)
  }, [requestEditDialog])

  // Context menu handlers — prevent default browser menu, show custom menu
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    setContextMenu({
      position: { x: event.clientX, y: event.clientY },
      type: 'node',
      targetId: node.id,
    })
  }, [])

  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault()
    setContextMenu({
      position: { x: event.clientX, y: event.clientY },
      type: 'pane',
    })
  }, [])

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: { id: string }) => {
    event.preventDefault()
    setContextMenu({
      position: { x: event.clientX, y: event.clientY },
      type: 'edge',
      targetId: edge.id,
    })
  }, [])

  // Keyboard shortcuts: Ctrl+F for search, ? for shortcuts dialog
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input field
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return
      }

      // Ctrl+F: open search bar
      if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setShowSearchBar(true)
        return
      }

      // ?: open shortcuts dialog
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setShowShortcutsDialog(true)
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      <div ref={canvasContainerRef} className="h-full w-full relative" onDragOver={onDragOver} onDrop={onDrop}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          isValidConnection={isValidConnection}
          connectionLineStyle={{ stroke: '#64748b', strokeWidth: 2 }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          onNodeContextMenu={onNodeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onMoveEnd={(_event, viewport) => onMoveEnd?.(viewport)}
          {...(initialViewport ? { defaultViewport: initialViewport } : { fitView: true })}
          panOnDrag={[1, 2]}
          zoomOnScroll
          nodesDraggable={canEdit}
          nodesConnectable={canEdit}
          elementsSelectable={true}
          selectNodesOnDrag={canEdit}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode={['Shift', 'Control']}
          snapToGrid
          snapGrid={[5, 5]}
          connectionRadius={10}
          edgesReconnectable={canEdit}
          deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
          elevateEdgesOnSelect
          edgesFocusable
          minZoom={0.1}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={10} size={1} color="#94a3b8" />

          <Controls showZoom showFitView showInteractive={false} />

          {showMiniMap && <MiniMap nodeColor={miniMapNodeColor} nodeStrokeWidth={3} pannable zoomable />}

          {/* Canvas toolbar with export/import */}
          <Panel position="top-right">
            <CanvasToolbar />
          </Panel>

          {/* Selection toolbar — Align (2+) and Distribute (3+) dropdowns */}
          <Panel position="top-left">
            <div className="flex items-center gap-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-sm">
              <AlignDropdown />
              <DistributeDropdown />
            </div>
          </Panel>

          {!canEdit && (
            <Panel position="bottom-center">
              <div className="flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 px-3 py-1 text-xs font-medium text-amber-800 dark:text-amber-200 shadow-sm">
                <Lock className="h-3 w-3" />
                Read-only
              </div>
            </Panel>
          )}
        </ReactFlow>

        {/* MiniMap toggle button (bottom-left) */}
        <button
          onClick={() => setShowMiniMap((prev) => !prev)}
          className="absolute bottom-2 left-2 z-10 p-1.5 rounded bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
          title={showMiniMap ? 'Hide minimap' : 'Show minimap'}
        >
          <Map className="h-4 w-4" />
        </button>

        {/* Canvas search bar (Ctrl+F) */}
        {showSearchBar && <CanvasSearchBar onClose={() => setShowSearchBar(false)} />}

        {/* Context menu (right-click) */}
        <CanvasContextMenu
          position={contextMenu?.position ?? null}
          type={contextMenu?.type ?? 'pane'}
          targetId={contextMenu?.targetId}
          onClose={() => setContextMenu(null)}
          canEdit={canEdit}
          onConvertButtons={() => setShowConvertButtons(true)}
        />
      </div>

      <ConvertButtonsDialog open={showConvertButtons} onClose={() => setShowConvertButtons(false)} />

      {/* Keyboard shortcuts dialog (?) */}
      <KeyboardShortcutsDialog open={showShortcutsDialog} onClose={() => setShowShortcutsDialog(false)} />

      {/* Sub-workflow creation dialog (reference mode) */}
      <SubWorkflowCreationDialog
        open={showSubWorkflowDialog}
        onClose={() => setShowSubWorkflowDialog(false)}
        onCreate={handleSubWorkflowCreate}
        position={childDropPosition}
      />

      {/* Child workflow name dialog (embedded mode via child specification store) */}
      <Dialog
        open={showChildNameDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowChildNameDialog(false)
            setChildWorkflowName('')
            setChildNameError('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Sub-Workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Input
              value={childWorkflowName}
              onChange={(e) => {
                setChildWorkflowName(e.target.value)
                setChildNameError('')
              }}
              placeholder="Sub-workflow name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateChildWorkflow()
              }}
            />
            {childNameError && <p className="text-xs text-red-500">{childNameError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChildNameDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateChildWorkflow}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Form designer modal (lazy-loaded, opens on double-click of userInteractionStep/yesNoStep) */}
      <Suspense fallback={null}>{v2OpenNodeId && <FormDocumentDesignerModal />}</Suspense>
    </>
  )
}
