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

// Phase 1 — v7.0 envelope migration.
//
// Server-side ZIP builder for single-workflow runtime packages (.WFmasterX).
// Uses the lifted exporter at @/lib/packageFormat to produce the workflow
// JSON so the runtime contract (TrajectoryRuntime's spec/docs/editor-export-format.md)
// is honored from one source of truth shared with the editor frontend.
//
// ZIP layout (per editor-export-format.md §1.1):
//   {WorkflowName}.WFmasterX
//   ├── {WorkflowName}.WFmaster      ← MasterWorkflowSpecification JSON
//   ├── manifest.json                 ← optional package metadata
//   ├── environments/                 ← optional, one .WFenvir per referenced env library
//   │   └── {EnvLibName}.WFenvir
//   └── images/
//       ├── {imageOid}-{filename}    ← form-element images
//       └── {filename}                ← UI parameter images

import { actionLibraryRefs, pickLibraryByName } from '@/lib/global-team'
import JSZip from 'jszip'
import type { ReadContext, SpecTree } from '../dao/specReadDao'
import { specReadDao } from '../dao/specReadDao'
import { loadImageBytesForSpecs } from './loadImageBytes'
import { adaptSpecTree } from './specTreeAdapter'
import { inlineReferencedSteps } from './inlineReferencedSteps'
import {
  exportWorkflowSpec,
  exportEnvironmentLibrary,
  exportActionLibrary,
  collectImageFilenames,
  collectFormElementImages,
  type MasterWorkflowSpecification,
} from '@/lib/packageFormat'
import type { Library as ClientLibrary, Specification as ClientSpecification } from '@/types/library'

export interface BuildWorkflowPackageOptions {
  tree: SpecTree
  ctx: ReadContext
  /** Workflow name → ZIP filename (sanitized to a safe ASCII subset). Falls back to 'workflow'. */
  workflowName: string
}

export interface BuildWorkflowPackageResult {
  zipBytes: Uint8Array
  /** Sanitized name without the `.WFmasterX` extension; the route uses this for content-disposition. */
  safeName: string
  /** Images the export could NOT carry (malformed data URI / undecodable base64) — audit item 3:
   *  previously dropped silently, leaving the ZIP quietly incomplete. */
  warnings: string[]
}

const SAFE_NAME_RE = /[^A-Za-z0-9._-]/g

function sanitizeName(name: string): string {
  return (name || 'workflow').replace(SAFE_NAME_RE, '_').slice(0, 200)
}

/**
 * Build a v7.0 single-workflow runtime package (.WFmasterX) ZIP for the given
 * spec tree.
 */
export async function buildWorkflowPackage(options: BuildWorkflowPackageOptions): Promise<BuildWorkflowPackageResult> {
  const { tree, ctx, workflowName } = options
  const warnings: string[] = []

  // 1. Adapt server SpecTree to the shape the lifted exporter consumes.
  //    Note: adaptSpecTree only returns workflow + referenced env libraries;
  //    action libraries are loaded separately below so the env exporter can
  //    inline action bodies into included_actions[].
  const adapted = await adaptSpecTree(tree, ctx)

  //    Resolve every workflowProxy with subWorkflowMode='reference' to a
  //    deep-copied embedded child with fresh oids. After this call the
  //    package is fully self-contained — no cross-library reference remains.
  await inlineReferencedSteps(adapted, ctx)

  const { rootSpec, childTree, allSpecs, allLibraries } = adapted

  // Group specs by libraryId — built up incrementally as we load more.
  const allSpecsByLibrary = new Map<string, ClientSpecification[]>()
  for (const s of allSpecs) {
    const list = allSpecsByLibrary.get(s.libraryId)
    if (list) list.push(s)
    else allSpecsByLibrary.set(s.libraryId, [s])
  }

  // 2. Collect env lib IDs referenced by the workflow tree.
  const envLibIds = new Set<string>()
  for (const s of allSpecs) {
    const envIds = (s.data as Record<string, unknown>).environmentSpecIds
    if (Array.isArray(envIds)) {
      for (const id of envIds) {
        const envSpec = allSpecs.find((x) => x.id === id)
        if (envSpec) envLibIds.add(envSpec.libraryId)
      }
    }
  }

  // 3. Load action libraries referenced by env specs' included_actions[] and
  //    add them to allLibraries + allSpecsByLibrary so resolveActionBody (called
  //    from exportEnvironmentSpec) can inline the full MasterActionSpecification
  //    body into each included_actions[] entry. The environment is the runtime
  //    contract: workflow runs against an environment, not against an action
  //    library — so the env file must be self-contained.
  // Each name resolves preferring the team of the environment that names it (spec 2026-10-12 U4).
  const envLibTeams = new Map<string, string | null>()
  for (const envLibId of envLibIds) {
    envLibTeams.set(envLibId, (await specReadDao.getLibrary(ctx, envLibId))?.teamId ?? null)
  }
  const referencedActionLibNames = actionLibraryRefs(
    allSpecs.filter((s) => envLibIds.has(s.libraryId)),
    (id) => envLibTeams.get(id),
  )
  const loadedActionLibs = await loadActionLibrariesByName(referencedActionLibNames, ctx)
  for (const { library, specs } of loadedActionLibs) {
    allLibraries.push(library)
    allSpecsByLibrary.set(library.id, specs)
    for (const spec of specs) allSpecs.push(spec)
  }

  // 4. Produce the v7.0 MasterWorkflowSpecification JSON. Embedded env specs
  //    inside `environment_specifications[]` will inline action bodies because
  //    action libs are now in allLibraries.
  const workflowJson: MasterWorkflowSpecification = exportWorkflowSpec(
    rootSpec,
    allSpecs,
    allLibraries,
    undefined,
    childTree,
    undefined,
    undefined,
    undefined,
    { warnings }, // GATE follow-up item 5: gate-binding warnings join the image warnings
  )

  // 5. Per-env-library exports under environments/ — also inline action bodies. These files are
  //    what a Designer import rebuilds the environment from, so they carry Value Types. The
  //    workflow JSON's embedded environments above do not: nothing reads them from there.
  const envLibraryExports: Array<{ name: string; data: unknown }> = []
  for (const libId of envLibIds) {
    const lib = allLibraries.find((l) => l.id === libId)
    if (!lib) continue
    const specs = allSpecsByLibrary.get(libId) ?? []
    if (specs.length === 0) continue
    envLibraryExports.push({
      name: lib.name,
      data: exportEnvironmentLibrary(lib, specs, undefined, allLibraries, allSpecsByLibrary, {
        includeValueTypes: true,
      }),
    })
  }

  // 6. Action library exports under actions/ — reuse the libs loaded in step 3
  //    so the editor's import side can reconstruct the action library.
  const actionLibraryExports: Array<{ name: string; data: unknown }> = loadedActionLibs.map(({ library, specs }) => ({
    name: library.name,
    data: exportActionLibrary(library, specs),
  }))

  // 4. Walk the workflow JSON for image references the runtime needs.
  const stepImageFilenames = new Set<string>(collectImageFilenames(workflowJson.steps ?? []))
  const formImageEntries = collectFormElementImages(workflowJson.steps ?? [])

  // Recursively walk children for their image references too.
  type ChildSpec = NonNullable<MasterWorkflowSpecification['children']>[number]
  const walkChildren = (children: ChildSpec[]) => {
    for (const c of children) {
      for (const f of collectImageFilenames(c.steps ?? [])) stepImageFilenames.add(f)
      for (const e of collectFormElementImages(c.steps ?? [])) {
        formImageEntries.push(e)
      }
      if (c.children && c.children.length > 0) {
        walkChildren(c.children as ChildSpec[])
      }
    }
  }
  if (workflowJson.children && workflowJson.children.length > 0) {
    walkChildren(workflowJson.children as ChildSpec[])
  }

  // 5. Load image bytes for every spec in the tree (same as v3 path).
  const imageMap = await loadImageBytesForSpecs(tree.specs.map((s) => s.id))
  const flatImageBytes = new Map<string, Uint8Array>()
  for (const [, images] of imageMap.entries()) {
    for (const img of images) {
      // image-collectors filenames are the bare filename. The DB stores them by
      // (specificationId, filename), so any matching filename is acceptable —
      // image bytes are content-addressed via image_blob.
      if (!flatImageBytes.has(img.filename)) flatImageBytes.set(img.filename, img.bytes)
    }
  }

  // 5b. Also extract image bytes from spec.data.images data URIs. The form
  //     designer's upload flow writes images here (filename → "data:...;base64,...")
  //     and the renderer reads them straight back — the legacy image_blob/image
  //     tables are populated only by the import path, so for any workflow that
  //     was created or edited in the UI, its image bytes live exclusively in
  //     spec.data.images. Decoding them here lets the export ZIP carry the bytes
  //     as binary images/* entries the runtime can resolve.
  for (const spec of allSpecs) {
    const images = (spec.data as Record<string, unknown>).images as Record<string, string> | undefined
    if (!images) continue
    for (const [filename, dataUri] of Object.entries(images)) {
      if (typeof dataUri !== 'string') continue
      if (flatImageBytes.has(filename)) continue
      const match = /^data:[^;]+;base64,(.+)$/.exec(dataUri)
      if (!match) {
        warnings.push(`Image "${filename}" not exported: spec.data.images value is not a base64 data URI`)
        continue
      }
      try {
        flatImageBytes.set(filename, Buffer.from(match[1], 'base64'))
      } catch {
        // Malformed base64 — skip rather than fail the whole export, but say so.
        warnings.push(`Image "${filename}" not exported: base64 payload failed to decode`)
      }
    }
  }

  // 6. Assemble the ZIP
  const safeName = sanitizeName(workflowName)
  const zip = new JSZip()
  zip.file(`${safeName}.WFmaster`, JSON.stringify(workflowJson, null, 2))

  for (const env of envLibraryExports) {
    zip.file(`environments/${env.name}.WFenvir`, JSON.stringify(env.data, null, 2))
  }
  for (const action of actionLibraryExports) {
    zip.file(`actions/${action.name}.WFaction`, JSON.stringify(action.data, null, 2))
  }

  // UI parameter images: bare filename
  for (const filename of stepImageFilenames) {
    const bytes = flatImageBytes.get(filename)
    if (!bytes) continue
    zip.file(`images/${filename}`, bytes)
  }
  // Form-element images: {imageOid}-{filename}
  const seenFormPaths = new Set<string>()
  for (const entry of formImageEntries) {
    if (seenFormPaths.has(entry.zipPath)) continue
    seenFormPaths.add(entry.zipPath)
    // entry.imageStoreKey = bare filename in our DB; bytes look up that way.
    const bytes = flatImageBytes.get(entry.imageStoreKey) ?? flatImageBytes.get(entry.zipPath)
    if (!bytes) continue
    zip.file(`images/${entry.zipPath}`, bytes)
  }

  // 7. Manifest (optional per runtime spec, but useful for forward-compat)
  const fileEntries: Array<{ path: string; type: string }> = [{ path: `${safeName}.WFmaster`, type: 'workflow' }]
  for (const env of envLibraryExports) {
    fileEntries.push({ path: `environments/${env.name}.WFenvir`, type: 'environment' })
  }
  for (const action of actionLibraryExports) {
    fileEntries.push({ path: `actions/${action.name}.WFaction`, type: 'action' })
  }
  for (const filename of stepImageFilenames) {
    if (flatImageBytes.has(filename)) fileEntries.push({ path: `images/${filename}`, type: 'image' })
  }
  for (const entry of formImageEntries) {
    if (!seenFormPaths.has(entry.zipPath)) continue
    if (flatImageBytes.has(entry.imageStoreKey) || flatImageBytes.has(entry.zipPath)) {
      fileEntries.push({ path: `images/${entry.zipPath}`, type: 'image' })
    }
  }

  const manifest = {
    packageVersion: '1.0',
    workflowName,
    environmentLibraries: envLibraryExports.map((e) => e.name),
    actionLibraries: actionLibraryExports.map((a) => a.name),
    createdAt: new Date().toISOString(),
    files: fileEntries,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  const zipBytes = await zip.generateAsync({ type: 'uint8array' })
  return { zipBytes, safeName, warnings }
}

/**
 * Loads action libraries (and their specs) referenced by the workflow's
 * environment specs. Returns adapted ClientLibrary + ClientSpecification[] pairs
 * ready to be merged into the exporter's allLibraries / allSpecsByLibrary maps.
 *
 * Names that don't resolve to a library visible to the caller are silently
 * dropped — the runtime can still use the embedded environment_specifications
 * to resolve actions, and the editor's import side will recreate them from
 * whatever subset survives. Aligns with the spec doc's "drop unresolved refs"
 * behavior.
 */
async function loadActionLibrariesByName(
  names: Map<string, string | null>,
  ctx: ReadContext,
): Promise<Array<{ library: ClientLibrary; specs: ClientSpecification[] }>> {
  if (names.size === 0) return []

  const visibleActionLibs = await specReadDao.listVisibleLibraries(ctx, { entityType: 'action' })
  const result: Array<{ library: ClientLibrary; specs: ClientSpecification[] }> = []

  for (const [name, preferTeamId] of names) {
    // Team library wins over GLOBAL's on a name clash (spec 2026-10-12 U4).
    const lib = pickLibraryByName(visibleActionLibs, name, 'action', preferTeamId)
    if (!lib) continue

    // Action specs are flat children of the action library (no parent/root tree).
    // Read root specs (metadata) → fetch full data via getSpecs in one round.
    const rootMetas = await specReadDao.listRootSpecs(ctx, lib.id)
    const adaptedLib = adaptDaoLibraryForExport(lib)
    if (rootMetas.length === 0) {
      result.push({ library: adaptedLib, specs: [] })
      continue
    }

    const fullSpecs = await specReadDao.getSpecs(
      ctx,
      rootMetas.map((s) => s.id),
    )
    const clientSpecs: ClientSpecification[] = []
    for (const meta of rootMetas) {
      const full = fullSpecs.specs.get(meta.id)
      if (!full) continue
      clientSpecs.push(adaptDaoSpecForExport(full))
    }
    result.push({ library: adaptedLib, specs: clientSpecs })
  }

  return result
}

function adaptDaoLibraryForExport(row: {
  id: string
  parentLibraryId: string | null
  name: string
  entityType: string
  description: string | null
  author: string | null
  changeHistory: string | null
  version: string
  createdAt: number
  updatedAt: number
}): ClientLibrary {
  return {
    id: row.id,
    parentLibraryId: row.parentLibraryId,
    name: row.name,
    entityType: row.entityType as ClientLibrary['entityType'],
    description: row.description,
    author: row.author,
    changeHistory: row.changeHistory,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function adaptDaoSpecForExport(row: {
  id: string
  libraryId: string | null
  name: string
  description: string | null
  version: string | null
  state: string | null
  data: string
  history: import('@/types/specification-history').SpecificationHistoryEntry[]
  createdAt: number
  updatedAt: number
}): ClientSpecification {
  let data: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(row.data)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  } catch {
    // Bad JSON in DB — emit as empty object rather than fail the whole export.
  }
  return {
    id: row.id,
    libraryId: row.libraryId ?? '',
    name: row.name,
    description: row.description,
    version: row.version ?? '1.0.0',
    state: (row.state as ClientSpecification['state']) ?? 'Draft',
    data,
    history: row.history,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
