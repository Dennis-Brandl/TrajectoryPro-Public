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

import { pickLibraryByName } from '@/lib/global-team'
import JSZip from 'jszip'
import type { Library, Specification } from '@/types/library'
import type { LibraryWithChildren, MasterWorkflowSpecification } from './export-types'
import { exportStepLibrary, exportEnvironmentLibrary, exportActionLibrary } from './library-exporters'
import { exportWorkflowSpec } from './workflow-exporters'
import { collectImageFilenames, collectFormElementImages } from './image-collectors'
import type { FormElementImageEntry } from './image-collectors'
import { libraryToManagedElement } from './entity-converters'

export interface CreateOptions {
  tree: LibraryWithChildren
  images: Record<string, string>
  allSpecs: Specification[]
  allLibraries: Library[]
  allSpecsByLibrary: Map<string, Specification[]>
}

interface OidIndexLibraryEntry {
  oid: string
  name: string
  entityType: 'workflow' | 'step' | 'environment' | 'action'
  version: string
}
interface OidIndexSpecEntry {
  oid: string
  libraryOid: string
  name: string
  version: string
}

/**
 * Collects image filenames and form-element image entries from an exported
 * MasterWorkflowSpecification tree (steps + recursive children).
 * Mirrors collectAllStepImages in library-package.ts.
 */
function collectAllWorkflowImages(wfSpec: MasterWorkflowSpecification): {
  filenames: string[]
  formEntries: FormElementImageEntry[]
} {
  const filenames = new Set<string>()
  const formEntrySeen = new Set<string>()
  const formEntries: FormElementImageEntry[] = []

  const walkSpec = (spec: MasterWorkflowSpecification) => {
    for (const f of collectImageFilenames(spec.steps)) filenames.add(f)
    for (const entry of collectFormElementImages(spec.steps)) {
      if (!formEntrySeen.has(entry.zipPath)) {
        formEntrySeen.add(entry.zipPath)
        formEntries.push(entry)
      }
    }
    if (spec.children) {
      // Deprecated `child_workflows` field (export-types.ts) is intentionally skipped — matches collectAllStepImages in library-package.ts.
      for (const child of spec.children) walkSpec(child)
    }
  }

  walkSpec(wfSpec)
  return { filenames: [...filenames], formEntries }
}

/**
 * Walks the workflow-library tree's transitive dependency graph and
 * assembles a .WFlibX ZIP that matches SCHEMA-SPECIFICATION.md §12.3
 * with packageVersion 1.1 (adds manifest.oidIndex).
 */
export async function createWorkflowLibraryPackage(options: CreateOptions): Promise<Blob> {
  const { tree, images, allSpecs, allLibraries, allSpecsByLibrary } = options
  const rootLib = tree.library

  // 1. Collect all workflow specs and libraries across the tree.
  const wfSpecs: Specification[] = []
  const wfLibs: Library[] = []
  const walkWfTree = (node: LibraryWithChildren) => {
    wfLibs.push(node.library)
    for (const s of node.specifications) wfSpecs.push(s)
    for (const c of node.children) walkWfTree(c)
  }
  walkWfTree(tree)

  // 2. Walk dependency graph from workflow specs to find referenced libraries.
  const stepLibOids = new Set<string>()
  const envLibOids = new Set<string>()
  const actionLibOids = new Set<string>()
  const collectDependencies = (wf: Specification) => {
    // NOTE: This scans raw `spec.data.nodes` rather than the exported `MasterWorkflowSpecification.steps`
    // because the exported step form does not carry the step library reference for workflowProxy nodes.
    // The runtime node-data fields are `referencedStepLibraryId` (direct OID) and `referencedStepSpecId`
    // (per src/types/nodes.ts). The legacy `mode`/`referencedSpecId` fields the original code looked at
    // are NOT what the editor writes — that's why this dependency was silently missed in early exports.
    const nodes = (wf.data.nodes as Array<Record<string, unknown>> | undefined) ?? []
    for (const n of nodes) {
      if (n.type !== 'workflowProxy') continue
      const d = (n.data ?? {}) as Record<string, unknown>
      // Primary: the node carries the step library OID directly.
      if (typeof d.referencedStepLibraryId === 'string') {
        stepLibOids.add(d.referencedStepLibraryId)
      }
      // Secondary: resolve via the referenced step's libraryId (covers older
      // proxies that only stored the step OID).
      const stepOid =
        (typeof d.referencedStepSpecId === 'string' && d.referencedStepSpecId) ||
        (typeof d.referencedSpecId === 'string' && d.referencedSpecId) || // legacy fallback
        null
      if (stepOid) {
        const referenced = allSpecs.find((s) => s.id === stepOid)
        if (referenced) stepLibOids.add(referenced.libraryId)
      }
    }
    const envSpecIds = (wf.data.environmentSpecIds as string[] | undefined) ?? []
    for (const id of envSpecIds) {
      const envSpec = allSpecs.find((s) => s.id === id)
      if (envSpec) envLibOids.add(envSpec.libraryId)
    }
  }
  for (const wf of wfSpecs) collectDependencies(wf)
  // Referenced steps have environments and steps of their own. A Set's iteration also visits
  // what is added during it, so this follows step libraries that reference other step libraries.
  for (const oid of stepLibOids) {
    for (const stepSpec of allSpecsByLibrary.get(oid) ?? []) collectDependencies(stepSpec)
  }
  // Environments → action libraries (by name) → action library OIDs.
  for (const envLibOid of envLibOids) {
    const envSpecs = allSpecsByLibrary.get(envLibOid) ?? []
    for (const envSpec of envSpecs) {
      const actions = (envSpec.data.included_actions ?? envSpec.data.includedActions ?? []) as Array<{
        action_library?: string
        actionLibrary?: string
      }>
      for (const a of actions) {
        const name = a.action_library ?? a.actionLibrary
        if (!name) continue
        const envTeamId = allLibraries.find((l) => l.id === envLibOid)?.teamId
        const actionLib = pickLibraryByName(allLibraries, name, 'action', envTeamId)
        if (actionLib) actionLibOids.add(actionLib.id)
      }
    }
  }

  // 3. Build oidIndex.
  const oidIndex = {
    libraries: [] as OidIndexLibraryEntry[],
    specifications: [] as OidIndexSpecEntry[],
  }
  for (const l of wfLibs) {
    oidIndex.libraries.push({ oid: l.id, name: l.name, entityType: 'workflow', version: l.version ?? '1.0.0' })
  }
  for (const oid of stepLibOids) {
    const l = allLibraries.find((x) => x.id === oid && x.entityType === 'step')
    if (l) oidIndex.libraries.push({ oid: l.id, name: l.name, entityType: 'step', version: l.version ?? '1.0.0' })
  }
  for (const oid of envLibOids) {
    const l = allLibraries.find((x) => x.id === oid && x.entityType === 'environment')
    if (l)
      oidIndex.libraries.push({ oid: l.id, name: l.name, entityType: 'environment', version: l.version ?? '1.0.0' })
  }
  for (const oid of actionLibOids) {
    const l = allLibraries.find((x) => x.id === oid && x.entityType === 'action')
    if (l) oidIndex.libraries.push({ oid: l.id, name: l.name, entityType: 'action', version: l.version ?? '1.0.0' })
  }
  const addSpecsToIndex = (libOid: string) => {
    for (const s of allSpecsByLibrary.get(libOid) ?? []) {
      oidIndex.specifications.push({ oid: s.id, libraryOid: libOid, name: s.name, version: s.version ?? '1.0.0' })
    }
  }
  for (const l of wfLibs) addSpecsToIndex(l.id)
  for (const oid of stepLibOids) addSpecsToIndex(oid)
  for (const oid of envLibOids) addSpecsToIndex(oid)
  for (const oid of actionLibOids) addSpecsToIndex(oid)

  // 4. Export dependency libraries.
  const exportLibByOid = (libOid: string, entityType: 'step' | 'environment' | 'action') => {
    const l = allLibraries.find((x) => x.id === libOid && x.entityType === entityType)
    if (!l) return null
    const specs = allSpecsByLibrary.get(libOid) ?? []
    switch (entityType) {
      case 'step':
        return exportStepLibrary(l, specs, undefined, allSpecsByLibrary, allLibraries, { includeValueTypes: true })
      case 'environment':
        return exportEnvironmentLibrary(l, specs, undefined, allLibraries, allSpecsByLibrary, {
          includeValueTypes: true,
        })
      case 'action':
        return exportActionLibrary(l, specs)
    }
  }
  const stepLibExports: Array<{ name: string; data: ReturnType<typeof exportLibByOid> }> = []
  const seenStepNames = new Set<string>()
  for (const oid of stepLibOids) {
    const name = allLibraries.find((l) => l.id === oid)?.name ?? oid
    if (seenStepNames.has(name)) continue
    seenStepNames.add(name)
    stepLibExports.push({ name, data: exportLibByOid(oid, 'step') })
  }
  const envLibExports: Array<{ name: string; data: ReturnType<typeof exportLibByOid> }> = []
  const seenEnvNames = new Set<string>()
  for (const oid of envLibOids) {
    const name = allLibraries.find((l) => l.id === oid)?.name ?? oid
    if (seenEnvNames.has(name)) continue
    seenEnvNames.add(name)
    envLibExports.push({ name, data: exportLibByOid(oid, 'environment') })
  }
  const actionLibExports: Array<{ name: string; data: ReturnType<typeof exportLibByOid> }> = []
  const seenActionNames = new Set<string>()
  for (const oid of actionLibOids) {
    const name = allLibraries.find((l) => l.id === oid)?.name ?? oid
    if (seenActionNames.has(name)) continue
    seenActionNames.add(name)
    actionLibExports.push({ name, data: exportLibByOid(oid, 'action') })
  }

  // 5. Export workflow specs and build the workflow library JSON.
  //    Mirror exportStepLibrary: spread the library managed-element at the top
  //    level (matches master-workflow-library.json schema, which is a
  //    managed-element with a `workflow_specifications` field), and emit only
  //    ROOT specs at the top level. exportWorkflowSpec recursively nests
  //    children (version-chain entries / inline child workflows) under each
  //    root's `children` field via allSpecs + parentSpecificationId scan.
  const rootWfSpecs = wfSpecs.filter((s) => {
    const d = s.data as { parentSpecificationId?: string } | null
    return !d?.parentSpecificationId
  })
  const exportedWfSpecs = rootWfSpecs.map((s) =>
    exportWorkflowSpec(s, allSpecs, allLibraries, undefined, undefined, undefined, undefined, undefined, {
      includeValueTypes: true,
    }),
  )
  const workflowLibraryJson = {
    ...libraryToManagedElement(rootLib),
    workflow_specifications: exportedWfSpecs,
    // child_libraries is a one-level list of direct child workflow libraries (metadata only).
    // Every spec from every level of the tree is already inlined into workflow_specifications[]
    // via the recursive walkWfTree() above, so consumers can rebuild the tree from spec.libraryOid.
    child_libraries: tree.children.map((c) => libraryToManagedElement(c.library)),
  }

  // 6. Collect images from the exported steps (not raw data nodes).
  //    Mirrors the pattern in library-package.ts collectAllStepImages.
  const uiImageFilenames = new Set<string>()
  const formImageEntries = new Set<string>()
  const formImages: Array<{ zipPath: string; imageStoreKey: string }> = []
  for (const exportedSpec of exportedWfSpecs) {
    const { filenames, formEntries } = collectAllWorkflowImages(exportedSpec)
    for (const f of filenames) uiImageFilenames.add(f)
    for (const entry of formEntries) {
      if (formImageEntries.has(entry.zipPath)) continue
      formImageEntries.add(entry.zipPath)
      formImages.push({ zipPath: entry.zipPath, imageStoreKey: entry.imageStoreKey })
    }
  }

  // 7. Assemble ZIP.
  const zip = new JSZip()
  zip.file(`${rootLib.name}.WFlib`, JSON.stringify(workflowLibraryJson, null, 2))
  for (const e of stepLibExports) zip.file(`steps/${e.name}.WFslib`, JSON.stringify(e.data, null, 2))
  for (const e of envLibExports) zip.file(`environments/${e.name}.WFenvir`, JSON.stringify(e.data, null, 2))
  for (const e of actionLibExports) zip.file(`actions/${e.name}.WFaction`, JSON.stringify(e.data, null, 2))

  for (const f of uiImageFilenames) {
    const uri = images[f]
    if (!uri) continue
    const m = uri.match(/^data:[^;]+;base64,(.+)$/)
    if (m) zip.file(`images/${f}`, m[1], { base64: true })
  }
  for (const entry of formImages) {
    const uri = images[entry.imageStoreKey]
    if (!uri) continue
    const m = uri.match(/^data:[^;]+;base64,(.+)$/)
    if (m) zip.file(`images/${entry.zipPath}`, m[1], { base64: true })
  }

  // 8. Manifest.
  const manifest = {
    packageType: 'workflow-library',
    packageVersion: '1.1',
    libraryName: rootLib.name,
    createdAt: new Date().toISOString(),
    files: [
      { path: `${rootLib.name}.WFlib`, type: 'workflow-library' },
      ...stepLibExports.map((e) => ({ path: `steps/${e.name}.WFslib`, type: 'step-library' })),
      ...envLibExports.map((e) => ({ path: `environments/${e.name}.WFenvir`, type: 'environment-library' })),
      ...actionLibExports.map((e) => ({ path: `actions/${e.name}.WFaction`, type: 'action-library' })),
      ...[...uiImageFilenames].filter((f) => images[f]).map((f) => ({ path: `images/${f}`, type: 'image' })),
      ...formImages.filter((e) => images[e.imageStoreKey]).map((e) => ({ path: `images/${e.zipPath}`, type: 'image' })),
    ],
    oidIndex,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  return zip.generateAsync({ type: 'blob' })
}
