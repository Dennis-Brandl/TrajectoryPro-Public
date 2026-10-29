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

import type { Connection, EdgeChange, NodeChange, Edge, XYPosition } from '@xyflow/react'
import type {
  StepNodeData,
  WorkflowNode,
  ParameterSpec,
  ValueSpec,
  ResourceSpec,
  StepResourceCommand,
  TrySpec,
} from '@/types/nodes'
import type { ConditionalEdgeData } from '@/types/edges'
import type { Specification } from '@/stores/specificationStore/types'

/** React Flow viewport shape (pan + zoom). */
export type Viewport = { x: number; y: number; zoom: number }

/**
 * Flow state interface for the Zustand store.
 * Contains all diagram state and actions for manipulating nodes and edges.
 */
export interface FlowState {
  // ============================================================
  // State
  // ============================================================

  /** All nodes in the current diagram */
  nodes: WorkflowNode[]

  /** All edges connecting nodes */
  edges: Edge[]

  /** Current React Flow viewport (x, y pan + zoom) */
  viewport: { x: number; y: number; zoom: number }

  // ============================================================
  // Workflow-Level Properties
  // These apply to the entire workflow specification
  // ============================================================

  /** Workflow-level input parameter specifications */
  workflowInputs: ParameterSpec[]

  /** Workflow-level output parameter specifications */
  workflowOutputs: ParameterSpec[]

  /** Workflow-level value property specifications */
  workflowValues: ValueSpec[]

  /** Workflow-level resource property specifications */
  workflowResources: ResourceSpec[]

  /** Workflow-level TRY fallback rows (spec 2026-08-22) */
  workflowTrySpecifications: TrySpec[]

  // ============================================================
  // React Flow Callbacks
  // These are passed directly to ReactFlow component props
  // ============================================================

  /**
   * Handle node changes from React Flow (position, selection, removal, etc.)
   * Called by ReactFlow's onNodesChange prop
   */
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void

  /**
   * Handle edge changes from React Flow (selection, removal, etc.)
   * Called by ReactFlow's onEdgesChange prop
   */
  onEdgesChange: (changes: EdgeChange[]) => void

  /**
   * Handle new connections between nodes
   * Called by ReactFlow's onConnect prop
   */
  onConnect: (connection: Connection) => void

  // ============================================================
  // Actions
  // These are called by our application code
  // ============================================================

  /** Replace all nodes */
  setNodes: (nodes: WorkflowNode[]) => void

  /** Replace all edges */
  setEdges: (edges: Edge[]) => void

  /** Add a single node to the diagram */
  addNode: (node: WorkflowNode) => void

  /** Update data properties of an existing node */
  updateNodeData: (nodeId: string, data: Partial<StepNodeData>) => void

  /** Spec 2026-09-04 §6.4.3: update several nodes' data in one set + one write-through
   *  ("Update all"). Bumps `nodeDataRevision` so an open properties panel re-seeds. */
  updateNodesData: (entries: Array<{ id: string; data: Partial<StepNodeData> }>) => void

  /** Incremented by updateNodesData; the properties panel re-seeds its draft when it changes. */
  nodeDataRevision: number

  /**
   * Rename a CATCH id across the entire canvas in one undo step.
   * Updates the CATCH node's `catchId` and every TRY step's `trySpecifications[].catch_id`
   * that references `oldId`. No-op when `oldId === newId`.
   */
  renameCatchId: (oldId: string, newId: string) => void

  /** Select a single node by id, deselecting all others. Drives the properties panel. */
  selectNode: (id: string) => void

  /** Update data properties of an existing edge */
  updateEdgeData: (edgeId: string, data: Partial<ConditionalEdgeData>) => void

  /** Delete all currently selected nodes and their connected edges */
  deleteSelectedNodes: () => void

  /**
   * Align the currently-selected nodes against a shared edge or center of
   * the selection's bounding box. No-op when fewer than 2 nodes are selected.
   *
   * - 'left'    — set each x to bbox.minX
   * - 'centerH' — center each node horizontally on bbox center x
   * - 'right'   — set each x so right edge = bbox.maxX
   * - 'top'     — set each y to bbox.minY
   * - 'centerV' — center each node vertically on bbox center y
   * - 'bottom'  — set each y so bottom edge = bbox.maxY
   */
  alignSelectedNodes: (kind: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => void

  /**
   * Distribute the currently-selected nodes evenly along the chosen axis.
   * The leftmost/topmost and rightmost/bottommost nodes anchor the range;
   * the middle nodes are repositioned so the gaps between them are equal.
   * No-op when fewer than 3 nodes are selected.
   */
  distributeSelectedNodes: (axis: 'horizontal' | 'vertical') => void

  // ============================================================
  // Workflow-Level Property Actions
  // ============================================================

  /** Update workflow-level input parameters */
  setWorkflowInputs: (inputs: ParameterSpec[]) => void

  /** Update workflow-level output parameters */
  setWorkflowOutputs: (outputs: ParameterSpec[]) => void

  /** Update workflow-level value properties */
  setWorkflowValues: (values: ValueSpec[]) => void

  /** Update workflow-level resource properties */
  setWorkflowResources: (resources: ResourceSpec[]) => void

  /** Update workflow-level TRY fallback rows */
  setWorkflowTrySpecifications: (tries: TrySpec[]) => void

  // ============================================================
  // Draft Persistence
  // ============================================================

  /** ISO timestamp when draft was last saved to IndexedDB */
  draftAt: string | null

  /** True if recovered from a persisted draft on hydration */
  hasDraft: boolean

  /** Clear the draft flag after user accepts/discards */
  clearDraft: () => void

  // ============================================================
  // Hydration tracking
  // ============================================================

  /**
   * The specification id whose nodes/edges are currently mirrored into this
   * flowStore. `writeThroughToSpec` checks this before writing back to the
   * spec store — without it, React Flow change events that fire before the
   * route's hydration effect runs (mount, viewport recalc, dimension
   * measurement) overwrite the live spec's nodes/edges with the flowStore's
   * empty default arrays, silently wiping the user's workflow.
   * Set by the route effect after `setNodes`/`setEdges` populate the canvas.
   */
  hydratedSpecId: string | null

  /** Mark the flowStore as hydrated for the given spec id (or clear it). */
  setHydratedSpecId: (specId: string | null) => void

  // ============================================================
  // Sub-Workflow Creation Actions
  // ============================================================

  /** Create an embedded sub-workflow node (for new/copy modes) */
  createEmbeddedSubWorkflow: (
    position: XYPosition,
    embeddedSpecId: string,
    embeddedLibraryId: string,
    label: string,
    inputs?: ParameterSpec[],
    outputs?: ParameterSpec[],
    values?: ValueSpec[],
    resourceCommands?: StepResourceCommand[],
  ) => void

  /** Create a referenced sub-workflow node */
  createReferencedSubWorkflow: (
    position: XYPosition,
    referencedSpecId: string,
    referencedLibraryId: string,
    referencedSpecName: string,
    inputs?: ParameterSpec[],
    outputs?: ParameterSpec[],
    values?: ValueSpec[],
    resourceCommands?: StepResourceCommand[],
  ) => void

  // ============================================================
  // UI Dialog Requests (not persisted, not tracked in undo)
  // ============================================================

  /** Signal to open an edit dialog from canvas double-click */
  editDialogRequest: 'node' | 'workflow' | 'scriptEditor' | null

  /** Request opening an edit dialog */
  requestEditDialog: (type: 'node' | 'workflow' | 'scriptEditor' | null) => void

  // ============================================================
  // Legacy Upgrade Notification
  // Shown once when IndexedDB contains pre-v4.0 nodes that were stripped
  // ============================================================

  /** True when the persist migration removed legacy nodes from IndexedDB state */
  _showLegacyUpgradeNotice: boolean

  /** Dismiss the one-time legacy upgrade notification */
  dismissLegacyUpgradeNotice: () => void

  // ============================================================
  // UI Preferences (persisted, not tracked in undo)
  // ============================================================

  /** Width of the right properties panel in pixels (200-600) */
  propertiesPanelWidth: number

  /** Persist the properties panel width after drag ends */
  setPropertiesPanelWidth: (width: number) => void

  /** Width of the left library sidebar in pixels (200-500) */
  librarySidebarWidth: number

  /** Whether the library sidebar is collapsed to icon rail */
  librarySidebarCollapsed: boolean

  /** Persist the library sidebar width after drag ends */
  setLibrarySidebarWidth: (width: number) => void

  /** Toggle library sidebar collapsed state */
  setLibrarySidebarCollapsed: (collapsed: boolean) => void

  // ============================================================
  // Spec Load (§3.6)
  // ============================================================

  /**
   * Hydrate nodes/edges/viewport from a Specification's data blob.
   * Called when navigating to a spec — does NOT write-through to specificationStore.
   */
  loadFromSpec: (spec: Specification) => void
}
