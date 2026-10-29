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

// Phase 35 §4.8/§4.9/§4.10/§4.11/§4.12: cross-cutting flows that touch the store
// and the network together. Each flow is a plain async function; consumers
// import by name and call with the current store.

import { useSpecificationStore } from '../specificationStore'
import { withVersionSuffix } from '@/lib/export/filename'
import { api } from './apiClient'

/** §4.8 — import a workflow package into the target library, then refresh the library's tree. */
export async function importWorkflow(
  file: File,
  targetLibraryId: string,
): Promise<{ rootSpecId: string; libraryName: string }> {
  const result = await api.importWorkflow(file, targetLibraryId)
  // The server-side importer (server/packageFormat/importLibrariesFromZip.ts)
  // may auto-create env + action libraries from the ZIP's environments/ and
  // actions/ siblings so the workflow's `library_name` env links can resolve.
  // The spec-store cache was populated at boot and is NOT auto-refreshed —
  // calling loadLibraries() here pulls those newly-created library rows in
  // before the view layer (libraryStore.fetchLibraries) reads them. Without
  // this, auto-created libraries exist in the DB but never appear in the
  // sidebar until the user reloads the page.
  await useSpecificationStore.getState().loadLibraries()
  await useSpecificationStore.getState().loadTree(result.rootSpecId)
  const lib = useSpecificationStore.getState().libraries.get(targetLibraryId)
  return { rootSpecId: result.rootSpecId, libraryName: lib?.name ?? '' }
}

/** §4.9 — export a workflow, returns the Blob + sanitized filename.
 *  Accepts any spec in the workflow tree; resolves to the root before calling the API
 *  (server requires a root spec and 404s otherwise).
 *  Filename derives from the workflow's root spec name, not the library — this is a
 *  single-workflow package, not a library archive. */
export async function exportWorkflow(specId: string): Promise<{ blob: Blob; filename: string; warnings: string[] }> {
  const spec = useSpecificationStore.getState().specs.get(specId)
  const rootSpecId = spec?.rootSpecificationId ?? specId
  const { blob, warnings } = await api.exportWorkflow(rootSpecId)
  const root = useSpecificationStore.getState().specs.get(rootSpecId)
  const safe = (root?.name ?? 'workflow').replace(/[^A-Za-z0-9._-]/g, '_')
  const safeVersion = (root?.version ?? '').replace(/[^A-Za-z0-9._-]/g, '_')
  return { blob, filename: `${withVersionSuffix(safe, safeVersion)}.WFmasterX`, warnings }
}

/** §4.10 — step library drag: copy a spec from one lib to another (client-side dirty path). */
export async function copySpecFromStepLibrary(
  sourceSpecId: string,
  targetLibraryId: string,
  parentSpecId: string | null,
): Promise<string> {
  const state = useSpecificationStore.getState()
  const source = state.specs.get(sourceSpecId)
  if (!source) throw new Error(`source spec not found: ${sourceSpecId}`)

  // Create a new spec via createSpecInMemory with isFromCopyLoop=true so it's gated from batchSave.
  const newId = state.createSpecInMemory({
    parentId: parentSpecId,
    libraryId: targetLibraryId,
    init: {
      name: source.name,
      description: source.description,
      typeName: source.typeName,
      version: '1.0.0',
      state: 'Draft',
      data: structuredClone(source.data) as Record<string, unknown>,
      dataSchemaVersion: source.dataSchemaVersion,
    },
    isFromCopyLoop: true,
  })

  // Issue the first batchSave to land the spec row on the server
  await state.batchSave()

  // Phase 3 simplification: image re-referencing is handled server-side when the
  // spec is created via batch-save; this helper only covers the client-side dirty state.

  // Release from pendingCreationIds so subsequent edits flow normally
  state.releaseFromPendingCreation(newId)
  return newId
}

/** §4.11 — hover preview: load a spec with LRU cap 50 + AbortController for hover-off. */
const PREVIEW_LRU_CAP = 50

export async function hoverPreviewLoad(specId: string): Promise<void> {
  const state = useSpecificationStore.getState()
  const existing = state.inflightPreviewLoads.get(specId)
  if (existing) return // already in flight

  const controller = new AbortController()
  useSpecificationStore.setState((d) => {
    d.inflightPreviewLoads.set(specId, controller)
    d.currentlyPreviewedId = specId
    // LRU bump
    d.previewLruIds = [specId, ...d.previewLruIds.filter((id) => id !== specId)]
    // Evict beyond cap (but never the current preview or any loadedRootId)
    while (d.previewLruIds.length > PREVIEW_LRU_CAP) {
      const victim = d.previewLruIds.pop()
      if (victim && victim !== d.currentlyPreviewedId && !d.loadedRootIds.has(victim)) {
        d.specs.delete(victim)
      }
    }
  })

  try {
    await state.loadSpec(specId)
  } catch (err) {
    if (controller.signal.aborted) return
    throw err
  } finally {
    useSpecificationStore.setState((d) => {
      d.inflightPreviewLoads.delete(specId)
    })
  }
}

export function hoverPreviewCancel(specId: string): void {
  const state = useSpecificationStore.getState()
  const controller = state.inflightPreviewLoads.get(specId)
  if (controller) controller.abort()
  useSpecificationStore.setState((d) => {
    d.inflightPreviewLoads.delete(specId)
    if (d.currentlyPreviewedId === specId) d.currentlyPreviewedId = null
  })
}
