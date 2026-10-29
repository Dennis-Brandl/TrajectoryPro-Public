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

import { useMemo, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { History } from 'lucide-react'
import { Button } from '@mission/ui'
import { SaveStatusButton } from '@/components/toolbar/SaveStatusButton'
import { VersionBadge, VersionHistoryDialog } from '@/components/version'
import { useUserName } from '@/stores/principalStore'
import { createVersionEntry, parseVersionHistory } from '@/types/version'
import { bumpErrorMessage, updateSpecificationVersion } from '@/lib/api/specification-mutations'
import {
  downloadBlob,
  downloadJSON,
  exportWorkflow,
  exportToPng,
  exportToSvg,
  downloadImage,
  withVersionSuffix,
} from '@/lib/export'
import { exportWorkflow as serverExportWorkflow } from '@/stores/specificationStore/flows'
import { exportBatchml } from '@/lib/batchml'
import { collectChildTree } from '@/lib/packageFormat/collectChildTree'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { flushNow } from '@/stores/specificationStore/saveScheduler'
import { useSpecificationStore } from '@/stores/specificationStore'
import type { Specification } from '@/types/library'
import { ChangeStateDialog } from '@/components/library/ChangeStateDialog'
import { ExportMenu } from '@/components/export'
import type { ChildWorkflowSpec } from '@/lib/export/pdf/pdf-types'
import { useIsChildWorkflow } from '@/hooks/useIsChildWorkflow'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { useNotationStore } from '@/stores/notationStore'
import type { Edge } from '@xyflow/react'
import type { WorkflowNode } from '@/types/nodes'
import { validateWorkflowWithChildren } from '@/lib/export/workflow-validation'
import type { ValidationError } from '@/lib/export/workflow-validation'
import { ValidationErrorDialog } from '@/components/export/ValidationErrorDialog'

/**
 * Canvas toolbar with runtime package export functionality.
 *
 * Must be rendered inside ReactFlowProvider context.
 */

/** GATE follow-up item 5: rule-4 binding ambiguity used to reach console.warn only. */
function toastGateWarnings(warnings: string[]): void {
  if (warnings.length === 0) return
  toast.warning(`Gate binding ambiguity — the export bound the first declaring environment: ${warnings.join(' · ')}`, {
    duration: 10_000,
  })
}

export function CanvasToolbar() {
  // Get selected workflow from library store (same as PropertiesPanel)
  const selectedSpecificationId = useLibraryStore((state) => state.selectedSpecificationId)
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId)
  const specifications = useLibraryStore((state) => state.specifications)
  const libraries = useLibraryStore((state) => state.libraries)
  const dirtyCount = useSpecificationStore((s) => s.dirtyIds.size)
  const lastSaveError = useSpecificationStore((s) => s.lastSaveError)
  const setSelectedSpecification = useLibraryStore((state) => state.setSelectedSpecification)
  const isChildWorkflow = useIsChildWorkflow()
  const canEdit = useCanEditActiveSpec()
  const isStepLibrary = useMemo(() => {
    if (!selectedLibraryId) return false
    const lib = libraries.find((l) => l.id === selectedLibraryId)
    return lib?.entityType === 'step'
  }, [selectedLibraryId, libraries])
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [showValidationDialog, setShowValidationDialog] = useState(false)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [showChangeState, setShowChangeState] = useState(false)
  const applyStateChange = useLibraryStore((state) => state.applyStateChange)

  const userName = useUserName()

  // Find the current spec across all loaded libraries (for version badge)
  const currentSpec = useMemo(() => {
    if (!selectedSpecificationId) return null
    for (const specs of specifications.values()) {
      const found = specs.find((s) => s.id === selectedSpecificationId)
      if (found) return found
    }
    return null
  }, [selectedSpecificationId, specifications])

  // Library of the current spec — needed by ChangeStateDialog for team rights + entity category.
  const currentLibrary = useMemo(() => {
    if (!currentSpec) return null
    return libraries.find((l) => l.id === currentSpec.libraryId) ?? null
  }, [currentSpec, libraries])

  const specVersion = currentSpec?.version || '1.0.0'
  const specVersionHistory = parseVersionHistory(
    (currentSpec?.data as Record<string, unknown>)?.versionHistory as string | undefined,
  )

  const handleVersionBump = async (newVersion: string, reason?: string) => {
    if (!currentSpec) return
    // Server first: batch-save deliberately drops `version` on update, so an
    // in-memory-only bump never reaches the row and exports keep the old number.
    try {
      await updateSpecificationVersion(currentSpec.id, newVersion)
    } catch (err) {
      toast.error(bumpErrorMessage(err, newVersion))
      return
    }
    const entry = createVersionEntry(newVersion, userName, reason)
    const currentHistory = parseVersionHistory(
      (currentSpec.data as Record<string, unknown>)?.versionHistory as string | undefined,
    )
    const updatedHistory = [entry, ...currentHistory]
    useSpecificationStore.getState().updateInMemory(currentSpec.id, {
      version: newVersion,
      data: { ...currentSpec.data, versionHistory: JSON.stringify(updatedHistory) },
    })
  }

  // Get current workflow specification
  const currentSpecification = useMemo(() => {
    if (!selectedSpecificationId || !selectedLibraryId) return null
    const libSpecs = specifications.get(selectedLibraryId)
    return libSpecs?.find((s) => s.id === selectedSpecificationId) || null
  }, [selectedSpecificationId, selectedLibraryId, specifications])

  // Get filename for export using workflow name + version, e.g. Kitchen_Demo(1.0.2).WFmaster
  const getExportFilename = (extension: string): string => {
    return currentSpecification
      ? `${withVersionSuffix(currentSpecification.name, currentSpecification.version)}.${extension}`
      : `workflow.${extension}`
  }

  /**
   * Persist all modified specifications to the server (without closing).
   * Returns false when the save failed; the global SaveErrorToast tells the user.
   */
  const handleSave = useCallback(async (): Promise<boolean> => {
    try {
      await flushNow()
      return true
    } catch (error) {
      console.error('Save failed:', error)
      return false
    }
  }, [])

  /** Persist all modified specifications and close the workflow; stays open when the save failed. */
  const handleSaveAndClose = useCallback(async () => {
    if (!(await handleSave())) return
    setSelectedSpecification(null, null)
  }, [handleSave, setSelectedSpecification])

  const handleExportWithValidation = async () => {
    const { nodes, edges } = useFlowStore.getState()

    // Collect all specs for child workflow validation
    const store = useLibraryStore.getState()
    const allSpecs: Specification[] = []
    for (const specs of store.specifications.values()) {
      allSpecs.push(...specs)
    }

    const errors = validateWorkflowWithChildren(
      nodes,
      edges,
      selectedSpecificationId || '',
      allSpecs,
      useFlowStore.getState().workflowTrySpecifications,
    )
    if (errors.length > 0) {
      setValidationErrors(errors)
      setShowValidationDialog(true)
      return
    }
    await handleCreateRuntimePackage()
  }

  /**
   * Handle creating a self-contained runtime package ZIP.
   * Delegates to the server-side exportWorkflow flow (§4.9).
   */
  const handleCreateRuntimePackage = async () => {
    if (!selectedSpecificationId) {
      toast.error('No workflow selected')
      return
    }
    try {
      const { blob, filename } = await serverExportWorkflow(selectedSpecificationId)
      downloadBlob(blob, filename)
      toast.success('Runtime package created')
    } catch (error) {
      console.error('Runtime package error:', error)
      toast.error('Failed to create runtime package')
    }
  }

  const handleExportStepJSON = () => {
    try {
      const { nodes, edges } = useFlowStore.getState()
      if (nodes.length === 0) {
        toast.error('Add nodes before exporting')
        return
      }

      const exportSpec: Specification = currentSpecification || {
        id: selectedSpecificationId || 'untitled',
        libraryId: selectedLibraryId || '',
        name: 'Workflow',
        description: null,
        version: '1.0.0',
        state: 'Draft' as const,
        data: {},
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      const store = useLibraryStore.getState()
      const allSpecs: Specification[] = []
      for (const specs of store.specifications.values()) {
        allSpecs.push(...specs)
      }

      // Include the loaded WORKFLOW PROXY sub-workflow tree so children are
      // embedded (childrenOf is populated by loadTree on workflow open;
      // collectChildTree returns [] for a flat workflow).
      const childTree = collectChildTree(exportSpec.id, useSpecificationStore.getState().childrenOf)
      const gateWarnings: string[] = []
      const workflowJson = exportWorkflow(
        exportSpec,
        nodes,
        edges,
        undefined,
        allSpecs,
        store.libraries,
        undefined,
        childTree,
        { warnings: gateWarnings },
      )
      downloadJSON(workflowJson, getExportFilename('WFmaster'))
      toast.success('Exported workflow as JSON')
      toastGateWarnings(gateWarnings)
    } catch (error) {
      console.error('JSON export error:', error)
      toast.error('Failed to export workflow')
    }
  }

  const handleExportBatchml = () => {
    try {
      const { nodes, edges } = useFlowStore.getState()
      if (nodes.length === 0) {
        toast.error('Add nodes before exporting')
        return
      }

      const exportSpec: Specification = currentSpecification || {
        id: selectedSpecificationId || 'untitled',
        libraryId: selectedLibraryId || '',
        name: 'Workflow',
        description: null,
        version: '1.0.0',
        state: 'Draft' as const,
        data: {},
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      const store = useLibraryStore.getState()
      const allSpecs: Specification[] = []
      for (const specs of store.specifications.values()) {
        allSpecs.push(...specs)
      }

      // Gather the loaded sub-workflow tree so WORKFLOW PROXY children are
      // embedded in the BatchML payload (Phase-1.1). The base64 payload round-trips
      // children losslessly; this hands them over. childrenOf is populated by
      // loadTree when the workflow opens, and collectChildTree returns [] when
      // there are none — so a flat workflow just exports its top level.
      const childTree = collectChildTree(exportSpec.id, useSpecificationStore.getState().childrenOf)
      const gateWarnings: string[] = []
      const workflowJson = exportWorkflow(
        exportSpec,
        nodes,
        edges,
        undefined,
        allSpecs,
        store.libraries,
        undefined,
        childTree,
        { warnings: gateWarnings },
      )
      const xml = exportBatchml(workflowJson)
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
      downloadBlob(blob, getExportFilename('batchml.xml'))
      toast.success('Exported workflow as BatchML')
      toastGateWarnings(gateWarnings)
    } catch (error) {
      console.error('BatchML export error:', error)
      toast.error(`BatchML export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleExportPDF = async () => {
    const { nodes, edges } = useFlowStore.getState()
    if (nodes.length === 0) {
      toast.error('Add nodes before exporting PDF')
      return
    }

    const name = currentSpecification?.name || 'Workflow'

    const version = (currentSpecification?.data as any)?.version || ''

    const oid = (currentSpecification?.data as any)?.oid || ''
    const description = currentSpecification?.description || ''
    const lastModifiedDate = currentSpecification?.updatedAt
      ? new Date(currentSpecification.updatedAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)
    const filename = `${withVersionSuffix(name, currentSpecification?.version || version)}.pdf`

    const inputParameters = (currentSpecification?.data as any)?.inputParameters ?? []

    const outputParameters = (currentSpecification?.data as any)?.outputParameters ?? []

    const valueProperties = (currentSpecification?.data as any)?.valueProperties ?? []

    const resources = (currentSpecification?.data as any)?.resources ?? []

    const notation = useNotationStore.getState().notation

    // Collect all workflow specifications for child discovery
    const store = useLibraryStore.getState()
    const allSpecsMap = new Map<string, ChildWorkflowSpec>()

    // Build parent lookup using specificationStore (parentSpecificationId lives on spec)
    for (const [, specs] of store.specifications.entries()) {
      for (const s of specs) {
        const d = s.data as any
        // Only include specs that have nodes (workflow specs)
        if (!d.nodes) continue
        // Derive parentSpecId from specificationStore or fall back to spec.data
        const specStoreEntry = useSpecificationStore.getState().specs.get(s.id)
        const derivedParentSpecId =
          specStoreEntry?.parentSpecificationId ?? (d.parentSpecificationId as string | undefined)
        allSpecsMap.set(s.id, {
          nodes: (d.nodes ?? []) as WorkflowNode[],
          edges: (d.edges ?? []) as Edge[],
          name: s.name,
          version: d.version ?? '',
          oid: d.oid ?? '',
          description: s.description ?? '',
          inputParameters: d.inputParameters ?? [],
          outputParameters: d.outputParameters ?? [],
          valueProperties: d.valueProperties ?? [],
          resources: d.resources ?? [],
          parentSpecId: derivedParentSpecId,
        })
      }
    }

    // Collect images for PDF from spec.data.images (stored in specificationStore)
    const specImagesForPdf = selectedSpecificationId
      ? ((
          useSpecificationStore.getState().specs.get(selectedSpecificationId)?.data as {
            images?: Record<string, string>
          }
        )?.images ?? {})
      : {}

    const toastId = toast.loading('Generating PDF...')
    try {
      const { downloadPDF } = await import('@/lib/export/pdf/pdf-export')
      const { generateWorkflowPDF } = await import('@/lib/export/pdf/pdf-workflow')
      const doc = await generateWorkflowPDF({
        name,
        version,
        oid,
        description,
        lastModifiedDate,
        nodes,
        edges,
        inputParameters,
        outputParameters,
        valueProperties,
        resources,
        notation,
        images: new Map(Object.entries(specImagesForPdf)),
        allSpecs: allSpecsMap,
        rootSpecId: selectedSpecificationId ?? undefined,
      })
      downloadPDF(doc, filename)
      toast.success(`Downloaded ${filename}`, { id: toastId, duration: 4000 })
    } catch (error) {
      toast.error(`PDF generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        id: toastId,
        duration: Infinity,
      })
    }
  }

  const handleExportPNG = async () => {
    const { nodes } = useFlowStore.getState()
    if (nodes.length === 0) {
      toast.error('Add nodes before exporting')
      return
    }
    try {
      const dataUrl = await exportToPng(nodes)
      downloadImage(dataUrl, getExportFilename('png'))
      toast.success('Exported workflow as PNG')
    } catch (error) {
      console.error('PNG export error:', error)
      toast.error('Failed to export PNG')
    }
  }

  const handleExportSVG = async () => {
    const { nodes } = useFlowStore.getState()
    if (nodes.length === 0) {
      toast.error('Add nodes before exporting')
      return
    }
    try {
      const dataUrl = await exportToSvg(nodes)
      downloadImage(dataUrl, getExportFilename('svg'))
      toast.success('Exported workflow as SVG')
    } catch (error) {
      console.error('SVG export error:', error)
      toast.error('Failed to export SVG')
    }
  }

  return (
    <div
      data-testid="canvas-toolbar"
      className="flex gap-2 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-2 rounded-lg shadow-md border border-slate-200 dark:border-slate-700"
    >
      {currentSpec && (
        <>
          <VersionBadge version={specVersion} onBump={handleVersionBump} disabled={!canEdit} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowVersionHistory(true)}
            title="Show version history"
            className="gap-1.5"
          >
            <History className="h-4 w-4" />
            History
          </Button>
          {/* Deliberately NOT gated on canEdit: moving an edit-locked spec to another state is
              exactly what this button is for. The dialog enforces legal transitions + rights. */}
          {currentLibrary && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowChangeState(true)}
              title="Click to change state"
              className="text-xs h-7 px-2"
            >
              {currentSpec.state}
            </Button>
          )}
        </>
      )}
      <SaveStatusButton
        isDirty={dirtyCount > 0}
        lastSaveError={lastSaveError}
        onSave={async () => {
          await handleSave()
        }}
        tooltip="Save workflow"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={handleSaveAndClose}
        className="gap-1.5"
        title="Close workflow (pending changes are flushed first)"
      >
        Close
      </Button>
      <ExportMenu
        mode="workflow"
        onExportJSON={isChildWorkflow ? null : isStepLibrary ? handleExportStepJSON : handleExportWithValidation}
        jsonLabel={isStepLibrary ? 'Export as JSON' : undefined}
        onExportPDF={handleExportPDF}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        onExportBatchml={isChildWorkflow ? undefined : handleExportBatchml}
      />
      <ValidationErrorDialog
        open={showValidationDialog}
        onClose={() => setShowValidationDialog(false)}
        errors={validationErrors}
      />
      <VersionHistoryDialog
        open={showVersionHistory}
        onOpenChange={setShowVersionHistory}
        history={specVersionHistory}
      />
      {currentSpec && currentLibrary && (
        <ChangeStateDialog
          spec={currentSpec}
          library={currentLibrary}
          open={showChangeState}
          onOpenChange={setShowChangeState}
          onSuccess={(updated) => {
            void applyStateChange(updated)
          }}
        />
      )}
    </div>
  )
}
