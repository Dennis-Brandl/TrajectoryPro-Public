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

import { createFileRoute } from '@tanstack/react-router'
import React, { useEffect, useRef, useState } from 'react'
import { ReactFlowProvider, type Edge, type Viewport } from '@xyflow/react'
import type { WorkflowNode, ParameterSpec, ValueSpec, ResourceSpec, TrySpec } from '@/types/nodes'
import { FlowCanvas, SpecificationHeader } from '@/components/canvas'
import { StepPalette } from '@/components/palette'
import { PropertiesPanel } from '@/components/properties'
import { LibrarySidebar } from '@/components/library'
import { EnvironmentDetailView, ActionDetailView, LibraryDetailView, WorkflowPlaceholder } from '@/components/detail'
import { NotationSwitcher } from '@/components/toolbar/NotationSwitcher'
import { ContextBreadcrumb } from '@/components/toolbar/ContextBreadcrumb'
import { DraftRecoveryDialog, LegacyUpgradeDialog } from '@/components/draft'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AboutDialog } from '@/components/about/AboutDialog'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useNotationStore, resolveSpecNotation } from '@/stores/notationStore'
import { useWorkflowSessionStore } from '@/stores/workflowSessionStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { clearSubWorkflowUndoBuffer } from '@/stores/specificationStore/subWorkflowUndo'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { normalizeCatchOutputsInNodes } from '@/lib/catch-outputs'
import { useCopyPaste } from '@/hooks/useCopyPaste'
import { useAutoLayout } from '@/hooks/useAutoLayout'
import { Button } from '@mission/ui'
import { ArrowLeft, LayoutGrid, Undo2, Redo2, PanelRight, PanelLeft, Sun, Moon, HelpCircle } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'

/**
 * Outer wrapper that provides ReactFlow context.
 * This enables hooks like useCopyPaste and useAutoLayout to access ReactFlow APIs.
 */
function WorkflowEditor() {
  return (
    <ErrorBoundary>
      <ReactFlowProvider>
        <WorkflowEditorInner />
      </ReactFlowProvider>
    </ErrorBoundary>
  )
}

/**
 * Inner component that contains the actual editor UI.
 * Must be inside ReactFlowProvider for hooks to work.
 */
function WorkflowEditorInner() {
  useBeforeUnload()
  const setNodes = useFlowStore((state) => state.setNodes)
  const setEdges = useFlowStore((state) => state.setEdges)
  const setWorkflowInputs = useFlowStore((state) => state.setWorkflowInputs)
  const setWorkflowOutputs = useFlowStore((state) => state.setWorkflowOutputs)
  const setWorkflowValues = useFlowStore((state) => state.setWorkflowValues)
  const setWorkflowResources = useFlowStore((state) => state.setWorkflowResources)
  const setWorkflowTrySpecifications = useFlowStore((state) => state.setWorkflowTrySpecifications)
  const setHydratedSpecId = useFlowStore((state) => state.setHydratedSpecId)
  const nodes = useFlowStore((state) => state.nodes)
  const edges = useFlowStore((state) => state.edges)
  const workflowInputs = useFlowStore((state) => state.workflowInputs)
  const workflowOutputs = useFlowStore((state) => state.workflowOutputs)
  const workflowValues = useFlowStore((state) => state.workflowValues)
  const workflowResources = useFlowStore((state) => state.workflowResources)
  const workflowTrySpecifications = useFlowStore((state) => state.workflowTrySpecifications)
  const fetchLibraries = useLibraryStore((state) => state.fetchLibraries)
  const activeEntityType = useLibraryStore((state) => state.activeEntityType)
  const selectedSpecificationId = useLibraryStore((state) => state.selectedSpecificationId)
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId)
  const specifications = useLibraryStore((state) => state.specifications)
  const setSelectedSpecification = useLibraryStore((state) => state.setSelectedSpecification)
  const notation = useNotationStore((state) => state.notation)
  const setNotation = useNotationStore((state) => state.setNotation)
  const { canUndo, canRedo } = useUndoRedo()
  const canEditActive = useCanEditActiveSpec()
  const propertiesPanelWidth = useFlowStore((state) => state.propertiesPanelWidth)
  const setPropertiesPanelWidth = useFlowStore((state) => state.setPropertiesPanelWidth)
  const librarySidebarWidth = useFlowStore((state) => state.librarySidebarWidth)
  const librarySidebarCollapsed = useFlowStore((state) => state.librarySidebarCollapsed)
  const setLibrarySidebarWidth = useFlowStore((state) => state.setLibrarySidebarWidth)
  const setLibrarySidebarCollapsed = useFlowStore((state) => state.setLibrarySidebarCollapsed)

  // Local state for live drag (React state for re-renders)
  const [localPanelWidth, setLocalPanelWidth] = useState(propertiesPanelWidth)
  // Ref to current width during drag (avoids stale closure in event handlers)
  const panelWidthRef = useRef(localPanelWidth)
  panelWidthRef.current = localPanelWidth
  // Drag in-progress ref
  const isDraggingPanelRef = useRef(false)
  // Collapse state for narrow viewports
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)

  // Dark mode toggle
  const { theme, toggleTheme } = useTheme()

  // About dialog (opened from the header icon)
  const [aboutOpen, setAboutOpen] = useState(false)

  // Library sidebar local state for live drag
  const [localSidebarWidth, setLocalSidebarWidth] = useState(librarySidebarWidth)
  const sidebarWidthRef = useRef(localSidebarWidth)
  sidebarWidthRef.current = localSidebarWidth
  const isDraggingSidebarRef = useRef(false)

  // Determine if we have a workflow selected (for showing canvas)
  const hasWorkflowSelected =
    (activeEntityType === 'workflow' || activeEntityType === 'step') && selectedSpecificationId !== null

  // Parent specification ID for back navigation. Read reactively from the
  // specificationStore (a child spec carries its parent's id), so it tracks
  // child-spec loads without a synthetic dependency.
  const parentSpecificationId = useSpecificationStore((s) =>
    selectedSpecificationId && selectedLibraryId
      ? s.specs.get(selectedSpecificationId)?.parentSpecificationId || null
      : null,
  )

  // Enable clipboard operations (copy/paste/delete)
  useCopyPaste()

  // Get layout function for auto-layout button
  const { applyLayout } = useAutoLayout()

  // Get undo/redo functions from temporal store
  const { undo, redo } = useFlowStore.temporal.getState()

  // Track the last loaded specification to avoid re-loading
  const lastLoadedSpecRef = React.useRef<string | null>(null)

  // Snapshot of the loaded state for dirty comparison (avoids false positives from batched React updates)
  const loadedSnapshotRef = React.useRef<string | null>(null)

  // Per-workflow viewport tracking: map of specId -> viewport (preserves viewports across switches)
  const viewportMapRef = useRef<Map<string, Viewport>>(new Map())

  // Compute viewport to restore synchronously during render (must be available when FlowCanvas mounts)
  const restoredViewport = React.useMemo(() => {
    if (!selectedSpecificationId || !selectedLibraryId) return undefined

    // Check in-session map first (survives workflow switches without saving)
    const sessionViewport = viewportMapRef.current.get(selectedSpecificationId)
    if (sessionViewport) return sessionViewport

    // Fall back to persisted spec data
    const libSpecs = specifications.get(selectedLibraryId)
    const spec = libSpecs?.find((s) => s.id === selectedSpecificationId)
    const specData = spec?.data as { viewport?: Viewport } | undefined
    return specData?.viewport
  }, [selectedSpecificationId, selectedLibraryId, specifications])

  // Load workflow data when specification changes
  useEffect(() => {
    if (!hasWorkflowSelected || !selectedSpecificationId || !selectedLibraryId) {
      return
    }

    // Don't reload if we already loaded this spec
    if (lastLoadedSpecRef.current === selectedSpecificationId) {
      return
    }

    // NOTE: Do NOT call flushNow() here.
    // The navigation guard in setSelectedSpecification already saves the current
    // flowStore state BEFORE changing selectedSpecificationId. Calling it again
    // here would save to the WRONG spec (the new one, not the old one) because
    // selectedSpecificationId has already been updated by the time this effect runs.

    const libSpecs = specifications.get(selectedLibraryId)
    let spec = libSpecs?.find((s) => s.id === selectedSpecificationId)

    // If not found in libraryStore, check specificationStore (child workflow navigation)
    let isChildSpec = false
    if (!spec) {
      const specState = useSpecificationStore.getState()
      const childSpec = specState.specs.get(selectedSpecificationId)
      if (childSpec) {
        // Adapt specificationStore Specification shape for loading
        spec = {
          id: childSpec.id,
          libraryId: selectedLibraryId,
          name: childSpec.name,
          description: childSpec.description,
          version: childSpec.version,
          state: childSpec.state as 'Draft',
          data: childSpec.data,
          createdAt: new Date(childSpec.createdAt).toISOString(),
          updatedAt: new Date(childSpec.updatedAt).toISOString(),
        } as unknown as import('@/types/library').Specification
        isChildSpec = childSpec.parentSpecificationId !== null
      }
    }

    // specificationStore is the source of truth for edits (writeThroughToSpec writes
    // there, batchSave reads from there). libraryStore is persisted to localStorage
    // and may have the spec cached before specificationStore does. If specStore is
    // missing the spec, edits silently drop (dirtyIds never grows → Save button stays
    // disabled). Synchronously mirror the cached spec into specStore so edits take
    // effect immediately, then kick off loadTree in the background to refresh from
    // the server.
    {
      const specState = useSpecificationStore.getState()
      if (!specState.specs.has(selectedSpecificationId) && spec) {
        const srcData = (spec.data ?? {}) as Record<string, unknown>
        specState.upsertSpec({
          id: spec.id,
          parentSpecificationId: (srcData.parentSpecificationId as string | null | undefined) ?? null,
          rootSpecificationId: (srcData.rootSpecificationId as string | undefined) ?? spec.id,
          libraryId: selectedLibraryId,
          name: spec.name,
          description: spec.description,
          typeName: spec.typeName ?? null,
          version: spec.version,
          state: spec.state,
          data: srcData,
          dataSchemaVersion: (srcData.dataSchemaVersion as number | undefined) ?? 3,
          history: spec.history ?? [],
          createdAt: new Date(spec.createdAt).getTime(),
          updatedAt: new Date(spec.updatedAt).getTime(),
          lastEditedByUserId: null,
        })
      }
      if (
        !specState.loadedRootIds.has(selectedSpecificationId) &&
        !specState.loadingTreeIds.has(selectedSpecificationId)
      ) {
        void specState.loadTree(selectedSpecificationId)
      }
    }

    if (spec) {
      const workflowData = spec.data as
        | {
            nodes?: unknown[]
            edges?: unknown[]
            workflowInputs?: ParameterSpec[]
            workflowOutputs?: ParameterSpec[]
            workflowValues?: ValueSpec[]
            workflowResources?: ResourceSpec[]
            workflowTrySpecifications?: TrySpec[]
            // Legacy keys written by an earlier buggy write-through; fall back to these if canonical keys are missing.
            inputs?: ParameterSpec[]
            outputs?: ParameterSpec[]
            values?: ValueSpec[]
            resources?: ResourceSpec[]
            notation?: unknown
            viewport?: Viewport
            images?: Record<string, string>
          }
        | undefined
      // Restore per-workflow notation FIRST, before mounting the new nodes/edges.
      // Specs without a saved notation default to flowchart — see resolveSpecNotation.
      //
      // Order matters: every unified node renderer reads the global notationStore
      // at render time to position its handles. If we set nodes before notation,
      // the previous spec's notation is still active when the new nodes mount —
      // React Flow measures handle positions in the wrong layout and caches edge
      // paths against those coords. Subsequent setNotation re-renders the nodes
      // with correct handles, but RF's cached paths can still target the stale
      // BPMN/flowchart handle positions, so connection lines render incorrectly
      // even after the notation flip.
      setNotation(resolveSpecNotation(workflowData))

      // Mark the flowStore as hydrated for THIS spec BEFORE calling setNodes —
      // otherwise the writeThroughToSpec triggered by setNodes would be
      // skipped by its own guard. The data we're about to load came FROM this
      // spec, so the round-trip write is either a no-op or exactly the CATCH
      // outputs backfill below, which we WANT persisted — safe to flip the
      // guard first either way.
      setHydratedSpecId(selectedSpecificationId)
      // CATCH nodes saved before the four default outputs existed get them
      // backfilled here, so the panel, Source picker, and write-through all
      // see the canonical rows (no-op when nothing is missing).
      setNodes(normalizeCatchOutputsInNodes((workflowData?.nodes as WorkflowNode[]) || []))
      setEdges((workflowData?.edges as Edge[]) || [])
      setWorkflowInputs(workflowData?.workflowInputs ?? workflowData?.inputs ?? [])
      setWorkflowOutputs(workflowData?.workflowOutputs ?? workflowData?.outputs ?? [])
      setWorkflowValues(workflowData?.workflowValues ?? workflowData?.values ?? [])
      setWorkflowResources(workflowData?.workflowResources ?? workflowData?.resources ?? [])
      setWorkflowTrySpecifications(workflowData?.workflowTrySpecifications ?? [])

      // Seed the viewport map from persisted data (if not already in session map)
      if (!viewportMapRef.current.has(selectedSpecificationId) && workflowData?.viewport) {
        viewportMapRef.current.set(selectedSpecificationId, workflowData.viewport)
      }

      lastLoadedSpecRef.current = selectedSpecificationId
      // Snapshot the loaded state so dirty tracking can compare against it
      const fs = useFlowStore.getState()
      loadedSnapshotRef.current = JSON.stringify([
        fs.nodes.map((n: { id: string; type: string; position: { x: number; y: number }; data: unknown }) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: n.data,
        })),
        fs.edges.map((e) => ({
          id: (e as { id: string }).id,
          source: (e as { source: string }).source,
          target: (e as { target: string }).target,
          data: (e as { data: unknown }).data,
        })),
        fs.workflowInputs,
        fs.workflowOutputs,
        fs.workflowValues,
        fs.workflowResources,
        fs.workflowTrySpecifications,
        useNotationStore.getState().notation,
      ])
      // Clear undo history (and the sub-workflow undo buffer) for the fresh workflow
      useFlowStore.temporal.getState().clear()
      clearSubWorkflowUndoBuffer()

      // Start editing session only when a top-level (non-child) workflow is loaded
      if (!isChildSpec) {
        const session = useWorkflowSessionStore.getState()
        if (session.editingRootSpecId !== selectedSpecificationId) {
          session.startSession(selectedSpecificationId, selectedLibraryId)
        }
      }
    }
  }, [
    hasWorkflowSelected,
    selectedSpecificationId,
    selectedLibraryId,
    specifications,
    setNodes,
    setEdges,
    setWorkflowInputs,
    setWorkflowOutputs,
    setWorkflowValues,
    setWorkflowResources,
    setWorkflowTrySpecifications,
    setHydratedSpecId,
    setNotation,
  ])

  // Reset last loaded spec when switching away from workflow view
  useEffect(() => {
    if (!hasWorkflowSelected) {
      lastLoadedSpecRef.current = null
      // Don't clear viewportMapRef - preserve viewports for the session
    }
  }, [hasWorkflowSelected])

  // Track dirty state — mark the current spec as modified when canvas data changes
  useEffect(() => {
    if (!hasWorkflowSelected || !selectedSpecificationId) return
    if (lastLoadedSpecRef.current !== selectedSpecificationId) return

    // Build a fingerprint of the current state
    const currentSnapshot = JSON.stringify([
      nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
      edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data })),
      workflowInputs,
      workflowOutputs,
      workflowValues,
      workflowResources,
      workflowTrySpecifications,
      notation,
    ])

    // If the current state matches the loaded snapshot, nothing changed
    if (currentSnapshot === loadedSnapshotRef.current) return

    const timeoutId = setTimeout(() => {
      useWorkflowSessionStore.getState().markModified(selectedSpecificationId)
    }, 100)
    return () => clearTimeout(timeoutId)
  }, [
    nodes,
    edges,
    workflowInputs,
    workflowOutputs,
    workflowValues,
    workflowResources,
    workflowTrySpecifications,
    notation,
    hasWorkflowSelected,
    selectedSpecificationId,
  ])

  // Handle viewport changes from FlowCanvas
  const handleViewportChange = React.useCallback(
    (viewport: Viewport) => {
      if (selectedSpecificationId) {
        viewportMapRef.current.set(selectedSpecificationId, viewport)
      }
    },
    [selectedSpecificationId],
  )

  // Sync libraryStore view layer from specificationStore (already loaded by runBoot)
  useEffect(() => {
    fetchLibraries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync local panel width when store hydrates from IndexedDB
  useEffect(() => {
    setLocalPanelWidth(propertiesPanelWidth)
  }, [propertiesPanelWidth])

  // Sync local sidebar width when store hydrates from IndexedDB
  useEffect(() => {
    setLocalSidebarWidth(librarySidebarWidth)
  }, [librarySidebarWidth])

  // Cleanup userSelect on unmount (in case component unmounts mid-drag)
  useEffect(() => {
    return () => {
      document.body.style.userSelect = ''
    }
  }, [])

  // Auto-collapse panel on narrow viewports
  useEffect(() => {
    const COLLAPSE_BREAKPOINT = 900
    const checkWidth = () => {
      if (window.innerWidth < COLLAPSE_BREAKPOINT) {
        setIsPanelCollapsed(true)
      }
    }
    window.addEventListener('resize', checkWidth)
    checkWidth()
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  return (
    <div className="h-full w-full flex flex-col">
      {/* Draft recovery dialog - shown when persisted draft exists */}
      <DraftRecoveryDialog />

      {/* Legacy upgrade notification - shown once after v4.0 migration strips legacy nodes */}
      <LegacyUpgradeDialog />

      {/* Top toolbar */}
      <div className="h-12 bg-slate-100 dark:bg-slate-900 border-b flex items-center px-4 gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          title="About Mission Designer"
          aria-label="About"
          className="rounded p-0.5 -m-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <img src="/ic_launcher_round.png" alt="" className="h-6 w-6" />
        </button>
        <span className="font-semibold text-slate-700 dark:text-slate-200">Mission Designer</span>
        <span className="text-xs text-slate-400">v{__APP_VERSION__}</span>
        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} version={__APP_VERSION__} />

        {/* Notation switcher - only show for workflow editing */}
        {hasWorkflowSelected && (
          <div className="ml-4">
            <NotationSwitcher />
          </div>
        )}

        {/* Back button - shown when editing a child workflow */}
        {hasWorkflowSelected && parentSpecificationId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Deselect all nodes so properties panel shows the parent workflow, not a step
              const nodes = useFlowStore.getState().nodes
              setNodes(nodes.map((n) => ({ ...n, selected: false })))
              setSelectedSpecification(parentSpecificationId, selectedLibraryId)
            }}
            title="Back to parent workflow"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        )}

        {/* Context breadcrumb */}
        <div className="ml-4 border-l border-slate-300 dark:border-slate-600 pl-4">
          <ContextBreadcrumb />
        </div>

        <div className="flex-1" />

        {/* Edit actions - only show when editing a workflow */}
        {hasWorkflowSelected && (
          <>
            <div className="flex items-center gap-1 border-r border-slate-300 dark:border-slate-600 pr-2 mr-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => undo()}
                disabled={!canUndo || !canEditActive}
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => redo()}
                disabled={!canRedo || !canEditActive}
                title="Redo (Ctrl+Shift+Z)"
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Layout action - uses notation-aware direction */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyLayout()}
              disabled={!canEditActive}
              title="Auto-layout"
            >
              <LayoutGrid className="h-4 w-4 mr-1" />
              Auto-layout
            </Button>
          </>
        )}

        {/* Help — opens the generated user guide in a new tab */}
        <Button variant="ghost" size="sm" asChild title="Open the user guide in a new tab">
          <a href="/help.html" target="_blank" rel="noopener noreferrer" aria-label="Help">
            <HelpCircle className="h-4 w-4" />
          </a>
        </Button>

        {/* Dark mode toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* Spacer for user info in parent layout - matches properties panel width */}
        <div style={{ width: isPanelCollapsed ? 32 : localPanelWidth }} className="shrink-0" />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Far left - Library Sidebar (resizable) */}
        <LibrarySidebar width={localSidebarWidth} collapsed={librarySidebarCollapsed} />

        {/* Sidebar collapse/expand toggle + drag handle */}
        {librarySidebarCollapsed ? (
          <button
            className="shrink-0 flex items-center justify-center w-5 border-r border-slate-200 bg-white hover:bg-slate-50 cursor-pointer"
            onClick={() => setLibrarySidebarCollapsed(false)}
            title="Expand Library Sidebar"
          >
            <PanelLeft className="h-3.5 w-3.5 text-slate-500" />
          </button>
        ) : (
          <div className="shrink-0 flex" style={{ width: 8 }}>
            {/* Drag handle on right edge of sidebar */}
            <div
              style={{
                width: 4,
                height: '100%',
                cursor: 'col-resize',
                background: 'transparent',
                flexShrink: 0,
                transition: 'background 0.15s',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = '#bfdbfe'
              }}
              onMouseLeave={(e) => {
                if (!isDraggingSidebarRef.current) {
                  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                }
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                isDraggingSidebarRef.current = true
                const startX = e.clientX
                const startWidth = sidebarWidthRef.current
                const handle = e.currentTarget as HTMLElement
                document.body.style.userSelect = 'none'
                handle.style.background = '#bfdbfe'

                const handleMouseMove = (moveEvent: MouseEvent) => {
                  // Moving right (larger X) increases sidebar width — sidebar is anchored to left edge
                  const newWidth = startWidth + (moveEvent.clientX - startX)
                  const clamped = Math.min(500, Math.max(200, newWidth))
                  setLocalSidebarWidth(clamped)
                }

                const handleMouseUp = () => {
                  isDraggingSidebarRef.current = false
                  document.body.style.userSelect = ''
                  handle.style.background = 'transparent'
                  // Persist only on mouseup to avoid IndexedDB flooding
                  setLibrarySidebarWidth(sidebarWidthRef.current)
                  window.removeEventListener('mousemove', handleMouseMove)
                  window.removeEventListener('mouseup', handleMouseUp)
                }

                window.addEventListener('mousemove', handleMouseMove)
                window.addEventListener('mouseup', handleMouseUp)
              }}
            >
              {/* Invisible wider hit area for easier grab targeting */}
              <div style={{ position: 'absolute', left: -4, right: -4, top: 0, bottom: 0 }} />
            </div>
            {/* Collapse button */}
            <button
              className="flex items-center justify-center w-4 hover:bg-slate-100 transition-colors"
              onClick={() => setLibrarySidebarCollapsed(true)}
              title="Collapse Library Sidebar"
            >
              <PanelLeft className="h-3 w-3 text-slate-400" />
            </button>
          </div>
        )}

        {/* Content area - varies by active tab and selection */}
        {activeEntityType === 'workflow' || activeEntityType === 'step' ? (
          hasWorkflowSelected ? (
            <>
              {/* Left - Step Palette */}
              <StepPalette />

              {/* Center - Canvas with specification header */}
              <div className="flex-1 flex flex-col">
                <SpecificationHeader />
                <div className="flex-1">
                  <FlowCanvas
                    key={selectedSpecificationId}
                    onMoveEnd={handleViewportChange}
                    initialViewport={restoredViewport}
                  />
                </div>
              </div>

              {/* Right - Properties Panel (resizable) */}
              {isPanelCollapsed ? (
                <button
                  className="shrink-0 flex items-center justify-center w-8 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  onClick={() => setIsPanelCollapsed(false)}
                  title="Show Properties Panel"
                >
                  <PanelRight className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                </button>
              ) : (
                <div
                  style={{
                    width: localPanelWidth,
                    minWidth: 200,
                    maxWidth: 600,
                    transition: isDraggingPanelRef.current ? 'none' : 'width 0.2s ease',
                  }}
                  className="border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col overflow-hidden shrink-0"
                >
                  <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
                    {/* Drag handle on left edge */}
                    <div
                      role="separator"
                      aria-label="Resize properties panel"
                      style={{
                        width: 4,
                        height: '100%',
                        cursor: 'col-resize',
                        background: 'transparent',
                        flexShrink: 0,
                        transition: 'background 0.15s',
                        position: 'relative',
                      }}
                      onMouseEnter={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = '#bfdbfe'
                      }}
                      onMouseLeave={(e) => {
                        if (!isDraggingPanelRef.current) {
                          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                        }
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        isDraggingPanelRef.current = true
                        const startX = e.clientX
                        const startWidth = panelWidthRef.current
                        const handle = e.currentTarget as HTMLElement
                        document.body.style.userSelect = 'none'
                        handle.style.background = '#bfdbfe'

                        const handleMouseMove = (moveEvent: MouseEvent) => {
                          // Moving left (smaller X) increases panel width — panel is anchored to right edge
                          const newWidth = startWidth + (startX - moveEvent.clientX)
                          const clamped = Math.min(600, Math.max(200, newWidth))
                          setLocalPanelWidth(clamped)
                        }

                        const handleMouseUp = () => {
                          isDraggingPanelRef.current = false
                          document.body.style.userSelect = ''
                          handle.style.background = 'transparent'
                          // Persist only on mouseup to avoid IndexedDB flooding
                          setPropertiesPanelWidth(panelWidthRef.current)
                          window.removeEventListener('mousemove', handleMouseMove)
                          window.removeEventListener('mouseup', handleMouseUp)
                        }

                        window.addEventListener('mousemove', handleMouseMove)
                        window.addEventListener('mouseup', handleMouseUp)
                      }}
                    >
                      {/* Invisible wider hit area for easier grab targeting */}
                      <div style={{ position: 'absolute', left: -4, right: -4, top: 0, bottom: 0 }} />
                    </div>
                    {/* Panel content */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <div className="flex-1 overflow-y-auto">
                        <PropertiesPanel onCollapse={() => setIsPanelCollapsed(true)} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : selectedLibraryId ? (
            <LibraryDetailView />
          ) : (
            <WorkflowPlaceholder />
          )
        ) : activeEntityType === 'environment' ? (
          selectedSpecificationId ? (
            <EnvironmentDetailView />
          ) : (
            <LibraryDetailView />
          )
        ) : activeEntityType === 'action' ? (
          selectedSpecificationId ? (
            <ActionDetailView />
          ) : (
            <LibraryDetailView />
          )
        ) : null}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/')({
  component: WorkflowEditor,
})
