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
import type { Specification, Library } from '@/types/library'
import {
  exportActionLibrary,
  exportEnvironmentPackage,
  exportEnvironmentSpec,
  type EnvironmentPackageActionLibrary,
} from '@/lib/packageFormat/library-exporters'
import type { MasterActionSpecification } from '@/lib/packageFormat/export-types'
import { specToManagedElement } from '@/lib/packageFormat/entity-converters'
import { extractInputParams, extractOutputParams, extractPropertySpecs } from '@/lib/packageFormat/parameter-extractors'
import { downloadJSON, downloadBlob } from './download'
import { withVersionSuffix } from './filename'

/**
 * Exports a single action specification as a .WFaction file.
 * Wraps the spec in a minimal library shell for format consistency.
 */
export function exportSingleAction(spec: Specification, library: Library): void {
  const exported = exportActionLibrary({ ...library, name: spec.name }, [spec])
  downloadJSON(exported, `${withVersionSuffix(spec.name, spec.version)}.WFaction`)
}

/**
 * Converts a raw action Specification to a MasterActionSpecification.
 * Mirrors the per-spec mapping used inside exportActionLibrary.
 */
function specToMasterAction(spec: Specification): MasterActionSpecification {
  return {
    ...specToManagedElement(spec),
    input_parameter_specifications: extractInputParams(spec.data),
    output_parameter_specifications: extractOutputParams(spec.data),
    property_specifications: extractPropertySpecs(spec.data),
    action_visibility: (spec.data.actionVisibility as 'opaque' | 'observable') || 'opaque',
  }
}

/**
 * Exports a single environment specification as a .WFenvirX package (ZIP).
 *
 * Uses the `exportEnvironmentPackage` builder which produces:
 *   - `{EnvName}.WFenvir`                            — env spec JSON (no library wrapper)
 *   - `actions/{ActionLibraryName}/{ActionName}.WFaction` — each included action spec, grouped by source library
 *   - `manifest.json`                                — packageType: 'environment-package', includes actionLibraries[]
 *
 * Included actions are resolved from allLibraries + allSpecsByLibrary AND
 * grouped by their source action library so the importer can recreate the
 * library structure (Action Library exists or is created, Actions added
 * add-only). If a ref cannot be resolved it is silently skipped (the env spec
 * itself still carries the ref via included_actions[].action_name +
 * action_library).
 *
 * Returns the download filename (`{EnvName}({version}).WFenvirX`) so callers
 * can surface it in toasts without re-deriving the naming rule.
 */
export async function exportSingleEnvironment(
  spec: Specification,
  _library: Library,
  allLibraries?: Library[],
  allSpecsByLibrary?: Map<string, Specification[]>,
): Promise<string> {
  // Resolve each included_action ref into (libraryName, MasterActionSpecification).
  const rawActions = (spec.data.included_actions ?? spec.data.includedActions) as
    | Array<{ action_library?: string; action_name?: string; actionLibrary?: string; actionName?: string }>
    | undefined

  const resolved: Array<{ libraryName: string; spec: MasterActionSpecification }> = (rawActions ?? []).flatMap(
    (ref) => {
      const libName = ref.action_library ?? ref.actionLibrary ?? ''
      const actionName = ref.action_name ?? ref.actionName ?? ''
      if (!libName || !actionName) return []
      const lib = pickLibraryByName(allLibraries ?? [], libName, 'action', _library.teamId)
      if (!lib) return []
      const specs: Specification[] = (allSpecsByLibrary ?? new Map<string, Specification[]>()).get(lib.id) ?? []
      const actionSpec = specs.find((s) => s.name === actionName)
      if (!actionSpec) return []
      return [{ libraryName: libName, spec: specToMasterAction(actionSpec) }]
    },
  )

  // Group by source library, dedupe by action local_id within each library.
  const byLibrary = new Map<string, Map<string, MasterActionSpecification>>()
  for (const { libraryName, spec: actionSpec } of resolved) {
    if (!byLibrary.has(libraryName)) byLibrary.set(libraryName, new Map())
    byLibrary.get(libraryName)!.set(actionSpec.local_id, actionSpec)
  }
  const actionLibraries: EnvironmentPackageActionLibrary[] = [...byLibrary.entries()].map(
    ([libraryName, specsMap]) => ({
      libraryName,
      specs: [...specsMap.values()],
    }),
  )

  // Build the env spec JSON, passing through allLibraries/allSpecsByLibrary so
  // included_actions entries are still inlined (runtime self-contained contract).
  const envSpec = exportEnvironmentSpec(spec, undefined, allLibraries, allSpecsByLibrary)

  const blob = await exportEnvironmentPackage(envSpec, actionLibraries)
  const filename = `${withVersionSuffix(spec.name, spec.version)}.WFenvirX`
  downloadBlob(blob, filename)
  return filename
}
