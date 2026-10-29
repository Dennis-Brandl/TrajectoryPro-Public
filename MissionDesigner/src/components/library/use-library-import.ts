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

import { mayAddSpecsTo } from './global-import-guard'
import { usePrincipalStore } from '@/stores/principalStore'
import { pickLibraryByName } from '@/lib/global-team'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { toast } from 'sonner'
import { type ImportResult } from '@/components/export'
import {
  importLibraryPackage,
  importActionLibrary,
  importEnvironmentLibrary,
  importStepLibrary,
  importWorkflowLibrary,
  LEGACY_FORMAT_ERROR,
} from '@/lib/import'
import type { EnvironmentPackageResult, LibraryPackageResult } from '@/lib/import'
import { importBatchml, BatchmlImportError } from '@/lib/batchml'
import { importWorkflow } from '@/stores/specificationStore/flows'
import type { ConflictDialogResult } from '@/components/import/ImportConflictDialog'
import type { Library } from '@/types/library'
import type { ImportPlan, PostImportReport } from '@/types/wflibx-import'
import { importToastMessage, needsImportReport } from '@/components/import/import-report-summary'
import { useSpecCreation } from './spec-creation'
import { createLibrary as createLibraryFlow } from '@/stores/specificationStore/libraryCrud'

// =============================================================================
// Dialog State Types (exported for LibrarySidebar.tsx)
// =============================================================================

export interface ConflictDialogState {
  open: boolean
  importedName: string
  importedVersion: string
  existingVersion: string
  onResolve: (result: ConflictDialogResult) => void
  onCancel: () => void
}

export interface WarningsDialogState {
  open: boolean
  workflowName: string
  unresolvedProxies: string[]
  specificationId: string
  libraryId: string
}

export function useLibraryImport(
  setShowLegacyFormatDialog: (show: boolean) => void,
  _setConflictDialogState: (state: ConflictDialogState | null) => void,
  _setWarningsDialogState: (state: WarningsDialogState | null) => void,
  setImportError: (error: string | null) => void,
  setImportPlan: (
    state: {
      plan: ImportPlan
      onCommit: (r: Record<string, 'keep' | 'replace'>, teamId: string) => Promise<void>
    } | null,
  ) => void,
  setPostImportReport: (report: PostImportReport | null) => void,
) {
  const activeEntityType = useLibraryStore((s) => s.activeEntityType)
  const fetchLibraries = useLibraryStore((s) => s.fetchLibraries)

  const createLibrary = async (name: string, entityType: string, _parentId?: string): Promise<Library | null> => {
    const result = await createLibraryFlow({
      name,
      entityType: entityType as 'workflow' | 'action' | 'environment' | 'step',
      teamId: useLibraryStore.getState().selectedTeamId ?? '',
    })
    if (!result) return null
    return result as unknown as Library
  }

  const { createSpecsForLibrary, createChildLibraries, ensureActionSpecsLoaded } = useSpecCreation()

  /**
   * Handle import result - creates a new library, its specifications, and child libraries.
   * Used for non-workflow library types via the file picker drop zone.
   */
  const handleImportResult = async (result: ImportResult) => {
    if (!result.library) return

    try {
      const newLibrary = await createLibrary(result.library.name, activeEntityType)
      if (!newLibrary) {
        toast.error('Failed to create library')
        return
      }

      await createSpecsForLibrary(newLibrary.id, result.specifications || [])

      if (result.childLibraries && result.childLibraries.length > 0) {
        await createChildLibraries(newLibrary.id, result.childLibraries, activeEntityType)
      }

      await fetchLibraries()
      toast.success(`Imported ${result.library.name}`)
    } catch (error) {
      console.error('[import] handleImportResult failed:', error)
      toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Handle import error - show toast notification.
   * For legacy format errors, shows the blocking LegacyFormatDialog instead.
   */
  const handleImportError = (error: string) => {
    if (error === LEGACY_FORMAT_ERROR) {
      setShowLegacyFormatDialog(true)
      return
    }
    console.error('[import] Import error:', error)
    toast.error(`Import failed: ${error}`)
  }

  /**
   * Handle importing a runtime package (.WFmasterX) into a workflow library.
   * Delegates entirely to the server-side importWorkflow flow helper (§4.8).
   */
  const handleRuntimePackageImport = async (libraryId: string, file: File) => {
    try {
      const { rootSpecId, libraryName } = await importWorkflow(file, libraryId)

      // Sync the libraryStore view to the refreshed specificationStore. The
      // flow helper already called specStore.loadLibraries() to pick up any
      // env / action libraries the server auto-created from the ZIP's
      // environments/ + actions/ siblings; without this fetchLibraries call
      // the sidebar still renders the pre-import library list and the new
      // libraries appear only after a page reload. Every other handler in
      // this file does the same view-layer sync after a successful import.
      await fetchLibraries()

      // Auto-open the imported workflow in the editor
      useLibraryStore.getState().setSelectedSpecification(rootSpecId, libraryId)
      toast.success(`Imported runtime package "${libraryName}"`)
    } catch (error) {
      console.error('[import] handleRuntimePackageImport failed:', error)
      setImportError(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  /**
   * Handle importing a workflow library package (.WFlibX ZIP).
   * Calls /preview to build an ImportPlan, opens the conflict dialog
   * if there are any conflicts, then calls /commit and surfaces the
   * post-import report.
   */
  const handleWorkflowLibraryPackageImport = async (file: File) => {
    const toastId = toast.loading('Analyzing workflow library bundle...')
    try {
      const { api, ApiError } = await import('@/stores/specificationStore/apiClient')
      const plan = await api.previewWorkflowLibraryImport(file)
      const meaningful = plan.rows.filter((r) => r.status.tag !== 'no-op')

      if (meaningful.length === 0) {
        toast.info('Nothing to import — every element already exists with the same OID.', { id: toastId })
        return
      }

      const commitAndReport = async (resolutions: Record<string, 'keep' | 'replace'>, teamId: string) => {
        let report: PostImportReport
        try {
          report = await api.commitWorkflowLibraryImport({ previewId: plan.previewId, resolutions, teamId })
        } catch (error) {
          // A spec turned released between preview and commit (spec 2026-10-21 §6).
          const message =
            error instanceof ApiError && error.code === 'locked_replace'
              ? 'a spec you chose to replace is released or no longer yours to replace — import the file again'
              : error instanceof Error
                ? error.message
                : 'Unknown error'
          toast.error(`Workflow library import failed: ${message}`, { id: toastId, duration: Infinity })
          return
        }
        toast.success(importToastMessage(plan.bundleLibraryName, report), { id: toastId })
        // The server has new library + spec rows. The client's caches don't.
        // `fetchLibraries` alone re-syncs the libraryStore from
        // specificationStore.libraries — but specificationStore is a
        // client-side cache that does NOT refetch from server after boot,
        // so newly-imported libraries never show up. Same for specs:
        // `ensureLibrarySpecs` short-circuits if any spec for the library
        // is already cached, so newly-added specs are silently missed.
        // Force-reload from server, then sync the view.
        const specStore = useSpecificationStore.getState()
        await specStore.loadLibraries()
        const touchedLibIds = new Set<string>()
        for (const row of plan.rows) {
          if (row.status.tag === 'no-op' || row.status.tag === 'refused') continue
          if (row.status.tag === 'conflict' && resolutions[row.bundleOid] === 'keep') continue
          if (row.kind === 'library') touchedLibIds.add(row.bundleOid)
          if (row.kind === 'specification' && row.parentLibraryOid) touchedLibIds.add(row.parentLibraryOid)
        }
        for (const libId of touchedLibIds) {
          const resp = await api.listLibrarySpecs(libId)
          const fresh = useSpecificationStore.getState()
          const missing: string[] = []
          for (const s of resp.specs) {
            const id = (s as { id: string }).id
            if (typeof id === 'string' && !fresh.specs.has(id)) missing.push(id)
          }
          if (missing.length > 0) await fresh.loadBulk(missing)
        }
        await fetchLibraries()
        for (const libId of touchedLibIds) {
          await useLibraryStore.getState().fetchSpecifications(libId)
        }
        if (needsImportReport(report)) {
          // Mounted by LibrarySidebar; pass via dedicated setter exported below.
          setPostImportReport(report)
        }
      }

      // Always hand off to the dialog so the user picks/confirms the target team.
      setImportPlan({ plan, onCommit: commitAndReport })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Workflow library import failed: ${message}`, { id: toastId, duration: Infinity })
    }
  }

  /**
   * Handle importing a library package (ZIP) for action, environment, or step libraries.
   * Auto-detects type from the root file extension inside the ZIP.
   */
  const handleLibraryPackageImport = async (file: File) => {
    try {
      const result = await importLibraryPackage(file)
      if ('error' in result) {
        toast.error(`Import failed: ${result.error}`)
        return
      }

      // Route single-environment packages to their own handler
      if ('packageType' in result && result.packageType === 'environment-package') {
        await handleEnvironmentPackageImport(result)
        return
      }

      // After this point, result is known to be LibraryPackageResult (env-package
      // and ImportError branches handled above).
      const libResult = result as LibraryPackageResult

      // 1. Import action libraries first (environments may reference them).
      // Self-contained WFenvirX semantics: if the named action library is
      // missing, create it with all bundled specs. If it already exists,
      // add only the specs whose names aren't already present — never
      // replace an existing spec.
      for (const actionEntry of libResult.actionLibraries) {
        const actionResult = importActionLibrary(actionEntry.json)
        if ('error' in actionResult) {
          console.error(`[import] Skipping action library "${actionEntry.name}":`, actionResult.error)
          continue
        }
        const bundledSpecs = actionResult.specifications || []
        const allLibs = useLibraryStore.getState().libraries
        const existing = pickLibraryByName(
          allLibs,
          actionEntry.name,
          'action',
          useLibraryStore.getState().selectedTeamId,
        )
        if (existing) {
          if (!mayAddSpecsTo(existing, usePrincipalStore.getState().principal)) {
            toast.info(`Used the GLOBAL library "${existing.name}" as it is`)
            continue
          }
          if (bundledSpecs.length === 0) continue
          // Ensure the existing lib's spec list is loaded, then add only missing.
          if (!useLibraryStore.getState().specifications.has(existing.id)) {
            await useLibraryStore.getState().fetchSpecifications(existing.id)
          }
          const existingSpecs = useLibraryStore.getState().specifications.get(existing.id) || []
          const existingNames = new Set(existingSpecs.map((s) => s.name))
          const toAdd = bundledSpecs.filter((s) => !existingNames.has(s.name))
          if (toAdd.length > 0) {
            await createSpecsForLibrary(existing.id, toAdd)
          }
          continue
        }
        const newLib = await createLibrary(actionEntry.name, 'action')
        if (!newLib) continue
        await createSpecsForLibrary(newLib.id, bundledSpecs)
        if (actionResult.childLibraries && actionResult.childLibraries.length > 0) {
          await createChildLibraries(newLib.id, actionResult.childLibraries as ImportResult[], 'action')
        }
      }

      // 2. Import environment libraries
      if (libResult.environmentLibraries.length > 0) {
        await ensureActionSpecsLoaded()
        for (const envEntry of libResult.environmentLibraries) {
          const envResult = importEnvironmentLibrary(envEntry.json)
          if ('error' in envResult) {
            console.error(`[import] Skipping environment library "${envEntry.name}":`, envResult.error)
            continue
          }
          const allLibs = useLibraryStore.getState().libraries
          const existing = pickLibraryByName(
            allLibs,
            envEntry.name,
            'environment',
            useLibraryStore.getState().selectedTeamId,
          )
          if (existing) continue
          const newLib = await createLibrary(envEntry.name, 'environment')
          if (!newLib) continue
          await createSpecsForLibrary(newLib.id, envResult.specifications || [])
          if (envResult.childLibraries && envResult.childLibraries.length > 0) {
            await createChildLibraries(newLib.id, envResult.childLibraries as ImportResult[], 'environment')
          }
        }
      }

      // 3. Import the main library
      let mainResult
      switch (libResult.entityType) {
        case 'action':
          mainResult = importActionLibrary(libResult.libraryJson)
          break
        case 'environment':
          mainResult = importEnvironmentLibrary(libResult.libraryJson)
          break
        case 'step':
          mainResult = importStepLibrary(libResult.libraryJson)
          break
        default:
          toast.error(`Unsupported library type: ${libResult.entityType}`)
          return
      }

      if ('error' in mainResult) {
        toast.error(`Import failed: ${mainResult.error}`)
        return
      }

      const newLibrary = await createLibrary(mainResult.library!.name, libResult.entityType)
      if (!newLibrary) {
        toast.error('Failed to create library')
        return
      }

      await createSpecsForLibrary(newLibrary.id, mainResult.specifications || [])

      if (mainResult.childLibraries && mainResult.childLibraries.length > 0) {
        await createChildLibraries(newLibrary.id, mainResult.childLibraries as ImportResult[], libResult.entityType)
      }

      await fetchLibraries()
      toast.success(`Imported library package "${libResult.libraryName}"`)
    } catch (error) {
      console.error('[import] handleLibraryPackageImport failed:', error)
      toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Handle importing a single-environment package (.WFenvirX with packageType
   * 'environment-package').
   *
   * Strategy:
   * 1. Import bundled action specs first (add-only to existing libs, or create new).
   * 2. Create or reuse an environment library named after the env spec.
   * 3. Upsert the env spec into that library (add if not already present by name).
   *
   * No images — single-env packages do not carry an images/ folder.
   */
  /**
   * Import bundled action libraries from an environment-package result.
   *
   * For each library group in `pkg.actionLibraries`: create the named action
   * library if it doesn't exist, or reuse the existing one. Action specs are
   * added add-only — an existing spec with the same name is never replaced.
   *
   * Returns a brief summary (libraries touched, specs added) for use in the
   * caller's success toast.
   */
  const importActionLibrariesFromPackage = async (
    pkg: EnvironmentPackageResult,
  ): Promise<{ librariesCreated: number; librariesReused: number; specsAdded: number }> => {
    let librariesCreated = 0
    let librariesReused = 0
    let specsAdded = 0
    await ensureActionSpecsLoaded()
    for (const libGroup of pkg.actionLibraries) {
      // Wrap the bare action specs in a minimal library envelope so the
      // validator can transform them. The envelope extends managed-element
      // and requires oid + last_modified_date — these are transient.
      const envelope = {
        local_id: libGroup.libraryName,
        oid: crypto.randomUUID(),
        version: '1.0.0',
        last_modified_date: new Date().toISOString(),
        action_specifications: libGroup.actionSpecs.map((a) => a.json),
      }
      const actionResult = importActionLibrary(envelope)
      if ('error' in actionResult) {
        console.error(`[import] Skipping action library "${libGroup.libraryName}":`, actionResult.error)
        continue
      }
      const bundledSpecs = actionResult.specifications || []
      const allLibs = useLibraryStore.getState().libraries
      const existing = pickLibraryByName(
        allLibs,
        libGroup.libraryName,
        'action',
        useLibraryStore.getState().selectedTeamId,
      )
      if (existing) {
        if (!mayAddSpecsTo(existing, usePrincipalStore.getState().principal)) {
          librariesReused++
          toast.info(`Used the GLOBAL library "${existing.name}" as it is`)
          continue
        }
        librariesReused++
        if (bundledSpecs.length === 0) continue
        if (!useLibraryStore.getState().specifications.has(existing.id)) {
          await useLibraryStore.getState().fetchSpecifications(existing.id)
        }
        const existingSpecs = useLibraryStore.getState().specifications.get(existing.id) || []
        const existingNames = new Set(existingSpecs.map((s) => s.name))
        const toAdd = bundledSpecs.filter((s) => !existingNames.has(s.name))
        if (toAdd.length > 0) {
          await createSpecsForLibrary(existing.id, toAdd)
          specsAdded += toAdd.length
        }
        continue
      }
      const newActionLib = await createLibrary(libGroup.libraryName, 'action')
      if (!newActionLib) continue
      librariesCreated++
      await createSpecsForLibrary(newActionLib.id, bundledSpecs)
      specsAdded += bundledSpecs.length
    }
    return { librariesCreated, librariesReused, specsAdded }
  }

  const handleEnvironmentPackageImport = async (pkg: EnvironmentPackageResult) => {
    // 1. Import bundled action libraries (shared helper).
    await importActionLibrariesFromPackage(pkg)

    // 2. Wrap the bare env spec in a minimal environment-library envelope so
    //    importEnvironmentLibrary can validate + transform it. The envelope
    //    extends managed-element and requires oid + last_modified_date even
    //    though it's a transient wrapper, not a persisted library.
    const envEnvelope = {
      local_id: pkg.envName,
      oid: crypto.randomUUID(),
      version: '1.0.0',
      last_modified_date: new Date().toISOString(),
      environment_specifications: [pkg.envSpecJson],
    }
    const envResult = importEnvironmentLibrary(envEnvelope)
    if ('error' in envResult) {
      toast.error(`Import failed: ${envResult.error}`)
      return
    }

    // 3. Create or reuse the environment library
    const allLibs = useLibraryStore.getState().libraries
    const existing = pickLibraryByName(allLibs, pkg.envName, 'environment', useLibraryStore.getState().selectedTeamId)
    if (existing && !mayAddSpecsTo(existing, usePrincipalStore.getState().principal)) {
      toast.info(`Used the GLOBAL library "${existing.name}" as it is`)
    } else if (existing) {
      // Library already exists — add any missing env specs
      if (!useLibraryStore.getState().specifications.has(existing.id)) {
        await useLibraryStore.getState().fetchSpecifications(existing.id)
      }
      const existingSpecs = useLibraryStore.getState().specifications.get(existing.id) || []
      const existingNames = new Set(existingSpecs.map((s) => s.name))
      const toAdd = (envResult.specifications || []).filter((s) => !existingNames.has(s.name))
      if (toAdd.length > 0) {
        await createSpecsForLibrary(existing.id, toAdd)
      }
    } else {
      const newEnvLib = await createLibrary(pkg.envName, 'environment')
      if (!newEnvLib) {
        toast.error('Failed to create environment library')
        return
      }
      await createSpecsForLibrary(newEnvLib.id, envResult.specifications || [])
    }

    await fetchLibraries()
    toast.success(`Imported environment "${pkg.envName}"`)
  }

  /**
   * Import a single spec file (.WFaction, .WFenvir, or .WFenvirX) into an
   * existing library.
   *
   * Routing:
   *  - .WFaction  → bare JSON action spec → action library validator
   *  - .WFenvir   → bare JSON env spec    → env library validator
   *  - .WFenvirX  → ZIP single-env package (manifest packageType: 'environment-package')
   *                 → unwrap, take just the env spec, drop bundled actions
   *                 (the menu's framing is "Import Environment" — single spec only;
   *                 bundled actions can be imported separately via "Import Library").
   */
  const handleSingleSpecImport = async (libraryId: string, file: File) => {
    try {
      const isAction = file.name.endsWith('.WFaction')
      const isEnvironment = file.name.endsWith('.WFenvir')
      const isEnvirX = file.name.endsWith('.WFenvirX')

      if (isEnvirX) {
        const pkg = await importLibraryPackage(file)
        if ('error' in pkg) {
          toast.error(`Import failed: ${pkg.error}`)
          return
        }
        if (!('packageType' in pkg) || pkg.packageType !== 'environment-package') {
          toast.error(
            'Selected .WFenvirX is not a single-environment package (use Import Library for env-library ZIPs).',
          )
          return
        }
        // First ingest the bundled action libraries — without their actions
        // the env would reference specs the user doesn't have. Shared helper
        // with handleEnvironmentPackageImport: same add-only semantics, same
        // library-create-or-reuse logic.
        const actionSummary = await importActionLibrariesFromPackage(pkg)

        // Wrap the bare env spec in a minimal env-library envelope so the
        // validator can transform it; then add the env spec(s) into the
        // user's chosen target library. The envelope extends managed-element
        // and requires oid + last_modified_date — synthesize them since the
        // envelope is only a transient wrapper for validator input.
        const envelope = {
          local_id: pkg.envName,
          oid: crypto.randomUUID(),
          version: '1.0.0',
          last_modified_date: new Date().toISOString(),
          environment_specifications: [pkg.envSpecJson],
        }
        const envResult = importEnvironmentLibrary(envelope)
        if ('error' in envResult) {
          toast.error(`Import failed: ${envResult.error}`)
          return
        }
        await createSpecsForLibrary(libraryId, envResult.specifications || [])
        await fetchLibraries()
        const parts = [`Imported environment "${pkg.envName}"`]
        if (actionSummary.librariesCreated > 0 || actionSummary.librariesReused > 0) {
          const libParts: string[] = []
          if (actionSummary.librariesCreated > 0) libParts.push(`${actionSummary.librariesCreated} new`)
          if (actionSummary.librariesReused > 0) libParts.push(`${actionSummary.librariesReused} existing`)
          parts.push(`+ ${actionSummary.specsAdded} action(s) into ${libParts.join(' / ')} library/libraries`)
        }
        toast.success(parts.join(' '))
        return
      }

      const text = await file.text()
      const data = JSON.parse(text)

      let result
      if (isAction) {
        result = importActionLibrary(data)
      } else if (isEnvironment) {
        result = importEnvironmentLibrary(data)
      } else {
        toast.error('Unsupported file type')
        return
      }

      if ('error' in result) {
        toast.error(`Import failed: ${result.error}`)
        return
      }

      await createSpecsForLibrary(libraryId, result.specifications || [])
      await fetchLibraries()
      toast.success(`Imported ${result.specifications?.length ?? 0} spec(s) into library`)
    } catch (error) {
      console.error('[import] handleSingleSpecImport failed:', error)
      toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Import a Designer-authored BatchML file (.batchml.xml) into a workflow library.
   * Recovers the exact canonical spec from the embedded payload, wraps it in a
   * transient workflow-library envelope, and reuses the standard
   * importWorkflowLibrary → createSpecsForLibrary path.
   */
  const handleBatchmlImport = async (libraryId: string, file: File) => {
    try {
      const spec = importBatchml(await file.text())
      const envelope = {
        local_id: spec.local_id ?? 'Imported Workflow',
        oid: crypto.randomUUID(),
        version: '1.0.0',
        last_modified_date: new Date().toISOString(),
        workflow_specifications: [spec],
      }
      const result = importWorkflowLibrary(envelope)
      if ('error' in result) {
        toast.error(`Import failed: ${result.error}`)
        return
      }
      await createSpecsForLibrary(libraryId, result.specifications || [])
      await fetchLibraries()
      toast.success(`Imported "${spec.local_id}" from BatchML`)
    } catch (error) {
      const msg =
        error instanceof BatchmlImportError ? error.message : error instanceof Error ? error.message : 'Unknown error'
      toast.error(`BatchML import failed: ${msg}`)
    }
  }

  return {
    handleImportResult,
    handleImportError,
    handleRuntimePackageImport,
    handleWorkflowLibraryPackageImport,
    handleLibraryPackageImport,
    handleSingleSpecImport,
    handleBatchmlImport,
  }
}
