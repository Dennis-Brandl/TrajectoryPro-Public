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

import { librariesForNames } from '@/lib/global-team'
import { useLibraryStore } from '@/stores/libraryStore'
import { useNotationStore } from '@/stores/notationStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { exportWorkflow } from '@/stores/specificationStore/flows'
import { syncServerState } from '@/stores/specificationStore/syncServerState'
import { libraryPdfFilename, withVersionSuffix } from '@/lib/export/filename'
import { toast } from 'sonner'
import type { ParameterSpec, ValueSpec, ResourceSpec, WorkflowNode } from '@/types/nodes'
import type { Edge } from '@xyflow/react'
import type { ChildWorkflowSpec } from '@/lib/export/pdf/pdf-types'
import type { Library, Specification } from '@/types/library'
import type { Specification as SpecSpec } from '@/stores/specificationStore/types'
import type { LibraryWithChildren } from '@/lib/packageFormat/export-types'

/** Map specificationStore.Specification → @/types/library.Specification */
function specToOldSpec(s: SpecSpec): Specification {
  return {
    id: s.id,
    libraryId: s.libraryId,
    name: s.name,
    description: s.description,
    typeName: s.typeName,
    version: s.version,
    state: s.state as Specification['state'],
    data: s.data,
    history: s.history,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }
}

/** GATE follow-up item 5: the server round-trip export's warnings (rule-4 gate-binding ambiguity,
 *  undecodable images) arrive in a response header. Surface them the way the client-side exports
 *  already do, right after the download toast; a clean export shows nothing extra. */
function toastExportWarnings(filename: string, warnings: string[]): void {
  if (warnings.length === 0) return
  toast.warning(`${filename} exported with warnings: ${warnings.join(' · ')}`, { duration: 10_000 })
}

export function useLibraryExport() {
  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)
  const libraries = useLibraryStore((s) => s.libraries)

  /**
   * Export selected library as a package (ZIP download).
   */
  const handleExportLibrary = async () => {
    if (!selectedLibraryId) return
    const store = useLibraryStore.getState()
    const library = libraries.find((l) => l.id === selectedLibraryId)
    if (!library) return

    if (library.entityType === 'workflow') {
      const toastId = toast.loading('Exporting workflow library package...')
      try {
        const { createWorkflowLibraryPackage } = await import('@/lib/packageFormat/workflow-library-package')
        const treeLibIds: string[] = []
        const collectLibIds = (libId: string) => {
          treeLibIds.push(libId)
          for (const child of store.childLibraries.get(libId) ?? []) collectLibIds(child.id)
        }
        collectLibIds(selectedLibraryId)
        // The workflow-library bundle includes the workflow tree itself PLUS
        // every referenced step / environment / action library and their
        // specs. The specificationStore only contains specs the user has
        // opened in the editor — so we must explicitly pull every library
        // that *could* be referenced. Without this, an unopened step library
        // exports with workflow_specifications: [] and re-import recreates
        // an empty library (the user-reported "step workflow not recreated"
        // bug). Cheap: a few metadata fetches per non-workflow library.
        const dependentLibIds = store.libraries.filter((l) => l.entityType !== 'workflow').map((l) => l.id)
        const idsToLoad = [...new Set([...treeLibIds, ...dependentLibIds])]
        const specStore = useSpecificationStore.getState()
        const { api } = await import('@/stores/specificationStore/apiClient')
        const missingIds: string[] = []
        for (const libId of idsToLoad) {
          const resp = await api.listLibrarySpecs(libId)
          await syncServerState(resp.specs)
          for (const s of resp.specs) {
            const id = (s as { id: string }).id
            if (!specStore.specs.has(id)) missingIds.push(id)
          }
        }
        if (missingIds.length > 0) {
          await useSpecificationStore.getState().loadBulk(missingIds)
        }
        const fresh = useSpecificationStore.getState()
        const allSpecs = Array.from(fresh.specs.values()).map(specToOldSpec)
        const allSpecsByLibrary = new Map<string, Specification[]>()
        for (const spec of allSpecs) {
          const list = allSpecsByLibrary.get(spec.libraryId) ?? []
          list.push(spec)
          allSpecsByLibrary.set(spec.libraryId, list)
        }
        const buildTree = (lib: Library): LibraryWithChildren => ({
          library: lib,
          specifications: allSpecsByLibrary.get(lib.id) ?? [],
          children: (store.childLibraries.get(lib.id) ?? []).map(buildTree),
        })
        const tree = buildTree(library)
        const images: Record<string, string> = {}
        const collectImages = (node: LibraryWithChildren) => {
          for (const spec of node.specifications) {
            const specImages = (spec.data as Record<string, unknown>)?.images as Record<string, string> | undefined
            if (specImages) Object.assign(images, specImages)
          }
          for (const child of node.children) collectImages(child)
        }
        collectImages(tree)
        const blob = await createWorkflowLibraryPackage({
          tree,
          images,
          allSpecs,
          allLibraries: store.libraries,
          allSpecsByLibrary,
        })
        const filename = `${withVersionSuffix(library.name, library.version)}.WFlibX`
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        toast.success(`Downloaded ${filename}`, { id: toastId, duration: 4000 })
      } catch (error) {
        toast.error(`Workflow library export failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
          id: toastId,
          duration: Infinity,
        })
      }
      return
    }

    const toastId = toast.loading('Exporting library package...')
    try {
      const { createLibraryPackage, getLibraryPackageExtension } = await import('@/lib/packageFormat/library-package')

      // Collect all library IDs in the tree (root + descendants) so we can
      // ensure their specs are loaded with full data before export.
      const treeLibIds: string[] = []
      const collectLibIds = (libId: string) => {
        treeLibIds.push(libId)
        for (const child of store.childLibraries.get(libId) ?? []) collectLibIds(child.id)
      }
      collectLibIds(selectedLibraryId)

      // Fetch spec metadata for each library to discover IDs, then bulk-load
      // any that aren't already in specificationStore (which only has specs the
      // user has opened in the editor).
      const specStore = useSpecificationStore.getState()
      const { api } = await import('@/stores/specificationStore/apiClient')
      const missingIds: string[] = []
      for (const libId of treeLibIds) {
        const resp = await api.listLibrarySpecs(libId)
        await syncServerState(resp.specs)
        for (const s of resp.specs) {
          const id = (s as { id: string }).id
          if (!specStore.specs.has(id)) missingIds.push(id)
        }
      }
      if (missingIds.length > 0) {
        await useSpecificationStore.getState().loadBulk(missingIds)
      }

      // For environment-library exports, also pre-load action library specs
      // referenced by every env spec in the tree, so the WFenvirLibX bundle can
      // include them. Env libs only nest env libs via childLibraries; action
      // libs are referenced by name, not by parent-child link, and so don't
      // appear in treeLibIds collected above.
      if (library.entityType === 'environment') {
        const reloaded = useSpecificationStore.getState()
        const referencedActionLibNames = new Set<string>()
        for (const libId of treeLibIds) {
          for (const spec of reloaded.specs.values()) {
            if (spec.libraryId !== libId) continue
            const inc = (spec.data as Record<string, unknown>)?.included_actions as
              | Array<{ action_library?: string; actionLibrary?: string }>
              | undefined
            if (!inc) continue
            for (const a of inc) {
              const libName = a.action_library ?? a.actionLibrary
              if (libName) referencedActionLibNames.add(libName)
            }
          }
        }
        // Only the library each name resolves to (spec 2026-10-12 U4), not every namesake.
        const actionLibIds = librariesForNames(store.libraries, referencedActionLibNames, 'action', library.teamId).map(
          (l) => l.id,
        )
        const actionMissingIds: string[] = []
        for (const libId of actionLibIds) {
          const resp = await api.listLibrarySpecs(libId)
          await syncServerState(resp.specs)
          for (const s of resp.specs) {
            const id = (s as { id: string }).id
            if (!useSpecificationStore.getState().specs.has(id)) actionMissingIds.push(id)
          }
        }
        if (actionMissingIds.length > 0) {
          await useSpecificationStore.getState().loadBulk(actionMissingIds)
        }
      }

      // Re-read specStore after loading; build export data from the now-populated store.
      const freshSpecStore = useSpecificationStore.getState()
      const allSpecs = Array.from(freshSpecStore.specs.values()).map(specToOldSpec)
      const allSpecsByLibrary = new Map<string, Specification[]>()
      for (const spec of allSpecs) {
        const list = allSpecsByLibrary.get(spec.libraryId) ?? []
        list.push(spec)
        allSpecsByLibrary.set(spec.libraryId, list)
      }

      const buildTree = (lib: Library): LibraryWithChildren => ({
        library: lib,
        specifications: allSpecsByLibrary.get(lib.id) ?? [],
        children: (store.childLibraries.get(lib.id) ?? []).map(buildTree),
      })
      const tree = buildTree(library)

      // Collect images from all specs in this library tree.
      const images: Record<string, string> = {}
      const collectImages = (node: LibraryWithChildren) => {
        for (const spec of node.specifications) {
          const specImages = (spec.data as Record<string, unknown>)?.images as Record<string, string> | undefined
          if (specImages) Object.assign(images, specImages)
        }
        for (const child of node.children) collectImages(child)
      }
      collectImages(tree)

      const blob = await createLibraryPackage({
        tree,
        entityType: library.entityType,
        images,
        allSpecs,
        allLibraries: store.libraries,
        allSpecsByLibrary,
      })

      const ext = getLibraryPackageExtension(library.entityType)
      const filename = `${withVersionSuffix(library.name, library.version)}.${ext}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Downloaded ${filename}`, { id: toastId, duration: 4000 })
    } catch (error) {
      toast.error(`Library export failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        id: toastId,
        duration: Infinity,
      })
    }
  }

  /** Builds a ChildWorkflowSpec map from all loaded specifications. */
  const buildAllSpecsMap = (): Map<string, ChildWorkflowSpec> => {
    const specStore = useSpecificationStore.getState()
    const map = new Map<string, ChildWorkflowSpec>()
    for (const [, s] of specStore.specs.entries()) {
      const d = s.data as Record<string, unknown>
      if (!d.nodes) continue
      map.set(s.id, {
        nodes: (d.nodes ?? []) as WorkflowNode[],
        edges: (d.edges ?? []) as Edge[],
        name: s.name,
        version: (d.version as string) ?? '',
        oid: (d.oid as string) ?? '',
        description: s.description ?? '',
        inputParameters: (d.inputParameters ?? []) as ParameterSpec[],
        outputParameters: (d.outputParameters ?? []) as ParameterSpec[],
        valueProperties: (d.valueProperties ?? []) as ValueSpec[],
        resources: (d.resources ?? []) as ResourceSpec[],
        parentSpecId: (d.parentSpecificationId as string) ?? undefined,
      })
    }
    return map
  }

  /**
   * Export the entire selected library as PDF.
   * Non-workflow types use client-side PDF generators.
   * Workflow PDF requires canvas to be loaded.
   */
  const handleExportPDF = async () => {
    if (!selectedLibraryId) return
    const library = libraries.find((l) => l.id === selectedLibraryId)
    if (!library) return

    const specStore = useSpecificationStore.getState()
    const libSpecs = Array.from(specStore.specs.values()).filter((s) => s.libraryId === selectedLibraryId)

    if (libSpecs.length === 0) {
      toast.warning('No items to export')
      return
    }

    const filename = libraryPdfFilename(library)
    const toastId = toast.loading('Generating PDF...')

    try {
      const { downloadPDF } = await import('@/lib/export/pdf/pdf-export')
      const { generateActionLibraryPDF, generateEnvironmentLibraryPDF, generateStepLibraryPDF } =
        await import('@/lib/export/pdf/pdf-library')
      const { generateWorkflowPDF } = await import('@/lib/export/pdf/pdf-workflow')

      // Use libraryStore specs for action/environment/step (those haven't migrated to specStore yet)
      const libraryStoreSpecs = useLibraryStore.getState().specifications.get(selectedLibraryId) || []

      let doc: import('jspdf').default | null = null

      switch (library.entityType) {
        case 'action':
          doc = generateActionLibraryPDF(library, libraryStoreSpecs)
          break

        case 'environment': {
          const allLibs = useLibraryStore.getState().libraries
          doc = generateEnvironmentLibraryPDF(
            library,
            libraryStoreSpecs,
            allLibs,
            useLibraryStore.getState().specifications,
          )
          break
        }

        case 'step': {
          const allSpecsMap = buildAllSpecsMap()
          doc = generateStepLibraryPDF(library, libraryStoreSpecs, allSpecsMap)
          break
        }

        case 'workflow': {
          // Workflow PDF requires the canvas — uses currently loaded flow nodes.
          const flowStore = (await import('@/stores/flowStore')).useFlowStore.getState()
          if (!flowStore.nodes || flowStore.nodes.length === 0) {
            toast.warning('Load a workflow on the canvas to export as PDF', { id: toastId })
            return
          }
          const allSpecsMap = buildAllSpecsMap()
          const notation = useNotationStore.getState().notation
          // Identify the currently displayed spec via libraryStore selection
          const currentWorkflowId = useLibraryStore.getState().selectedSpecificationId
          const currentSpec = currentWorkflowId ? specStore.specs.get(currentWorkflowId) : undefined
          const csd = (currentSpec?.data ?? {}) as Record<string, unknown>
          // Collect images from spec.data.images for PDF rendering
          const images: Map<string, string> = new Map()
          const specImages = (csd.images ?? {}) as Record<string, string>
          for (const [filename, dataUri] of Object.entries(specImages)) {
            images.set(filename, dataUri)
          }
          doc = await generateWorkflowPDF({
            name: currentSpec?.name ?? library.name,
            version: (csd.version as string) ?? '',
            oid: (csd.oid as string) ?? '',
            description: currentSpec?.description ?? '',
            lastModifiedDate: currentSpec?.updatedAt
              ? new Date(currentSpec.updatedAt).toISOString().slice(0, 10)
              : new Date().toISOString().slice(0, 10),
            nodes: flowStore.nodes as WorkflowNode[],
            edges: flowStore.edges as Edge[],
            inputParameters: (csd.inputParameters ?? []) as ParameterSpec[],
            outputParameters: (csd.outputParameters ?? []) as ParameterSpec[],
            valueProperties: (csd.valueProperties ?? []) as ValueSpec[],
            resources: (csd.resources ?? []) as ResourceSpec[],
            notation,
            images,
            allSpecs: allSpecsMap,
            rootSpecId: currentWorkflowId ?? undefined,
          })
          break
        }
      }

      if (!doc) {
        toast.warning('No items to export', { id: toastId })
        return
      }

      downloadPDF(doc, filename)
      toast.success(`Downloaded ${filename}`, { id: toastId, duration: 4000 })
    } catch (error) {
      toast.error(`PDF generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        id: toastId,
        duration: Infinity,
      })
    }
  }

  /**
   * Export a single specification as PDF or as WFmasterX (workflow type).
   */
  const handleExportSpecPDF = async (specId: string, libraryId: string) => {
    const store = useLibraryStore.getState()
    const library = store.libraries.find((l) => l.id === libraryId)
    if (!library) return

    // Workflow specs: server-side export via exportWorkflow flow helper
    if (library.entityType === 'workflow') {
      const toastId = toast.loading('Exporting workflow...')
      try {
        const { blob, filename, warnings } = await exportWorkflow(specId)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        toast.success(`Downloaded ${filename}`, { id: toastId, duration: 4000 })
        toastExportWarnings(filename, warnings)
      } catch (error) {
        toast.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
          id: toastId,
          duration: Infinity,
        })
      }
      return
    }

    // Non-workflow specs: client-side PDF
    const specs = store.specifications.get(libraryId) || []
    const spec = specs.find((s) => s.id === specId)
    if (!spec) return

    const entityLabel = library.entityType.charAt(0).toUpperCase() + library.entityType.slice(1)
    const filename = `${entityLabel} - ${withVersionSuffix(spec.name, spec.version)}.pdf`
    const toastId = toast.loading('Generating PDF...')

    try {
      const { downloadPDF } = await import('@/lib/export/pdf/pdf-export')
      const { generateActionLibraryPDF, generateEnvironmentLibraryPDF, generateStepLibraryPDF } =
        await import('@/lib/export/pdf/pdf-library')

      let doc: import('jspdf').default | null = null

      switch (library.entityType) {
        case 'action':
          doc = generateActionLibraryPDF(library, [spec])
          break

        case 'environment': {
          doc = generateEnvironmentLibraryPDF(
            library,
            [spec],
            store.libraries,
            useLibraryStore.getState().specifications,
          )
          break
        }

        case 'step': {
          const allSpecsMap = buildAllSpecsMap()
          doc = generateStepLibraryPDF(library, [spec], allSpecsMap)
          break
        }
      }

      if (!doc) {
        toast.warning('Nothing to export', { id: toastId })
        return
      }

      downloadPDF(doc, filename)
      toast.success(`Downloaded ${filename}`, { id: toastId, duration: 4000 })
    } catch (error) {
      toast.error(`PDF generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        id: toastId,
        duration: Infinity,
      })
    }
  }

  /**
   * Export a single environment specification as a .WFenvirX package.
   * Mirrors the "Export" button next to History on EnvironmentDetailView.
   */
  const handleExportSpecPackage = async (specId: string, libraryId: string) => {
    const store = useLibraryStore.getState()
    const library = store.libraries.find((l) => l.id === libraryId)
    if (!library || library.entityType !== 'environment') return
    const spec = (store.specifications.get(libraryId) ?? []).find((s) => s.id === specId)
    if (!spec) return

    const toastId = toast.loading('Exporting environment package...')
    try {
      // Make WFenvirX self-contained: ensure specs for every action library
      // referenced by this env spec are loaded into the store before bundling.
      // Mirrors the same pre-fetch guard in EnvironmentDetailView.tsx (lines 258-269).
      const rawActions = spec.data as Record<string, unknown>
      const includedActions =
        ((rawActions.included_actions ?? rawActions.includedActions) as
          | Array<{ action_library?: string; actionLibrary?: string }>
          | undefined) ?? []
      const referencedActionLibNames = new Set<string>()
      for (const a of includedActions) {
        const libName = a.action_library ?? a.actionLibrary
        if (libName) referencedActionLibNames.add(libName)
      }
      const refActionLibs = librariesForNames(store.libraries, referencedActionLibNames, 'action', library.teamId)
      for (const lib of refActionLibs) {
        if (!useLibraryStore.getState().specifications.has(lib.id)) {
          await useLibraryStore.getState().fetchSpecifications(lib.id)
        }
      }
      const freshSpecsByLibrary = useLibraryStore.getState().specifications

      const { exportSingleEnvironment } = await import('@/lib/export/single-spec-exporters')
      const filename = await exportSingleEnvironment(spec, library, store.libraries, freshSpecsByLibrary)
      toast.success(`Downloaded ${filename}`, { id: toastId, duration: 4000 })
    } catch (error) {
      toast.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        id: toastId,
        duration: Infinity,
      })
    }
  }

  return { handleExportLibrary, handleExportPDF, handleExportSpecPDF, handleExportSpecPackage }
}
