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

import { actionLibraryRefs } from '@/lib/global-team'
import { pickLibraryByName } from '@/lib/global-team'
import JSZip from 'jszip'
import type { Library, Specification } from '@/types/library'
import type { EntityType } from '@/types/library'
import { exportStepLibrary, exportEnvironmentLibrary, exportActionLibrary } from './library-exporters'
import { collectImageFilenames, collectFormElementImages } from './image-collectors'
import type { FormElementImageEntry } from './image-collectors'
import type { LibraryWithChildren, MasterWorkflowStepLibrary, MasterWorkflowSpecification } from './export-types'

export interface LibraryPackageOptions {
  tree: LibraryWithChildren
  entityType: EntityType
  images: Record<string, string>
  /** Required for step libraries to resolve environment/action dependencies */
  allSpecs?: Specification[]
  allLibraries?: Library[]
  allSpecsByLibrary?: Map<string, Specification[]>
}

/**
 * File extensions for library packages.
 * Convention: `X` suffix = outer ZIP container; no `X` = inner JSON file.
 *
 * Renamed in Layer 3:
 *   WFactionX  → WFactionLibX  (action library)
 *   WFenvirX   → WFenvirLibX   (environment library)
 *   WFslibX    → WFstepLibX    (step library)
 * New in Layer 3:
 *   WFenvirX   — single-environment package (env spec + included action specs, no container code)
 */
const PACKAGE_EXTENSIONS: Record<EntityType, string> & { environmentPackage: string } = {
  action: 'WFactionLibX',
  environment: 'WFenvirLibX',
  step: 'WFstepLibX',
  workflow: 'WFlibX', // handled separately by createWorkflowLibraryPackage
  environmentPackage: 'WFenvirX', // NEW: single env + included action specs
}

const INNER_JSON_EXTENSIONS: Record<EntityType, string> = {
  action: 'WFaction',
  environment: 'WFenvir',
  step: 'WFslib',
  workflow: 'WFlib',
}

/** Manifest packageType for each entity type */
const PACKAGE_TYPES: Record<EntityType, string> & { environmentPackage: string } = {
  action: 'action-library',
  environment: 'environment-library',
  step: 'step-library',
  workflow: 'workflow-library',
  environmentPackage: 'environment-package', // NEW: single-environment package type
}

/**
 * Collect environment library IDs referenced by specs via environmentSpecIds.
 */
function collectEnvironmentLibraryIds(tree: LibraryWithChildren, allSpecs: Specification[]): Set<string> {
  const envLibIds = new Set<string>()
  const walkSpecs = (specs: Specification[]) => {
    for (const spec of specs) {
      const envSpecIds = spec.data.environmentSpecIds as string[] | undefined
      if (!envSpecIds) continue
      for (const envSpecId of envSpecIds) {
        const envSpec = allSpecs.find((s) => s.id === envSpecId)
        if (envSpec) envLibIds.add(envSpec.libraryId)
      }
    }
  }
  const walkTree = (node: LibraryWithChildren) => {
    walkSpecs(node.specifications)
    for (const child of node.children) walkTree(child)
  }
  walkTree(tree)
  return envLibIds
}

/**
 * Collect unique action library names referenced by environment specs.
 */
function collectActionLibraryNames(
  envLibIds: Set<string>,
  allSpecsByLibrary: Map<string, Specification[]>,
  allLibraries: Library[],
): Map<string, string | null> {
  const envSpecs = [...envLibIds].flatMap((id) => allSpecsByLibrary.get(id) || [])
  return actionLibraryRefs(envSpecs, (id) => allLibraries.find((l) => l.id === id)?.teamId)
}

/**
 * Collect unique action library names referenced by every env spec in an
 * environment-library export tree (root + child libraries).
 */
function collectActionLibraryNamesFromTree(tree: LibraryWithChildren): Map<string, string | null> {
  const envSpecs: Specification[] = []
  const walk = (node: LibraryWithChildren) => {
    envSpecs.push(...node.specifications)
    for (const child of node.children) walk(child)
  }
  walk(tree)
  // Child libraries share the root's team, so every env spec here prefers that team.
  return actionLibraryRefs(envSpecs, () => tree.library.teamId)
}

/**
 * Collect all images from step library workflow specs recursively.
 * Mirrors collectAllImages in workflow-library-package.ts.
 */
function collectAllStepImages(stepLibExport: MasterWorkflowStepLibrary): {
  filenames: string[]
  formEntries: FormElementImageEntry[]
} {
  const filenames = new Set<string>()
  const formEntrySeen = new Set<string>()
  const formEntries: FormElementImageEntry[] = []

  const walkWorkflowSpecs = (specs: MasterWorkflowSpecification[]) => {
    for (const wfSpec of specs) {
      for (const f of collectImageFilenames(wfSpec.steps)) filenames.add(f)
      for (const entry of collectFormElementImages(wfSpec.steps)) {
        if (!formEntrySeen.has(entry.zipPath)) {
          formEntrySeen.add(entry.zipPath)
          formEntries.push(entry)
        }
      }
      if (wfSpec.children) walkWorkflowSpecs(wfSpec.children)
    }
  }

  const walkLibrary = (lib: MasterWorkflowStepLibrary) => {
    walkWorkflowSpecs(lib.workflow_specifications)
    if (lib.child_libraries) {
      for (const child of lib.child_libraries) walkLibrary(child)
    }
  }
  walkLibrary(stepLibExport)
  return { filenames: [...filenames], formEntries }
}

/**
 * Creates a self-contained library package ZIP for action, environment, or step libraries.
 *
 * Naming convention: `X` suffix denotes a ZIP container (outer file); the inner
 * JSON uses the same stem without the `X`.
 *
 * ZIP structure:
 * - {name}.WFaction | .WFenvir | .WFslib — the library JSON (inner)
 * - environments/{name}.WFenvir — referenced environment libraries (step only)
 * - actions/{name}.WFaction — referenced action libraries (step only)
 * - images/{filename} — referenced images (step only, for now)
 * - manifest.json — package metadata
 *
 * The outer ZIP file itself (produced by the caller) uses the library-suffixed form
 * (`.WFactionLibX`, `.WFenvirLibX`, `.WFstepLibX`, `.WFlibX`).
 */
export async function createLibraryPackage(options: LibraryPackageOptions): Promise<Blob> {
  const { tree, entityType, images, allSpecs = [], allLibraries = [], allSpecsByLibrary = new Map() } = options
  const library = tree.library
  const libraryName = library.name
  const innerExt = INNER_JSON_EXTENSIONS[entityType]

  // 1. Export library JSON based on entity type
  let libraryExport: unknown
  switch (entityType) {
    case 'action':
      libraryExport = exportActionLibrary(
        library,
        tree.specifications,
        tree.children.length > 0 ? tree.children : undefined,
      )
      break
    case 'environment':
      libraryExport = exportEnvironmentLibrary(
        library,
        tree.specifications,
        tree.children.length > 0 ? tree.children : undefined,
        allLibraries,
        allSpecsByLibrary,
        { includeValueTypes: true },
      )
      break
    case 'step':
      libraryExport = exportStepLibrary(
        library,
        tree.specifications,
        tree.children.length > 0 ? tree.children : undefined,
        allSpecsByLibrary,
        allLibraries,
        { includeValueTypes: true },
      )
      break
    default:
      throw new Error(`Unsupported entity type for library package: ${entityType}`)
  }

  // 2. Collect dependencies (step libraries need environments + actions)
  const envLibraryExports: Array<{ name: string; data: unknown }> = []
  const actionLibraryExports: Array<{ name: string; data: unknown }> = []

  if (entityType === 'step') {
    const envLibIds = collectEnvironmentLibraryIds(tree, allSpecs)
    for (const envLibId of envLibIds) {
      const envLib = allLibraries.find((l) => l.id === envLibId && l.entityType === 'environment')
      if (!envLib) continue
      const envSpecs = allSpecsByLibrary.get(envLibId) || []
      const exported = exportEnvironmentLibrary(envLib, envSpecs, undefined, allLibraries, allSpecsByLibrary, {
        includeValueTypes: true,
      })
      envLibraryExports.push({ name: envLib.name, data: exported })
    }

    const actionLibNames = collectActionLibraryNames(envLibIds, allSpecsByLibrary, allLibraries)
    for (const [actionLibName, preferTeamId] of actionLibNames) {
      const actionLib = pickLibraryByName(allLibraries, actionLibName, 'action', preferTeamId)
      if (!actionLib) continue
      if (actionLibraryExports.some((e) => e.name === actionLib.name)) continue
      const actionSpecs = allSpecsByLibrary.get(actionLib.id) || []
      const exported = exportActionLibrary(actionLib, actionSpecs)
      actionLibraryExports.push({ name: actionLib.name, data: exported })
    }
  } else if (entityType === 'environment') {
    // Bundle action libraries referenced by env specs in this tree so the
    // WFenvirLibX is self-contained: an importer can recreate any missing
    // action library (and missing action specs) without a separate package.
    const actionLibNames = collectActionLibraryNamesFromTree(tree)
    for (const [actionLibName, preferTeamId] of actionLibNames) {
      const actionLib = pickLibraryByName(allLibraries, actionLibName, 'action', preferTeamId)
      if (!actionLib) continue
      if (actionLibraryExports.some((e) => e.name === actionLib.name)) continue
      const actionSpecs = allSpecsByLibrary.get(actionLib.id) || []
      const exported = exportActionLibrary(actionLib, actionSpecs)
      actionLibraryExports.push({ name: actionLib.name, data: exported })
    }
  }

  // 3. Collect images (step libraries have UI param + form element images)
  let imageFilenames: string[] = []
  let formEntries: FormElementImageEntry[] = []
  if (entityType === 'step') {
    const collected = collectAllStepImages(libraryExport as MasterWorkflowStepLibrary)
    imageFilenames = collected.filenames
    formEntries = collected.formEntries
  }

  // 4. Build ZIP
  const zip = new JSZip()

  zip.file(`${libraryName}.${innerExt}`, JSON.stringify(libraryExport, null, 2))

  for (const envExport of envLibraryExports) {
    zip.file(`environments/${envExport.name}.WFenvir`, JSON.stringify(envExport.data, null, 2))
  }
  for (const actionExport of actionLibraryExports) {
    zip.file(`actions/${actionExport.name}.WFaction`, JSON.stringify(actionExport.data, null, 2))
  }

  for (const filename of imageFilenames) {
    const dataUri = images[filename]
    if (!dataUri) continue
    const match = dataUri.match(/^data:[^;]+;base64,(.+)$/)
    if (match) zip.file(`images/${filename}`, match[1], { base64: true })
  }
  for (const entry of formEntries) {
    const dataUri = images[entry.imageStoreKey]
    if (!dataUri) continue
    const match = dataUri.match(/^data:[^;]+;base64,(.+)$/)
    if (match) zip.file(`images/${entry.zipPath}`, match[1], { base64: true })
  }

  // 5. Manifest
  const manifest = {
    packageType: PACKAGE_TYPES[entityType],
    packageVersion: '1.0',
    libraryName,
    ...(envLibraryExports.length > 0 ? { environmentLibraries: envLibraryExports.map((e) => e.name) } : {}),
    ...(actionLibraryExports.length > 0 ? { actionLibraries: actionLibraryExports.map((a) => a.name) } : {}),
    createdAt: new Date().toISOString(),
    files: [
      { path: `${libraryName}.${innerExt}`, type: PACKAGE_TYPES[entityType] },
      ...envLibraryExports.map((e) => ({ path: `environments/${e.name}.WFenvir`, type: 'environment-library' })),
      ...actionLibraryExports.map((a) => ({ path: `actions/${a.name}.WFaction`, type: 'action-library' })),
      ...imageFilenames.filter((f) => images[f]).map((f) => ({ path: `images/${f}`, type: 'image' })),
      ...formEntries
        .filter((e) => images[e.imageStoreKey])
        .map((e) => ({ path: `images/${e.zipPath}`, type: 'image' })),
    ],
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  return zip.generateAsync({ type: 'blob' })
}

/** Returns the file extension for a library package type */
export function getLibraryPackageExtension(entityType: EntityType): string {
  return PACKAGE_EXTENSIONS[entityType]
}
