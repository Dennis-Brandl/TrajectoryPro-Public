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

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { temporal } from 'zundo'
import { applyNodeChanges, applyEdgeChanges, addEdge, type Edge } from '@xyflow/react'

import { indexedDBStorage } from '@/lib/storage'
import type { FlowState } from './types'
import type {
  WorkflowNode,
  StepNodeData,
  ParameterSpec,
  ValueSpec,
  ResourceSpec,
  Select1OptionSpec,
  TrySpec,
} from '@/types/nodes'
import { generateOID, WORKER_STEP, WORKER_INTERNAL } from '@/lib/snowflake'
import { defaultCatchOutputs } from '@/lib/catch-outputs'
import type { Specification } from '@/stores/specificationStore/types'
import { useSpecificationStore } from './specificationStore'
import { useLibraryStore } from './libraryStore'

/**
 * Write-through helper: serializes current flowStore state into specificationStore.updateInMemory.
 * Called from every mutation action so the spec store's dirty-tracking picks up canvas edits
 * and batchSave persists them to the server.
 *
 * NOT called from loadFromSpec (that's a read-side load, not a user edit).
 */
// Module-level pending snapshot for the temporal handleSet debounce (see below).
// Flushed synchronously before undo/redo so a fast undo after a mutation can't
// lose the change to the still-pending 500ms timer.
let pendingSnapshot:
  | {
      handleSet: (state: Partial<FlowState>) => void
      state: Partial<FlowState>
      timer: ReturnType<typeof setTimeout>
    }
  | undefined

function flushPendingSnapshot() {
  if (!pendingSnapshot) return
  clearTimeout(pendingSnapshot.timer)
  const { handleSet, state } = pendingSnapshot
  pendingSnapshot = undefined
  handleSet(state)
}

function writeThroughToSpec() {
  const specId = useLibraryStore.getState().selectedSpecificationId
  if (!specId) return
  const state = useFlowStore.getState()
  // Guard: never write back into a spec that we haven't hydrated this flowStore
  // from. Without this, React Flow events that fire during mount or before
  // `setHydratedSpecId` runs (viewport recalc, selection clear, dimension
  // measurement) overwrite the live spec.data.nodes / data.edges with the
  // flowStore's empty default arrays — silently wiping the user's workflow.
  // The route effect calls setHydratedSpecId(selectedSpecificationId) once it
  // has populated nodes/edges from spec.data.
  if (state.hydratedSpecId !== specId) return
  const existingData = useSpecificationStore.getState().specs.get(specId)?.data ?? {}
  const serializedData = {
    ...existingData,
    nodes: state.nodes,
    edges: state.edges,
    viewport: state.viewport,
    workflowInputs: state.workflowInputs,
    workflowOutputs: state.workflowOutputs,
    workflowValues: state.workflowValues,
    workflowResources: state.workflowResources,
    workflowTrySpecifications: state.workflowTrySpecifications,
  }
  useSpecificationStore.getState().updateInMemory(specId, { data: serializedData })
}

/** The embedded child spec ids referenced by embedded workflowProxy nodes. */
function embeddedChildSpecIds(nodes: WorkflowNode[]): Set<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    const data = node.data as StepNodeData
    if (node.type === 'workflowProxy' && data.subWorkflowMode === 'embedded' && data.embeddedWorkflowSpecId) {
      ids.add(data.embeddedWorkflowSpecId)
    }
  }
  return ids
}

/**
 * When an embedded sub-workflow proxy node is removed from the canvas, the child
 * specification it owns must be deleted too — otherwise it is orphaned. The
 * subtree is snapshotted first (deleteSubWorkflowSubtree) so a later undo can
 * restore it. Reference-mode proxies point at a spec owned elsewhere — untouched.
 */
function cascadeDeleteEmbeddedSubWorkflows(removedNodes: WorkflowNode[]): void {
  const specStore = useSpecificationStore.getState()
  for (const id of embeddedChildSpecIds(removedNodes)) {
    specStore.deleteSubWorkflowSubtree(id)
  }
}

/**
 * Reconcile the spec store after an undo/redo swapped the canvas node set: delete
 * the subtree of any embedded sub-workflow whose proxy node vanished, and restore
 * the subtree of any whose proxy reappeared. When the set changed, the parent's
 * canvas is written through first so its data.nodes never points at a child we
 * just deleted (the orphan in reverse).
 */
export function reconcileSubWorkflowSpecsBetween(beforeNodes: WorkflowNode[], afterNodes: WorkflowNode[]): void {
  const before = embeddedChildSpecIds(beforeNodes)
  const after = embeddedChildSpecIds(afterNodes)
  const removed: string[] = []
  const added: string[] = []
  for (const id of before) if (!after.has(id)) removed.push(id)
  for (const id of after) if (!before.has(id)) added.push(id)
  if (removed.length === 0 && added.length === 0) return

  writeThroughToSpec()
  const specStore = useSpecificationStore.getState()
  for (const id of removed) specStore.deleteSubWorkflowSubtree(id)
  for (const id of added) specStore.restoreSubWorkflowSubtree(id)
}

/**
 * Main Zustand store for diagram state with persistence and undo/redo.
 *
 * Features:
 * - Tracks nodes and edges arrays
 * - Provides React Flow callback handlers (onNodesChange, onEdgesChange, onConnect)
 * - Provides action methods for programmatic updates
 * - Temporal middleware enables undo/redo with 100-state history limit
 * - Persist middleware saves drafts to IndexedDB for crash recovery
 *
 * Usage:
 * ```typescript
 * // In components
 * const nodes = useFlowStore((state) => state.nodes);
 * const { addNode } = useFlowStore.getState();
 *
 * // Undo/redo
 * const { undo, redo } = useFlowStore.temporal.getState();
 * ```
 */
export const useFlowStore = create<FlowState>()(
  temporal(
    persist(
      (set, get) => ({
        // ============================================================
        // Initial State
        // ============================================================
        nodes: [] as WorkflowNode[],
        edges: [] as Edge[],
        viewport: { x: 0, y: 0, zoom: 1 },
        workflowInputs: [] as ParameterSpec[],
        workflowOutputs: [] as ParameterSpec[],
        workflowValues: [] as ValueSpec[],
        workflowResources: [] as ResourceSpec[],
        workflowTrySpecifications: [] as TrySpec[],
        draftAt: null,
        hasDraft: false,
        hydratedSpecId: null as string | null,
        editDialogRequest: null,
        nodeDataRevision: 0,
        _showLegacyUpgradeNotice: false,
        propertiesPanelWidth: 280,
        librarySidebarWidth: 256,
        librarySidebarCollapsed: false,

        // ============================================================
        // React Flow Callbacks
        // ============================================================

        onNodesChange: (changes) => {
          const currentNodes = get().nodes
          // Embedded sub-workflow proxy nodes being removed (e.g. via the Delete
          // key) must take their child specs with them — capture before applying.
          const removedIds = new Set(changes.flatMap((c) => (c.type === 'remove' ? [c.id] : [])))
          const removedNodes = currentNodes.filter((n) => removedIds.has(n.id))
          set({
            nodes: applyNodeChanges(changes, currentNodes),
          })
          writeThroughToSpec()
          cascadeDeleteEmbeddedSubWorkflows(removedNodes)
        },

        onEdgesChange: (changes) => {
          const currentEdges = get().edges
          const currentNodes = get().nodes

          // Check for edge removals that orphan dynamic ISA88 handles
          let needsNodeUpdate = false
          let updatedNodes = currentNodes

          for (const change of changes) {
            if (change.type === 'remove') {
              const removedEdge = currentEdges.find((e) => e.id === change.id)
              if (!removedEdge) continue

              // Clean up orphaned target handles on WaitAny/WaitAll
              if (removedEdge.targetHandle) {
                const targetNode = updatedNodes.find((n) => n.id === removedEdge.target)
                if (targetNode && (targetNode.type === 'waitAny' || targetNode.type === 'waitAll')) {
                  const handles = (targetNode.data.isa88TargetHandles || []) as string[]
                  if (handles.includes(removedEdge.targetHandle)) {
                    const filtered = handles.filter((h) => h !== removedEdge.targetHandle)
                    updatedNodes = updatedNodes.map((n) =>
                      n.id === targetNode.id ? { ...n, data: { ...n.data, isa88TargetHandles: filtered } } : n,
                    )
                    needsNodeUpdate = true
                  }
                }
              }

              // Clean up orphaned source handles on Parallel
              if (removedEdge.sourceHandle) {
                const sourceNode = updatedNodes.find((n) => n.id === removedEdge.source)
                if (sourceNode?.type === 'parallel') {
                  const handles = (sourceNode.data.isa88SourceHandles || []) as string[]
                  if (handles.includes(removedEdge.sourceHandle)) {
                    const filtered = handles.filter((h) => h !== removedEdge.sourceHandle)
                    updatedNodes = updatedNodes.map((n) =>
                      n.id === sourceNode.id ? { ...n, data: { ...n.data, isa88SourceHandles: filtered } } : n,
                    )
                    needsNodeUpdate = true
                  }
                }
              }
            }
          }

          const newEdges = applyEdgeChanges(changes, currentEdges)
          if (needsNodeUpdate) {
            set({ edges: newEdges, nodes: updatedNodes })
          } else {
            set({ edges: newEdges })
          }
          writeThroughToSpec()
        },

        onConnect: (connection) => {
          const sourceNode = get().nodes.find((n) => n.id === connection.source)

          // For select1 nodes connecting from the "default" handle, auto-create a new option
          if (sourceNode?.type === 'select1' && connection.sourceHandle === 'default') {
            const existingOptions = (sourceNode.data.select1Options || []) as Select1OptionSpec[]
            const nextNumber = existingOptions.length + 1
            const newOptionId = generateOID(WORKER_INTERNAL)
            const newOption: Select1OptionSpec = {
              id: newOptionId,
              label: String(nextNumber),
              operator: '==',
              value: '',
              valueType: 'literal',
              isDefault: false,
            }
            // Update node data with the new option
            const updatedOptions = [...existingOptions, newOption]
            const updatedNodes = get().nodes.map((n) =>
              n.id === sourceNode.id ? { ...n, data: { ...n.data, select1Options: updatedOptions } } : n,
            )
            // Create edge pointing to the new option handle (not "default")
            const newEdge = {
              ...connection,
              sourceHandle: newOptionId,
              type: 'conditional',
              data: { connectionId: newOptionId },
            }
            set({
              nodes: updatedNodes,
              edges: addEdge(newEdge, get().edges),
            })
            writeThroughToSpec()
            return
          }

          // For waitAny/waitAll connecting to the "default" target handle, auto-create a new target handle
          const targetNode = get().nodes.find((n) => n.id === connection.target)
          if (
            (targetNode?.type === 'waitAny' || targetNode?.type === 'waitAll') &&
            connection.targetHandle === 'default'
          ) {
            const existingHandles = (targetNode.data.isa88TargetHandles || []) as string[]
            const newHandleId = generateOID(WORKER_INTERNAL)
            const updatedHandles = [...existingHandles, newHandleId]
            const updatedNodes = get().nodes.map((n) =>
              n.id === targetNode.id ? { ...n, data: { ...n.data, isa88TargetHandles: updatedHandles } } : n,
            )
            const newEdge = {
              ...connection,
              targetHandle: newHandleId,
              type: 'conditional',
            }
            set({
              nodes: updatedNodes,
              edges: addEdge(newEdge, get().edges),
            })
            writeThroughToSpec()
            return
          }

          // For parallel connecting from the "default" source handle, auto-create a new source handle
          if (sourceNode?.type === 'parallel' && connection.sourceHandle === 'default') {
            const existingHandles = (sourceNode.data.isa88SourceHandles || []) as string[]
            const newHandleId = generateOID(WORKER_INTERNAL)
            const updatedHandles = [...existingHandles, newHandleId]
            const updatedNodes = get().nodes.map((n) =>
              n.id === sourceNode.id ? { ...n, data: { ...n.data, isa88SourceHandles: updatedHandles } } : n,
            )
            const newEdge = {
              ...connection,
              sourceHandle: newHandleId,
              type: 'conditional',
            }
            set({
              nodes: updatedNodes,
              edges: addEdge(newEdge, get().edges),
            })
            writeThroughToSpec()
            return
          }

          // For select1 nodes connecting from an existing option handle
          let edgeData: Record<string, unknown> | undefined
          if (sourceNode?.type === 'select1' && connection.sourceHandle) {
            edgeData = { connectionId: connection.sourceHandle }
          }

          const newEdge = {
            ...connection,
            type: 'conditional',
            data: edgeData,
          }
          set({
            edges: addEdge(newEdge, get().edges),
          })
          writeThroughToSpec()
        },

        // ============================================================
        // Actions
        // ============================================================

        setHydratedSpecId: (specId) => {
          set({ hydratedSpecId: specId })
        },

        setNodes: (nodes) => {
          set({ nodes })
          writeThroughToSpec()
        },

        setEdges: (edges) => {
          set({ edges })
          writeThroughToSpec()
        },

        addNode: (node) => {
          // Seed the four runtime-supplied trigger-info outputs on a fresh CATCH
          // (covers click-to-add and both drop paths, which all route through here).
          let toAdd = node
          if (node.type === 'catch' && !(node.data as { outputs?: unknown[] }).outputs?.length) {
            toAdd = { ...node, data: { ...node.data, outputs: defaultCatchOutputs() } }
          }
          set({ nodes: [...get().nodes, toAdd] })
          writeThroughToSpec()
        },

        updateNodeData: (nodeId, data) => {
          const currentNodes = get().nodes
          set({
            nodes: currentNodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n)),
          })
          writeThroughToSpec()
        },

        updateNodesData: (entries) => {
          if (entries.length === 0) return
          const byId = new Map(entries.map((e) => [e.id, e.data]))
          set({
            nodes: get().nodes.map((n) => (byId.has(n.id) ? { ...n, data: { ...n.data, ...byId.get(n.id) } } : n)),
            nodeDataRevision: get().nodeDataRevision + 1,
          })
          writeThroughToSpec()
        },

        renameCatchId: (oldId, newId) => {
          if (oldId === newId) return
          const wfTries = get().workflowTrySpecifications
          set({
            nodes: get().nodes.map((n) => {
              if (n.type === 'catch' && (n.data as { catchId?: string }).catchId === oldId) {
                return { ...n, data: { ...n.data, catchId: newId } }
              }
              const ts = (n.data as { trySpecifications?: TrySpec[] }).trySpecifications
              if (Array.isArray(ts) && ts.some((t) => t.catch_id === oldId)) {
                return {
                  ...n,
                  data: {
                    ...n.data,
                    trySpecifications: ts.map((t): TrySpec => (t.catch_id === oldId ? { ...t, catch_id: newId } : t)),
                  },
                }
              }
              return n
            }),
            workflowTrySpecifications: wfTries.some((t) => t.catch_id === oldId)
              ? wfTries.map((t) => (t.catch_id === oldId ? { ...t, catch_id: newId } : t))
              : wfTries,
          })
          writeThroughToSpec()
        },

        selectNode: (id) => {
          set({ nodes: get().nodes.map((n) => ({ ...n, selected: n.id === id })) })
        },

        updateEdgeData: (edgeId, data) => {
          set({
            edges: get().edges.map((edge) =>
              edge.id === edgeId ? { ...edge, data: { ...edge.data, ...data } } : edge,
            ),
          })
          writeThroughToSpec()
        },

        deleteSelectedNodes: () => {
          const selectedNodes = get().nodes.filter((n) => n.selected)
          const selectedNodeIds = selectedNodes.map((n) => n.id)

          if (selectedNodeIds.length === 0) return

          set({
            nodes: get().nodes.filter((n) => !n.selected),
            edges: get().edges.filter(
              (e) => !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target),
            ),
          })
          writeThroughToSpec()
          cascadeDeleteEmbeddedSubWorkflows(selectedNodes)
        },

        alignSelectedNodes: (kind) => {
          const nodes = get().nodes
          const selected = nodes.filter((n) => n.selected)
          if (selected.length < 2) return

          // React Flow records measured dimensions on each node after layout;
          // fall back to 200x60 for the (rare) unmeasured case so alignment
          // still produces a sensible result.
          const dim = (n: (typeof selected)[number]) => ({
            w: n.measured?.width ?? 200,
            h: n.measured?.height ?? 60,
          })

          const lefts = selected.map((n) => n.position.x)
          const tops = selected.map((n) => n.position.y)
          const rights = selected.map((n) => n.position.x + dim(n).w)
          const bottoms = selected.map((n) => n.position.y + dim(n).h)
          const minX = Math.min(...lefts)
          const minY = Math.min(...tops)
          const maxX = Math.max(...rights)
          const maxY = Math.max(...bottoms)
          const centerX = (minX + maxX) / 2
          const centerY = (minY + maxY) / 2

          const newPositions = new Map<string, { x: number; y: number }>()
          for (const n of selected) {
            const { w, h } = dim(n)
            switch (kind) {
              case 'left':
                newPositions.set(n.id, { x: minX, y: n.position.y })
                break
              case 'centerH':
                newPositions.set(n.id, { x: centerX - w / 2, y: n.position.y })
                break
              case 'right':
                newPositions.set(n.id, { x: maxX - w, y: n.position.y })
                break
              case 'top':
                newPositions.set(n.id, { x: n.position.x, y: minY })
                break
              case 'centerV':
                newPositions.set(n.id, { x: n.position.x, y: centerY - h / 2 })
                break
              case 'bottom':
                newPositions.set(n.id, { x: n.position.x, y: maxY - h })
                break
            }
          }

          set({
            nodes: nodes.map((n) => {
              const next = newPositions.get(n.id)
              return next ? { ...n, position: next } : n
            }),
          })
          writeThroughToSpec()
        },

        distributeSelectedNodes: (axis) => {
          const nodes = get().nodes
          const selected = nodes.filter((n) => n.selected)
          if (selected.length < 3) return

          const dim = (n: (typeof selected)[number]) => ({
            w: n.measured?.width ?? 200,
            h: n.measured?.height ?? 60,
          })

          // Sort by primary axis position, anchor leftmost/topmost and
          // rightmost/bottommost, distribute the middle nodes with even gaps.
          const sorted = [...selected].sort((a, b) =>
            axis === 'horizontal' ? a.position.x - b.position.x : a.position.y - b.position.y,
          )
          const first = sorted[0]
          const last = sorted[sorted.length - 1]

          const start = axis === 'horizontal' ? first.position.x : first.position.y
          const end = axis === 'horizontal' ? last.position.x + dim(last).w : last.position.y + dim(last).h
          const totalSpan =
            axis === 'horizontal' ? sorted.reduce((s, n) => s + dim(n).w, 0) : sorted.reduce((s, n) => s + dim(n).h, 0)
          const gap = (end - start - totalSpan) / (sorted.length - 1)

          const newPositions = new Map<string, { x: number; y: number }>()
          let cursor = start
          for (const n of sorted) {
            const { w, h } = dim(n)
            if (axis === 'horizontal') {
              newPositions.set(n.id, { x: cursor, y: n.position.y })
              cursor += w + gap
            } else {
              newPositions.set(n.id, { x: n.position.x, y: cursor })
              cursor += h + gap
            }
          }

          set({
            nodes: nodes.map((n) => {
              const next = newPositions.get(n.id)
              return next ? { ...n, position: next } : n
            }),
          })
          writeThroughToSpec()
        },

        // ============================================================
        // Workflow-Level Property Actions
        // ============================================================

        setWorkflowInputs: (inputs) => {
          set({ workflowInputs: inputs })
          writeThroughToSpec()
        },

        setWorkflowOutputs: (outputs) => {
          set({ workflowOutputs: outputs })
          writeThroughToSpec()
        },

        setWorkflowValues: (values) => {
          set({ workflowValues: values })
          writeThroughToSpec()
        },

        setWorkflowResources: (resources) => {
          set({ workflowResources: resources })
          writeThroughToSpec()
        },

        setWorkflowTrySpecifications: (tries) => {
          set({ workflowTrySpecifications: tries })
          writeThroughToSpec()
        },

        // ============================================================
        // Draft Actions
        // ============================================================

        clearDraft: () => {
          set({ hasDraft: false })
        },

        requestEditDialog: (type) => {
          set({ editDialogRequest: type })
        },

        dismissLegacyUpgradeNotice: () => {
          set({ _showLegacyUpgradeNotice: false })
        },

        setPropertiesPanelWidth: (width) => {
          set({ propertiesPanelWidth: width })
        },

        setLibrarySidebarWidth: (width) => {
          set({ librarySidebarWidth: width })
        },

        setLibrarySidebarCollapsed: (collapsed) => {
          set({ librarySidebarCollapsed: collapsed })
        },

        // ============================================================
        // Sub-Workflow Creation Actions
        // ============================================================

        createEmbeddedSubWorkflow: (
          position,
          embeddedSpecId,
          embeddedLibraryId,
          label,
          inputs,
          outputs,
          values,
          resourceCommands,
        ) => {
          const newNode: WorkflowNode = {
            id: generateOID(WORKER_STEP),
            type: 'workflowProxy',
            position,
            data: {
              label,
              stepType: 'workflowProxy',
              subWorkflowMode: 'embedded',
              embeddedWorkflowSpecId: embeddedSpecId,
              embeddedWorkflowLibraryId: embeddedLibraryId,
              inputs: inputs || [],
              outputs: outputs || [],
              values: values || [],
              resourceCommands: resourceCommands || [],
            },
          }
          set({ nodes: [...get().nodes, newNode] })
          writeThroughToSpec()
        },

        createReferencedSubWorkflow: (
          position,
          referencedSpecId,
          referencedLibraryId,
          referencedSpecName,
          inputs,
          outputs,
          values,
          resourceCommands,
        ) => {
          const newNode: WorkflowNode = {
            id: generateOID(WORKER_STEP),
            type: 'workflowProxy',
            position,
            data: {
              label: referencedSpecName,
              stepType: 'workflowProxy',
              subWorkflowMode: 'reference',
              referencedStepSpecId: referencedSpecId,
              referencedStepLibraryId: referencedLibraryId,
              referencedStepName: referencedSpecName,
              inputs: inputs || [],
              outputs: outputs || [],
              values: values || [],
              resourceCommands: resourceCommands || [],
            },
          }
          set({ nodes: [...get().nodes, newNode] })
          writeThroughToSpec()
        },

        // ============================================================
        // Spec Load (§3.6)
        // ============================================================

        loadFromSpec: (spec: Specification) => {
          const data = spec.data as Record<string, unknown>
          const nodes = Array.isArray(data.nodes) ? (data.nodes as WorkflowNode[]) : []
          const edges = Array.isArray(data.edges) ? (data.edges as Edge[]) : []
          set({ nodes, edges })
          if (data.viewport && typeof data.viewport === 'object') {
            set({ viewport: data.viewport as { x: number; y: number; zoom: number } })
          }
          // Do NOT call writeThroughToSpec — this is a read-side load, not a user edit.
        },
      }),
      {
        // Persist middleware configuration
        name: 'mission-draft',
        storage: createJSONStorage(() => indexedDBStorage),
        version: 2,

        // Migration: version 1 → 2 strips legacy UI step nodes and orphaned edges
        migrate: (persistedState: unknown, version: number) => {
          if (version < 2) {
            const state = persistedState as Record<string, unknown>
            const nodes = (state.nodes || []) as Array<{ type?: string; id?: string }>
            const edges = (state.edges || []) as Array<{ source?: string; target?: string }>

            const LEGACY_TYPES = new Set(['instructionStep', 'textInputStep', 'pickOneStep', 'checkboxStep'])

            // Filter out legacy nodes and track their IDs
            const legacyNodeIds = new Set<string>()
            const cleanNodes = nodes.filter((n) => {
              if (n.type && LEGACY_TYPES.has(n.type)) {
                if (n.id) legacyNodeIds.add(n.id)
                return false
              }
              return true
            })

            // Filter out orphaned edges connected to removed legacy nodes
            const cleanEdges = edges.filter(
              (e) => !legacyNodeIds.has(e.source || '') && !legacyNodeIds.has(e.target || ''),
            )

            const hadLegacy = legacyNodeIds.size > 0

            return {
              ...state,
              nodes: cleanNodes,
              edges: cleanEdges,
              _legacyNodesRemoved: hadLegacy,
            }
          }
          return persistedState
        },

        // Only persist diagram data, workflow properties, draft timestamp, and UI preferences
        partialize: (state) => ({
          nodes: state.nodes,
          edges: state.edges,
          workflowInputs: state.workflowInputs,
          workflowOutputs: state.workflowOutputs,
          workflowValues: state.workflowValues,
          workflowResources: state.workflowResources,
          workflowTrySpecifications: state.workflowTrySpecifications,
          draftAt: new Date().toISOString(),
          propertiesPanelWidth: state.propertiesPanelWidth,
          librarySidebarWidth: state.librarySidebarWidth,
          librarySidebarCollapsed: state.librarySidebarCollapsed,
        }),

        // Handle rehydration from IndexedDB
        onRehydrateStorage: () => (state, error) => {
          if (error) {
            console.error('Failed to rehydrate draft:', error)
            return
          }
          const hasContent =
            state &&
            (state.nodes.length > 0 ||
              state.edges.length > 0 ||
              state.workflowInputs?.length > 0 ||
              state.workflowOutputs?.length > 0 ||
              state.workflowValues?.length > 0 ||
              state.workflowResources?.length > 0 ||
              state.workflowTrySpecifications?.length > 0)
          if (hasContent) {
            // Draft exists with content - mark for recovery dialog
            // Use setTimeout to defer until after React is fully initialized
            setTimeout(() => {
              useFlowStore.setState({
                hasDraft: true,
                draftAt: state.draftAt,
              })
            }, 0)
          }
          // If the migration removed legacy nodes, show the one-time upgrade notification
          if (state && (state as unknown as Record<string, unknown>)._legacyNodesRemoved) {
            setTimeout(() => {
              useFlowStore.setState({ _showLegacyUpgradeNotice: true })
            }, 100)
          }
        },
      },
    ),
    {
      // Temporal middleware configuration
      // Limits history to 50 states to balance memory usage and undo depth
      limit: 50,

      // Throttle undo snapshots so continuous drags produce one snapshot instead of many.
      // Without this, every pixel of a drag creates a new undo entry.
      // Pending snapshots are flushed synchronously when undo/redo is invoked
      // (see override below) so a fast undo never silently drops the change.
      handleSet: (handleSet) => {
        return (state) => {
          if (pendingSnapshot) clearTimeout(pendingSnapshot.timer)
          const snapshot = {
            handleSet,
            state,
            timer: setTimeout(() => {
              pendingSnapshot = undefined
              handleSet(state)
            }, 500),
          }
          pendingSnapshot = snapshot as unknown as NonNullable<typeof pendingSnapshot>
        }
      },

      // Only track nodes, edges, and workflow-level properties in history
      // Excludes callback functions which don't need undo/redo
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
        workflowInputs: state.workflowInputs,
        workflowOutputs: state.workflowOutputs,
        workflowValues: state.workflowValues,
        workflowResources: state.workflowResources,
        workflowTrySpecifications: state.workflowTrySpecifications,
      }),

      // Don't create undo snapshots for changes that differ ONLY in React Flow's
      // transient node fields (measured dimensions, selection, drag flag). React
      // Flow re-measures nodes whenever one is added/removed; without this filter
      // those measurement passes push spurious history entries AND clear the redo
      // stack, so an undo lands on a measurement state instead of the user's edit
      // and redo silently stops working. Compare only the meaningful fields.
      equality: (pastState, currentState) => {
        const norm = (s: typeof pastState) =>
          JSON.stringify({
            nodes: s.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
            edges: s.edges,
            workflowInputs: s.workflowInputs,
            workflowOutputs: s.workflowOutputs,
            workflowValues: s.workflowValues,
            workflowResources: s.workflowResources,
            workflowTrySpecifications: s.workflowTrySpecifications,
          })
        return norm(pastState) === norm(currentState)
      },
    },
  ),
)

// Wrap temporal.undo/redo so any pending debounced snapshot is committed before
// we walk the history. Without this, a fast undo immediately after a mutation
// would find no snapshot and silently do nothing.
{
  const temporalStore = useFlowStore.temporal
  const initial = temporalStore.getState()
  const wrappedUndo = (steps?: number) => {
    flushPendingSnapshot()
    const before = useFlowStore.getState().nodes
    initial.undo(steps)
    // nodeDataRevision is excluded from both partializes (it must not itself become an
    // undoable change), so undo/redo never touch it on their own — bump it here so an open
    // NodeInlineEditor re-seeds its draft from the restored nodes (spec §6.4.2, final review
    // #2). Otherwise the panel's stale draft would autosave back over the undo.
    useFlowStore.setState({ nodeDataRevision: useFlowStore.getState().nodeDataRevision + 1 })
    reconcileSubWorkflowSpecsBetween(before, useFlowStore.getState().nodes)
  }
  const wrappedRedo = (steps?: number) => {
    flushPendingSnapshot()
    const before = useFlowStore.getState().nodes
    initial.redo(steps)
    useFlowStore.setState({ nodeDataRevision: useFlowStore.getState().nodeDataRevision + 1 })
    reconcileSubWorkflowSpecsBetween(before, useFlowStore.getState().nodes)
  }
  temporalStore.setState({ undo: wrappedUndo, redo: wrappedRedo })
}
